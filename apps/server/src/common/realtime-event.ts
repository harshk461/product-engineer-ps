import { DeliveryStatus } from './delivery-status.enum';
import { DeliveryErrorType, FailureClassification } from './attempt.enums';

export enum RealtimeEventType {
  EVENT_ACCEPTED = 'event.accepted',
  DUPLICATE_EVENT = 'duplicate.event',
  DELIVERY_STARTED = 'delivery.started',
  DELIVERY_SUCCEEDED = 'delivery.succeeded',
  DELIVERY_FAILED = 'delivery.failed',
  DELIVERY_RETRY_SCHEDULED = 'delivery.retry_scheduled',
  DELIVERY_EXHAUSTED = 'delivery.exhausted',
  DELIVERY_RECOVERED = 'delivery.recovered',
  RECEIVER_DELIVERY_RECEIVED = 'receiver.delivery_received',
  RECEIVER_CONFIG_CHANGED = 'receiver.config_changed',
}

/**
 * The payload pushed to the dashboard. It carries enough context for the UI to
 * update a row without a refetch, but it is *not* the system of record -- the
 * dashboard always re-reads authoritative state from REST on (re)connect.
 */
export interface RealtimeEvent {
  type: RealtimeEventType;
  eventId: string;
  /** Human readable line for the activity feed. */
  message: string;
  emittedAt: string;
  status?: DeliveryStatus;
  eventType?: string;
  attemptNumber?: number;
  maxAttempts?: number;
  httpStatus?: number | null;
  errorType?: DeliveryErrorType | null;
  errorMessage?: string | null;
  classification?: FailureClassification;
  nextAttemptAt?: string | null;
  attemptsRemaining?: number;
  durationMs?: number;
  duplicate?: boolean;
}

/** Socket.IO channel every realtime event is published on. */
export const REALTIME_ACTIVITY_CHANNEL = 'activity';
/** Socket.IO channel carrying aggregate dashboard statistics. */
export const REALTIME_STATS_CHANNEL = 'stats';
export const REALTIME_NAMESPACE = '/realtime';
