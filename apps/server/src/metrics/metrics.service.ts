import { Injectable } from '@nestjs/common';

export interface MetricsSnapshot {
  counters: Record<string, number>;
  httpStatusDistribution: Record<string, number>;
  averageWorkerProcessingMs: number | null;
  averageAttemptDurationMs: number | null;
  averageDeliveryLatencyMs: number | null;
  uptimeSeconds: number;
}

const ROLLING_WINDOW = 500;

/**
 * Deliberately small in-process metrics registry.
 *
 * The assignment calls for production-style observability without a Prometheus
 * stack, so counters live here and are exposed through /dashboard/stats.
 * Durable, historical numbers are computed from the database instead.
 */
@Injectable()
export class MetricsService {
  static readonly EVENTS_ACCEPTED = 'events_accepted';
  static readonly EVENTS_DUPLICATE = 'events_duplicate';
  static readonly DELIVERY_ATTEMPTS = 'delivery_attempts';
  static readonly DELIVERIES_SUCCEEDED = 'deliveries_succeeded';
  static readonly FAILURES_RETRYABLE = 'failures_retryable';
  static readonly FAILURES_PERMANENT = 'failures_permanent';
  static readonly DELIVERIES_EXHAUSTED = 'deliveries_exhausted';
  static readonly RETRIES_SCHEDULED = 'retries_scheduled';
  static readonly JOBS_RECOVERED = 'jobs_recovered';
  static readonly WORKER_TICKS = 'worker_ticks';

  private readonly counters = new Map<string, number>();
  private readonly httpStatuses = new Map<number, number>();
  private readonly workerProcessingMs: number[] = [];
  private readonly attemptDurationsMs: number[] = [];
  private readonly deliveryLatenciesMs: number[] = [];
  private readonly startedAt = Date.now();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  recordHttpStatus(status: number): void {
    this.httpStatuses.set(status, (this.httpStatuses.get(status) ?? 0) + 1);
  }

  recordWorkerProcessing(durationMs: number): void {
    push(this.workerProcessingMs, durationMs);
  }

  recordAttemptDuration(durationMs: number): void {
    push(this.attemptDurationsMs, durationMs);
  }

  /** Wall-clock time from ingestion to successful delivery, retries included. */
  recordDeliveryLatency(latencyMs: number): void {
    push(this.deliveryLatenciesMs, latencyMs);
  }

  counter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      httpStatusDistribution: Object.fromEntries(
        [...this.httpStatuses.entries()]
          .sort(([a], [b]) => a - b)
          .map(([status, count]) => [String(status), count]),
      ),
      averageWorkerProcessingMs: average(this.workerProcessingMs),
      averageAttemptDurationMs: average(this.attemptDurationsMs),
      averageDeliveryLatencyMs: average(this.deliveryLatenciesMs),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  reset(): void {
    this.counters.clear();
    this.httpStatuses.clear();
    this.workerProcessingMs.length = 0;
    this.attemptDurationsMs.length = 0;
    this.deliveryLatenciesMs.length = 0;
  }
}

function push(window: number[], value: number): void {
  window.push(value);
  if (window.length > ROLLING_WINDOW) window.shift();
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
