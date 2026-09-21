import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { DeliveryJob } from './entities/delivery-job.entity';
import { EventEntity } from '../events/entities/event.entity';
import { CLAIMABLE_STATUSES, DeliveryStatus } from '../common/delivery-status.enum';

/**
 * All SQL for the persistent queue.
 *
 * Claiming is deliberately a two-step read-then-conditional-update rather than
 * a lock held across the HTTP call:
 *
 *   1. read a batch of candidate ids (cheap, index-only, no locks held)
 *   2. UPDATE ... WHERE id = ? AND status still claimable
 *
 * The UPDATE is atomic, so exactly one worker can observe affected = 1 for a
 * given job. Two workers racing on the same row produce one winner and one
 * no-op, with no lock held while the webhook is in flight.
 *
 * This repository also owns the `events.status` projection, so the delivery
 * state machine has exactly one writer and the modules stay acyclic.
 */
@Injectable()
export class DeliveryRepository {
  constructor(
    @InjectRepository(DeliveryJob)
    private readonly jobs: Repository<DeliveryJob>,
    @InjectRepository(EventEntity)
    private readonly events: Repository<EventEntity>,
  ) {}

  /** Insert the initial job. Called inside the ingestion transaction. */
  async insertJob(manager: EntityManager, eventId: string, nextAttemptAt: Date): Promise<void> {
    await manager.insert(DeliveryJob, {
      eventId,
      status: DeliveryStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt,
      lockedAt: null,
      lockedBy: null,
    });
  }

  findByEventId(eventId: string): Promise<DeliveryJob | null> {
    return this.jobs.findOne({ where: { eventId } });
  }

  findManyByEventIds(eventIds: string[]): Promise<DeliveryJob[]> {
    if (eventIds.length === 0) return Promise.resolve([]);
    return this.jobs.find({ where: { eventId: In(eventIds) } });
  }

  /** Ids of jobs whose scheduled time has arrived, oldest first. */
  async findDueJobIds(limit: number, now = new Date()): Promise<string[]> {
    const rows = await this.jobs.find({
      select: { id: true },
      where: {
        status: In(CLAIMABLE_STATUSES as DeliveryStatus[]),
        nextAttemptAt: LessThanOrEqual(now),
      },
      order: { nextAttemptAt: 'ASC' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  /**
   * Atomically take ownership of a job and burn one attempt.
   *
   * attemptCount is incremented here, not after the HTTP call, so a worker that
   * dies mid-flight still consumes an attempt and retries stay bounded at
   * MAX_ATTEMPTS no matter how many times the process crashes.
   *
   * Returns null when another worker won the race.
   */
  async claim(jobId: string, workerId: string, now = new Date()): Promise<DeliveryJob | null> {
    const result = await this.jobs
      .createQueryBuilder()
      .update(DeliveryJob)
      .set({
        status: DeliveryStatus.DELIVERING,
        attemptCount: () => 'attemptCount + 1',
        lockedAt: now,
        lockedBy: workerId,
      })
      .where('id = :jobId', { jobId })
      .andWhere('status IN (:...statuses)', { statuses: CLAIMABLE_STATUSES })
      .andWhere('nextAttemptAt <= :now', { now })
      .execute();

    if (!result.affected) return null;
    return this.jobs.findOne({ where: { id: jobId } });
  }

  async markDelivered(job: DeliveryJob): Promise<void> {
    await this.transition(job, DeliveryStatus.DELIVERED, { lockedAt: null, lockedBy: null });
  }

  async markFailed(job: DeliveryJob): Promise<void> {
    await this.transition(job, DeliveryStatus.FAILED, { lockedAt: null, lockedBy: null });
  }

  async scheduleRetry(job: DeliveryJob, nextAttemptAt: Date): Promise<void> {
    await this.transition(job, DeliveryStatus.RETRYING, {
      nextAttemptAt,
      lockedAt: null,
      lockedBy: null,
    });
  }

  /**
   * Jobs whose lease expired: the worker that claimed them is gone.
   * Only DELIVERING rows can be stale, because every other state releases the lock.
   */
  findStaleJobs(cutoff: Date, limit: number): Promise<DeliveryJob[]> {
    return this.jobs.find({
      where: { status: DeliveryStatus.DELIVERING, lockedAt: LessThan(cutoff) },
      order: { lockedAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Hand a crashed job back to the queue. Guarded on the job still being the
   * DELIVERING row we saw, so a worker that comes back to life cannot collide
   * with the recovery sweep.
   */
  async releaseStaleJob(
    job: DeliveryJob,
    next: { status: DeliveryStatus; nextAttemptAt: Date },
  ): Promise<boolean> {
    const result = await this.jobs
      .createQueryBuilder()
      .update(DeliveryJob)
      .set({ status: next.status, nextAttemptAt: next.nextAttemptAt, lockedAt: null, lockedBy: null })
      .where('id = :id', { id: job.id })
      .andWhere('status = :delivering', { delivering: DeliveryStatus.DELIVERING })
      .andWhere('lockedAt = :lockedAt', { lockedAt: job.lockedAt })
      .execute();

    if (result.affected) {
      await this.updateEventStatus(job.eventId, next.status);
      return true;
    }
    return false;
  }

  /** Keep the denormalised event status in step with the job. */
  async updateEventStatus(eventId: string, status: DeliveryStatus): Promise<void> {
    await this.events.update({ eventId }, { status });
  }

  countByStatus(): Promise<Array<{ status: DeliveryStatus; count: string }>> {
    return this.jobs
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .groupBy('job.status')
      .getRawMany();
  }

  private async transition(
    job: DeliveryJob,
    status: DeliveryStatus,
    extra: Partial<DeliveryJob>,
  ): Promise<void> {
    await this.jobs.update(job.id, { status, ...extra });
    await this.updateEventStatus(job.eventId, status);
  }
}
