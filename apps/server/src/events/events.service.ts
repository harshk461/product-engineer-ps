import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import { EventEntity } from './entities/event.entity';
import { EventsRepository } from './events.repository';
import { DeliveryRepository } from '../delivery/delivery.repository';
import { DeliveryJob } from '../delivery/entities/delivery-job.entity';
import { AttemptsService } from '../attempts/attempts.service';
import { DeliveryAttempt } from '../attempts/entities/delivery-attempt.entity';
import { isUniqueViolation } from '../common/unique-violation';
import { DeliveryStatus } from '../common/delivery-status.enum';
import { RealtimeEventType } from '../common/realtime-event';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { MetricsService } from '../metrics/metrics.service';
import { RetryPolicy } from '../delivery/retry-policy';
import { TransactionRunner } from '../database/transaction.runner';

export interface IngestResult {
  duplicate: boolean;
  event: EventEntity;
}

export interface EventSummary {
  eventId: string;
  type: string;
  status: DeliveryStatus;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: { httpStatus: number | null; errorType: string | null; message: string | null } | null;
}

export interface EventDetail extends EventSummary {
  payload: Record<string, unknown>;
  attemptsRemaining: number;
  attempts: DeliveryAttempt[];
}

/**
 * Ingestion.
 *
 * The only rule that matters here: an accepted event and its delivery job are
 * created in one transaction, and the caller's eventId is the idempotency key.
 * A duplicate is a successful, non-mutating outcome -- never an error, and
 * never an overwrite of the original payload.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly transactions: TransactionRunner,
    private readonly eventsRepository: EventsRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly attempts: AttemptsService,
    private readonly realtime: RealtimePublisher,
    private readonly metrics: MetricsService,
    private readonly retryPolicy: RetryPolicy,
  ) {}

  async ingest(dto: CreateEventDto): Promise<IngestResult> {
    try {
      const event = await this.transactions.run(async (manager) => {
        const created = await this.eventsRepository.insert(manager, {
          eventId: dto.eventId,
          type: dto.type,
          occurredAt: dto.occurredAt,
          payload: dto.payload ?? {},
        });
        // Same transaction: an event can never exist without its delivery job,
        // and a job can never exist for an event that was rolled back.
        await this.deliveryRepository.insertJob(manager, created.eventId, new Date());
        return created;
      });

      this.metrics.increment(MetricsService.EVENTS_ACCEPTED);
      this.realtime.publish({
        type: RealtimeEventType.EVENT_ACCEPTED,
        eventId: event.eventId,
        eventType: event.type,
        status: DeliveryStatus.PENDING,
        attemptNumber: 0,
        maxAttempts: this.retryPolicy.maxAttempts,
        message: `Event ${event.eventId} accepted and delivery scheduled`,
      });

      this.logger.log(`Accepted event ${event.eventId} (${event.type})`);
      return { duplicate: false, event };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.handleDuplicate(dto);
    }
  }

  /**
   * A concurrent submission lost the UNIQUE(eventId) race. The winner's row is
   * authoritative; we return it untouched so a different payload for the same
   * eventId can never overwrite the first accepted one.
   */
  private async handleDuplicate(dto: CreateEventDto): Promise<IngestResult> {
    const existing = await this.findExistingWithRetry(dto.eventId);
    if (!existing) {
      // The winning transaction rolled back after we saw its lock; treat the
      // submission as retryable rather than inventing state.
      throw new Error(`Duplicate detected for ${dto.eventId} but no committed event was found`);
    }

    this.metrics.increment(MetricsService.EVENTS_DUPLICATE);
    this.realtime.publish({
      type: RealtimeEventType.DUPLICATE_EVENT,
      eventId: existing.eventId,
      eventType: existing.type,
      status: existing.status,
      duplicate: true,
      message: `Duplicate submission for ${existing.eventId} ignored - existing event detected, no new delivery job created`,
    });

    this.logger.log(`Duplicate submission for ${existing.eventId} ignored`);
    return { duplicate: true, event: existing };
  }

  private async findExistingWithRetry(eventId: string, attempts = 3): Promise<EventEntity | null> {
    for (let i = 0; i < attempts; i += 1) {
      const existing = await this.eventsRepository.findByEventId(eventId);
      if (existing) return existing;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  }

  async list(query: ListEventsQueryDto): Promise<{ items: EventSummary[]; total: number }> {
    const { items, total } = await this.eventsRepository.list({
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    const eventIds = items.map((event) => event.eventId);
    const [jobs, latestAttempts] = await Promise.all([
      this.deliveryRepository.findManyByEventIds(eventIds),
      this.attempts.findLatestForEvents(eventIds),
    ]);
    const jobsByEventId = new Map(jobs.map((job) => [job.eventId, job]));

    return {
      total,
      items: items.map((event) =>
        this.toSummary(event, jobsByEventId.get(event.eventId), latestAttempts.get(event.eventId)),
      ),
    };
  }

  async findOne(eventId: string): Promise<EventDetail> {
    const event = await this.eventsRepository.findByEventId(eventId);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const [job, attempts] = await Promise.all([
      this.deliveryRepository.findByEventId(eventId),
      this.attempts.findByEventId(eventId),
    ]);
    const lastAttempt = attempts[attempts.length - 1];
    const summary = this.toSummary(event, job ?? undefined, lastAttempt);

    return {
      ...summary,
      payload: event.payload,
      attempts,
      attemptsRemaining: this.retryPolicy.attemptsRemaining(job?.attemptCount ?? 0),
    };
  }

  async findAttempts(eventId: string): Promise<DeliveryAttempt[]> {
    const event = await this.eventsRepository.findByEventId(eventId);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    return this.attempts.findByEventId(eventId);
  }

  private toSummary(
    event: EventEntity,
    job?: DeliveryJob,
    lastAttempt?: DeliveryAttempt,
  ): EventSummary {
    const failed = lastAttempt && lastAttempt.status === 'FAILED';
    return {
      eventId: event.eventId,
      type: event.type,
      status: event.status,
      occurredAt: event.occurredAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      attemptCount: job?.attemptCount ?? 0,
      maxAttempts: this.retryPolicy.maxAttempts,
      nextAttemptAt:
        job && (job.status === DeliveryStatus.PENDING || job.status === DeliveryStatus.RETRYING)
          ? job.nextAttemptAt.toISOString()
          : null,
      lastError: failed
        ? {
            httpStatus: lastAttempt.httpStatus,
            errorType: lastAttempt.errorType,
            message: lastAttempt.errorMessage,
          }
        : null,
    };
  }
}
