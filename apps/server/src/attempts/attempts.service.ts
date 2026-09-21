import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { DeliveryAttempt } from './entities/delivery-attempt.entity';
import { AttemptStatus, DeliveryErrorType } from '../common/attempt.enums';

export interface AttemptCompletion {
  status: AttemptStatus.SUCCESS | AttemptStatus.FAILED;
  httpStatus?: number | null;
  errorType?: DeliveryErrorType | null;
  errorMessage?: string | null;
  completedAt?: Date;
}

/**
 * Owns the immutable attempt log. Rows are opened before the HTTP call and
 * closed when it settles; nothing else in the system updates them.
 */
@Injectable()
export class AttemptsService {
  constructor(
    @InjectRepository(DeliveryAttempt)
    private readonly attempts: Repository<DeliveryAttempt>,
  ) {}

  async start(eventId: string, attemptNumber: number, startedAt = new Date()): Promise<DeliveryAttempt> {
    const attempt = this.attempts.create({
      eventId,
      attemptNumber,
      startedAt,
      status: AttemptStatus.IN_PROGRESS,
      completedAt: null,
      httpStatus: null,
      errorType: null,
      errorMessage: null,
    });
    return this.attempts.save(attempt);
  }

  async complete(attemptId: string, completion: AttemptCompletion): Promise<void> {
    await this.attempts.update(attemptId, {
      status: completion.status,
      httpStatus: completion.httpStatus ?? null,
      errorType: completion.errorType ?? null,
      errorMessage: truncate(completion.errorMessage),
      completedAt: completion.completedAt ?? new Date(),
    });
  }

  /**
   * Close out attempts left in flight by a crashed worker so the timeline shows
   * what actually happened instead of a row that never ends.
   */
  async closeAbandoned(eventId: string, reason: string): Promise<number> {
    const result = await this.attempts.update(
      { eventId, status: AttemptStatus.IN_PROGRESS, completedAt: IsNull() },
      {
        status: AttemptStatus.FAILED,
        errorType: DeliveryErrorType.WORKER_CRASH,
        errorMessage: reason,
        completedAt: new Date(),
      },
    );
    return result.affected ?? 0;
  }

  findByEventId(eventId: string): Promise<DeliveryAttempt[]> {
    return this.attempts.find({ where: { eventId }, order: { attemptNumber: 'ASC' } });
  }

  /** Latest attempt per event, used to render "Last Error" in the event list. */
  async findLatestForEvents(eventIds: string[]): Promise<Map<string, DeliveryAttempt>> {
    if (eventIds.length === 0) return new Map();

    const rows = await this.attempts.find({
      where: { eventId: In(eventIds) },
      order: { attemptNumber: 'ASC' },
    });

    const latest = new Map<string, DeliveryAttempt>();
    for (const row of rows) {
      latest.set(row.eventId, row);
    }
    return latest;
  }

  countAll(): Promise<number> {
    return this.attempts.count();
  }
}

function truncate(message?: string | null): string | null {
  if (!message) return null;
  return message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
}
