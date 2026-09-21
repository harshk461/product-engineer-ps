import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, auditTime } from 'rxjs';
import { EventEntity } from '../events/entities/event.entity';
import { DeliveryAttempt } from '../attempts/entities/delivery-attempt.entity';
import { DeliveryStatus } from '../common/delivery-status.enum';
import { AttemptStatus } from '../common/attempt.enums';
import { MetricsService, MetricsSnapshot } from '../metrics/metrics.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RetryPolicy } from '../delivery/retry-policy';

export interface DashboardStats {
  totals: {
    events: number;
    pending: number;
    delivering: number;
    retrying: number;
    delivered: number;
    failed: number;
  };
  attempts: {
    total: number;
    succeeded: number;
    failed: number;
    inProgress: number;
    averagePerEvent: number;
  };
  delivery: {
    maxAttempts: number;
    /** Ingestion -> successful delivery, measured over recent delivered events. */
    averageDeliveryLatencyMs: number | null;
    averageAttemptDurationMs: number | null;
    averageWorkerTickMs: number | null;
    successRate: number | null;
  };
  httpStatusDistribution: Record<string, number>;
  counters: MetricsSnapshot['counters'];
  realtime: { connectedClients: number };
  generatedAt: string;
}

const LATENCY_SAMPLE_SIZE = 500;

/**
 * Read-side aggregation for the dashboard.
 *
 * Numbers come from the database (authoritative, survives restarts) merged with
 * in-process counters (cheap, process-lifetime). It also pushes a fresh
 * snapshot whenever the engine emits activity, throttled so a burst of
 * deliveries cannot turn into a burst of aggregate queries.
 */
@Injectable()
export class DashboardService implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(
    @InjectRepository(EventEntity)
    private readonly events: Repository<EventEntity>,
    @InjectRepository(DeliveryAttempt)
    private readonly attempts: Repository<DeliveryAttempt>,
    private readonly metrics: MetricsService,
    private readonly gateway: RealtimeGateway,
    private readonly retryPolicy: RetryPolicy,
  ) {}

  onModuleInit(): void {
    this.subscription = this.gateway.activity$
      .pipe(auditTime(250))
      .subscribe(() => void this.broadcast());
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private async broadcast(): Promise<void> {
    try {
      this.gateway.broadcastStats(await this.getStats());
    } catch {
      // Statistics are observability, never a reason to disturb delivery.
    }
  }

  async getStats(): Promise<DashboardStats> {
    const [statusRows, attemptRows, totalEvents, latency] = await Promise.all([
      this.events
        .createQueryBuilder('event')
        .select('event.status', 'status')
        .addSelect('COUNT(1)', 'count')
        .groupBy('event.status')
        .getRawMany<{ status: DeliveryStatus; count: string | number }>(),
      this.attempts
        .createQueryBuilder('attempt')
        .select('attempt.status', 'status')
        .addSelect('COUNT(1)', 'count')
        .groupBy('attempt.status')
        .getRawMany<{ status: AttemptStatus; count: string | number }>(),
      this.events.count(),
      this.averageDeliveryLatencyMs(),
    ]);

    const byStatus = toCountMap(statusRows);
    const byAttemptStatus = toCountMap(attemptRows);
    const attemptsTotal = sum(byAttemptStatus);
    const succeeded = byAttemptStatus[AttemptStatus.SUCCESS] ?? 0;
    const failedAttempts = byAttemptStatus[AttemptStatus.FAILED] ?? 0;
    const snapshot = this.metrics.snapshot();
    const settled =
      (byStatus[DeliveryStatus.DELIVERED] ?? 0) + (byStatus[DeliveryStatus.FAILED] ?? 0);

    return {
      totals: {
        events: totalEvents,
        pending: byStatus[DeliveryStatus.PENDING] ?? 0,
        delivering: byStatus[DeliveryStatus.DELIVERING] ?? 0,
        retrying: byStatus[DeliveryStatus.RETRYING] ?? 0,
        delivered: byStatus[DeliveryStatus.DELIVERED] ?? 0,
        failed: byStatus[DeliveryStatus.FAILED] ?? 0,
      },
      attempts: {
        total: attemptsTotal,
        succeeded,
        failed: failedAttempts,
        inProgress: byAttemptStatus[AttemptStatus.IN_PROGRESS] ?? 0,
        averagePerEvent: totalEvents === 0 ? 0 : round(attemptsTotal / totalEvents, 2),
      },
      delivery: {
        maxAttempts: this.retryPolicy.maxAttempts,
        averageDeliveryLatencyMs: latency,
        averageAttemptDurationMs: snapshot.averageAttemptDurationMs,
        averageWorkerTickMs: snapshot.averageWorkerProcessingMs,
        successRate:
          settled === 0 ? null : round(((byStatus[DeliveryStatus.DELIVERED] ?? 0) / settled) * 100, 1),
      },
      httpStatusDistribution: snapshot.httpStatusDistribution,
      counters: snapshot.counters,
      realtime: { connectedClients: this.gateway.connectionCount },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Computed in JS over a bounded sample rather than in SQL, because date
   * arithmetic is one of the few things MySQL and SQLite spell differently and
   * this number is not worth a driver branch.
   */
  private async averageDeliveryLatencyMs(): Promise<number | null> {
    const successes = await this.attempts.find({
      where: { status: AttemptStatus.SUCCESS },
      order: { completedAt: 'DESC' },
      take: LATENCY_SAMPLE_SIZE,
    });
    if (successes.length === 0) return null;

    const eventIds = successes.map((attempt) => attempt.eventId);
    const events = await this.events
      .createQueryBuilder('event')
      .where('event.eventId IN (:...eventIds)', { eventIds })
      .getMany();
    const createdAt = new Map(events.map((event) => [event.eventId, event.createdAt.getTime()]));

    const latencies = successes
      .filter((attempt) => attempt.completedAt && createdAt.has(attempt.eventId))
      .map((attempt) => attempt.completedAt!.getTime() - createdAt.get(attempt.eventId)!)
      .filter((value) => value >= 0);

    if (latencies.length === 0) return null;
    return Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length);
  }
}

function toCountMap<T extends string>(rows: Array<{ status: T; count: string | number }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
