import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryJob } from './entities/delivery-job.entity';
import { RetryPolicy } from './retry-policy';
import { WebhookClient, WebhookDeliveryResult } from './webhook.client';
import { AttemptsService } from '../attempts/attempts.service';
import { EventEntity } from '../events/entities/event.entity';
import { AttemptStatus, DeliveryErrorType, FailureClassification } from '../common/attempt.enums';
import { assertTransition, DeliveryStatus } from '../common/delivery-status.enum';
import { RealtimeEventType } from '../common/realtime-event';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { MetricsService } from '../metrics/metrics.service';
import { AppConfigService } from '../config/app-config.service';

export type DeliveryOutcome =
  | { kind: 'DELIVERED'; attemptNumber: number; httpStatus: number }
  | { kind: 'RETRY_SCHEDULED'; attemptNumber: number; nextAttemptAt: Date }
  | { kind: 'EXHAUSTED'; attemptNumber: number }
  | { kind: 'PERMANENT_FAILURE'; attemptNumber: number; httpStatus: number | null }
  | { kind: 'SKIPPED'; reason: string };

/**
 * The delivery state machine.
 *
 * Every transition goes through here: the worker only decides *when* to run a
 * job, this decides what the run means. Each transition writes the database
 * first and then emits a realtime event, so the dashboard can never show a
 * state the database does not already hold.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly attempts: AttemptsService,
    private readonly webhookClient: WebhookClient,
    private readonly retryPolicy: RetryPolicy,
    private readonly realtime: RealtimePublisher,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    @InjectRepository(EventEntity)
    private readonly events: Repository<EventEntity>,
  ) {}

  /**
   * Execute one attempt for an already-claimed job.
   *
   * The job arrives in DELIVERING with its attempt counter already incremented
   * by the claim, which is what makes the attempt number stable and unique.
   */
  async executeClaimedJob(job: DeliveryJob): Promise<DeliveryOutcome> {
    const event = await this.events.findOne({ where: { eventId: job.eventId } });
    if (!event) {
      // Cannot happen with the FK in place, but a job we cannot describe must
      // not spin forever in the queue.
      this.logger.error(`Delivery job ${job.id} references unknown event ${job.eventId}`);
      await this.deliveryRepository.markFailed(job);
      return { kind: 'SKIPPED', reason: 'event-not-found' };
    }

    const attemptNumber = job.attemptCount;
    const attempt = await this.attempts.start(job.eventId, attemptNumber);

    this.metrics.increment(MetricsService.DELIVERY_ATTEMPTS);
    this.realtime.publish({
      type: RealtimeEventType.DELIVERY_STARTED,
      eventId: job.eventId,
      eventType: event.type,
      status: DeliveryStatus.DELIVERING,
      attemptNumber,
      maxAttempts: this.retryPolicy.maxAttempts,
      message: `Delivery attempt #${attemptNumber} started`,
    });

    const result = await this.webhookClient.send({
      eventId: event.eventId,
      type: event.type,
      occurredAt: event.occurredAt,
      payload: event.payload,
      attemptNumber,
    });

    this.metrics.recordAttemptDuration(result.durationMs);
    if (result.httpStatus !== null) this.metrics.recordHttpStatus(result.httpStatus);

    const classification = this.retryPolicy.classify(result);

    if (classification === 'SUCCESS') {
      return this.onSuccess(job, event, attempt.id, attemptNumber, result);
    }
    if (classification === FailureClassification.PERMANENT) {
      return this.onPermanentFailure(job, event, attempt.id, attemptNumber, result);
    }
    return this.onRetryableFailure(job, event, attempt.id, attemptNumber, result);
  }

  private async onSuccess(
    job: DeliveryJob,
    event: EventEntity,
    attemptId: string,
    attemptNumber: number,
    result: WebhookDeliveryResult,
  ): Promise<DeliveryOutcome> {
    await this.attempts.complete(attemptId, {
      status: AttemptStatus.SUCCESS,
      httpStatus: result.httpStatus,
    });

    assertTransition(DeliveryStatus.DELIVERING, DeliveryStatus.DELIVERED, job.eventId);
    await this.deliveryRepository.markDelivered(job);

    this.metrics.increment(MetricsService.DELIVERIES_SUCCEEDED);
    this.metrics.recordDeliveryLatency(Date.now() - event.createdAt.getTime());

    this.realtime.publish({
      type: RealtimeEventType.DELIVERY_SUCCEEDED,
      eventId: job.eventId,
      eventType: event.type,
      status: DeliveryStatus.DELIVERED,
      attemptNumber,
      maxAttempts: this.retryPolicy.maxAttempts,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      message: `Receiver returned ${result.httpStatus} - event delivered on attempt #${attemptNumber}`,
    });

    this.logger.log(`Delivered ${job.eventId} on attempt ${attemptNumber} (${result.httpStatus})`);
    return { kind: 'DELIVERED', attemptNumber, httpStatus: result.httpStatus as number };
  }

  private async onPermanentFailure(
    job: DeliveryJob,
    event: EventEntity,
    attemptId: string,
    attemptNumber: number,
    result: WebhookDeliveryResult,
  ): Promise<DeliveryOutcome> {
    await this.completeFailedAttempt(attemptId, result);
    this.metrics.increment(MetricsService.FAILURES_PERMANENT);

    assertTransition(DeliveryStatus.DELIVERING, DeliveryStatus.FAILED, job.eventId);
    await this.deliveryRepository.markFailed(job);

    this.realtime.publish({
      type: RealtimeEventType.DELIVERY_FAILED,
      eventId: job.eventId,
      eventType: event.type,
      status: DeliveryStatus.FAILED,
      attemptNumber,
      maxAttempts: this.retryPolicy.maxAttempts,
      httpStatus: result.httpStatus,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      classification: FailureClassification.PERMANENT,
      attemptsRemaining: 0,
      nextAttemptAt: null,
      durationMs: result.durationMs,
      message: `Receiver returned ${result.httpStatus ?? result.errorType} - permanent failure, no retry scheduled`,
    });

    this.logger.warn(
      `Permanent failure for ${job.eventId} on attempt ${attemptNumber}: ${result.errorMessage}`,
    );
    return { kind: 'PERMANENT_FAILURE', attemptNumber, httpStatus: result.httpStatus };
  }

  private async onRetryableFailure(
    job: DeliveryJob,
    event: EventEntity,
    attemptId: string,
    attemptNumber: number,
    result: WebhookDeliveryResult,
  ): Promise<DeliveryOutcome> {
    await this.completeFailedAttempt(attemptId, result);
    this.metrics.increment(MetricsService.FAILURES_RETRYABLE);
    this.publishAttemptFailed(job, event, attemptNumber, result, FailureClassification.RETRYABLE);

    if (this.retryPolicy.isExhausted(attemptNumber)) {
      assertTransition(DeliveryStatus.DELIVERING, DeliveryStatus.FAILED, job.eventId);
      await this.deliveryRepository.markFailed(job);
      this.metrics.increment(MetricsService.DELIVERIES_EXHAUSTED);

      this.realtime.publish({
        type: RealtimeEventType.DELIVERY_EXHAUSTED,
        eventId: job.eventId,
        eventType: event.type,
        status: DeliveryStatus.FAILED,
        attemptNumber,
        maxAttempts: this.retryPolicy.maxAttempts,
        httpStatus: result.httpStatus,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
        classification: FailureClassification.RETRYABLE,
        attemptsRemaining: 0,
        nextAttemptAt: null,
        message: `Retry limit reached after ${attemptNumber} attempts - no further attempts scheduled`,
      });

      this.logger.warn(`Exhausted retries for ${job.eventId} after ${attemptNumber} attempts`);
      return { kind: 'EXHAUSTED', attemptNumber };
    }

    const nextAttemptAt = this.retryPolicy.nextAttemptAt(attemptNumber);
    assertTransition(DeliveryStatus.DELIVERING, DeliveryStatus.RETRYING, job.eventId);
    await this.deliveryRepository.scheduleRetry(job, nextAttemptAt);
    this.metrics.increment(MetricsService.RETRIES_SCHEDULED);

    this.realtime.publish({
      type: RealtimeEventType.DELIVERY_RETRY_SCHEDULED,
      eventId: job.eventId,
      eventType: event.type,
      status: DeliveryStatus.RETRYING,
      attemptNumber,
      maxAttempts: this.retryPolicy.maxAttempts,
      httpStatus: result.httpStatus,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      classification: FailureClassification.RETRYABLE,
      attemptsRemaining: this.retryPolicy.attemptsRemaining(attemptNumber),
      nextAttemptAt: nextAttemptAt.toISOString(),
      message: `Retry ${attemptNumber + 1}/${this.retryPolicy.maxAttempts} scheduled for ${nextAttemptAt.toISOString()}`,
    });

    return { kind: 'RETRY_SCHEDULED', attemptNumber, nextAttemptAt };
  }

  /**
   * Lease recovery: a job stuck in DELIVERING means the worker holding it died.
   *
   * The attempt is already counted, so recovery either reschedules the next
   * attempt or terminates the job when the budget is spent. The receiver may
   * have processed the request before the crash -- that is exactly why delivery
   * is at-least-once and the receiver keys on eventId.
   */
  async recoverStaleJobs(limit: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.worker.leaseTimeoutMs);
    const stale = await this.deliveryRepository.findStaleJobs(cutoff, limit);
    let recovered = 0;

    for (const job of stale) {
      await this.attempts.closeAbandoned(
        job.eventId,
        `Worker ${job.lockedBy ?? 'unknown'} stopped responding; lease expired`,
      );

      const exhausted = this.retryPolicy.isExhausted(job.attemptCount);
      const next = exhausted
        ? { status: DeliveryStatus.FAILED, nextAttemptAt: job.nextAttemptAt }
        : {
            status: DeliveryStatus.RETRYING,
            nextAttemptAt: this.retryPolicy.nextAttemptAt(job.attemptCount, now),
          };

      const released = await this.deliveryRepository.releaseStaleJob(job, next);
      if (!released) continue;

      recovered += 1;
      this.metrics.increment(MetricsService.JOBS_RECOVERED);
      this.realtime.publish({
        type: exhausted ? RealtimeEventType.DELIVERY_EXHAUSTED : RealtimeEventType.DELIVERY_RECOVERED,
        eventId: job.eventId,
        status: next.status,
        attemptNumber: job.attemptCount,
        maxAttempts: this.retryPolicy.maxAttempts,
        errorType: DeliveryErrorType.WORKER_CRASH,
        nextAttemptAt: exhausted ? null : next.nextAttemptAt.toISOString(),
        attemptsRemaining: this.retryPolicy.attemptsRemaining(job.attemptCount),
        message: exhausted
          ? `Worker crashed during the final attempt - retry budget spent, marked FAILED`
          : `Recovered from worker crash during attempt #${job.attemptCount} - requeued`,
      });

      this.logger.warn(
        `Recovered stale job ${job.id} for ${job.eventId} (attempt ${job.attemptCount}, lease expired)`,
      );
    }

    return recovered;
  }

  private async completeFailedAttempt(
    attemptId: string,
    result: WebhookDeliveryResult,
  ): Promise<void> {
    await this.attempts.complete(attemptId, {
      status: AttemptStatus.FAILED,
      httpStatus: result.httpStatus,
      errorType: result.errorType ?? DeliveryErrorType.UNKNOWN,
      errorMessage: result.errorMessage,
    });
  }

  private publishAttemptFailed(
    job: DeliveryJob,
    event: EventEntity,
    attemptNumber: number,
    result: WebhookDeliveryResult,
    classification: FailureClassification,
  ): void {
    this.realtime.publish({
      type: RealtimeEventType.DELIVERY_FAILED,
      eventId: job.eventId,
      eventType: event.type,
      status: DeliveryStatus.DELIVERING,
      attemptNumber,
      maxAttempts: this.retryPolicy.maxAttempts,
      httpStatus: result.httpStatus,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      classification,
      durationMs: result.durationMs,
      message: result.responded
        ? `Receiver returned ${result.httpStatus} on attempt #${attemptNumber}`
        : `Attempt #${attemptNumber} failed: ${result.errorMessage}`,
    });
  }
}
