import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';

export interface WorkerTickResult {
  recovered: number;
  claimed: number;
  processed: number;
  durationMs: number;
}

/**
 * The delivery executor.
 *
 * It holds no queue of its own. Every tick it asks MySQL what is due, claims
 * what it can, and runs it. Restarting the process loses nothing, and running
 * several instances is safe because claiming is a conditional UPDATE.
 *
 * The loop is a self-rescheduling timer rather than a fixed interval so a slow
 * tick can never overlap the next one.
 */
@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;
  private lastTickAt: Date | null = null;

  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryService: DeliveryService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.worker.enabled) {
      this.logger.warn('Delivery worker disabled (WORKER_ENABLED=false)');
      return;
    }
    this.logger.log(
      `Delivery worker ${this.config.worker.id} polling every ${this.config.worker.pollIntervalMs}ms`,
    );
    this.scheduleNextTick(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get status(): { enabled: boolean; id: string; lastTickAt: string | null; running: boolean } {
    return {
      enabled: this.config.worker.enabled,
      id: this.config.worker.id,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      running: this.ticking,
    };
  }

  /**
   * One full pass: recover crashed leases, then drain what is due.
   * Public so tests can drive the engine deterministically instead of sleeping.
   */
  async runOnce(): Promise<WorkerTickResult> {
    const startedAt = Date.now();
    this.ticking = true;
    this.lastTickAt = new Date();
    this.metrics.increment(MetricsService.WORKER_TICKS);

    const { batchSize, id: workerId } = this.config.worker;
    let claimed = 0;
    let processed = 0;

    try {
      const recovered = await this.deliveryService.recoverStaleJobs(batchSize);
      const dueJobIds = await this.deliveryRepository.findDueJobIds(batchSize);

      for (const jobId of dueJobIds) {
        if (this.stopped) break;

        // Another worker may have taken this job between the read and here;
        // claim() returning null simply means we lost the race.
        const job = await this.deliveryRepository.claim(jobId, workerId);
        if (!job) continue;
        claimed += 1;

        try {
          await this.deliveryService.executeClaimedJob(job);
          processed += 1;
        } catch (error) {
          // The job stays in DELIVERING and is picked up by lease recovery, so
          // an unexpected error can never silently drop a delivery.
          this.logger.error(
            `Unhandled error processing job ${job.id} (${job.eventId}): ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      const durationMs = Date.now() - startedAt;
      this.metrics.recordWorkerProcessing(durationMs);
      return { recovered, claimed, processed, durationMs };
    } finally {
      this.ticking = false;
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(`Worker tick failed: ${(error as Error).message}`, (error as Error).stack);
    } finally {
      this.scheduleNextTick(this.config.worker.pollIntervalMs);
    }
  }
}
