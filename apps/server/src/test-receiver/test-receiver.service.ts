import { Injectable, Logger } from '@nestjs/common';
import { RealtimeEventType } from '../common/realtime-event';
import { RealtimePublisher } from '../realtime/realtime.publisher';

export enum ReceiverMode {
  SUCCESS = 'SUCCESS',
  FAIL_ONCE = 'FAIL_ONCE',
  FAIL_ALWAYS = 'FAIL_ALWAYS',
}

export interface ReceiverConfig {
  mode: ReceiverMode;
  /** Status returned when the mode says to fail. 503 demos a retryable failure, 400 a permanent one. */
  failureStatus: number;
  /** Artificial delay; set above WEBHOOK_TIMEOUT_MS to demonstrate timeout handling. */
  latencyMs: number;
}

export interface ReceiverStats {
  totalReceived: number;
  uniqueEvents: number;
  duplicateDeliveries: number;
  lastReceivedAt: string | null;
}

export interface ReceiverDecision {
  status: number;
  body: Record<string, unknown>;
}

/**
 * A local stand-in for a customer's webhook endpoint.
 *
 * It exists so failures can be produced on demand during a demo. It is not part
 * of the delivery engine: the engine only knows a URL, and pointing
 * WEBHOOK_TARGET_URL elsewhere changes nothing about how delivery behaves.
 *
 * It also keys on eventId, which is what a real at-least-once receiver must do.
 */
@Injectable()
export class TestReceiverService {
  private readonly logger = new Logger(TestReceiverService.name);

  private config: ReceiverConfig = {
    mode: ReceiverMode.SUCCESS,
    failureStatus: 503,
    latencyMs: 0,
  };

  private readonly deliveriesByEvent = new Map<string, number>();
  private totalReceived = 0;
  private duplicateDeliveries = 0;
  private lastReceivedAt: Date | null = null;

  constructor(private readonly realtime: RealtimePublisher) {}

  getConfig(): ReceiverConfig {
    return { ...this.config };
  }

  getStats(): ReceiverStats {
    return {
      totalReceived: this.totalReceived,
      uniqueEvents: this.deliveriesByEvent.size,
      duplicateDeliveries: this.duplicateDeliveries,
      lastReceivedAt: this.lastReceivedAt?.toISOString() ?? null,
    };
  }

  updateConfig(patch: Partial<ReceiverConfig> & { resetState?: boolean }): ReceiverConfig {
    const { resetState, ...configPatch } = patch;
    this.config = { ...this.config, ...configPatch };

    if (resetState) {
      this.deliveriesByEvent.clear();
      this.totalReceived = 0;
      this.duplicateDeliveries = 0;
      this.lastReceivedAt = null;
    }

    this.logger.log(`Receiver mode set to ${this.config.mode} (status ${this.config.failureStatus})`);
    this.realtime.publish({
      type: RealtimeEventType.RECEIVER_CONFIG_CHANGED,
      eventId: '-',
      message: `Test receiver set to ${this.config.mode}${
        this.config.mode === ReceiverMode.SUCCESS ? '' : ` returning ${this.config.failureStatus}`
      }`,
    });

    return this.getConfig();
  }

  async handleDelivery(eventId: string | undefined, attemptHeader: string | undefined): Promise<ReceiverDecision> {
    const key = eventId ?? 'unknown';
    const previousDeliveries = this.deliveriesByEvent.get(key) ?? 0;
    this.deliveriesByEvent.set(key, previousDeliveries + 1);
    this.totalReceived += 1;
    this.lastReceivedAt = new Date();
    const isDuplicate = previousDeliveries > 0;
    if (isDuplicate) this.duplicateDeliveries += 1;

    if (this.config.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
    }

    const decision = this.decide(previousDeliveries);

    this.realtime.publish({
      type: RealtimeEventType.RECEIVER_DELIVERY_RECEIVED,
      eventId: key,
      httpStatus: decision.status,
      duplicate: isDuplicate,
      attemptNumber: attemptHeader ? Number(attemptHeader) : undefined,
      message: isDuplicate
        ? `Receiver saw ${key} again (at-least-once duplicate) and answered ${decision.status}`
        : `Receiver handled ${key} and answered ${decision.status}`,
    });

    return decision;
  }

  private decide(previousDeliveries: number): ReceiverDecision {
    switch (this.config.mode) {
      case ReceiverMode.FAIL_ALWAYS:
        return { status: this.config.failureStatus, body: { ok: false, mode: this.config.mode } };
      case ReceiverMode.FAIL_ONCE:
        return previousDeliveries === 0
          ? { status: this.config.failureStatus, body: { ok: false, mode: this.config.mode } }
          : { status: 200, body: { ok: true, mode: this.config.mode, recoveredAfterFailure: true } };
      case ReceiverMode.SUCCESS:
      default:
        return { status: 200, body: { ok: true, mode: this.config.mode } };
    }
  }
}
