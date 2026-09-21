import { Injectable, Logger } from '@nestjs/common';
import { RealtimeEvent, RealtimeEventType } from '../common/realtime-event';
import { RealtimeGateway } from './realtime.gateway';

/**
 * The seam every module publishes through.
 *
 * Domain services depend on this, not on the gateway, so a broken socket layer
 * can never fail a delivery: emits are best-effort and swallowed on error.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  publish(event: Omit<RealtimeEvent, 'emittedAt'> & { emittedAt?: string }): RealtimeEvent {
    const enriched: RealtimeEvent = {
      ...event,
      emittedAt: event.emittedAt ?? new Date().toISOString(),
    };

    try {
      this.gateway.publish(enriched);
    } catch (error) {
      this.logger.warn(
        `Failed to publish ${enriched.type} for ${enriched.eventId}: ${(error as Error).message}`,
      );
    }

    return enriched;
  }
}

export { RealtimeEventType };
