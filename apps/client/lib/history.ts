import type { EventSummary, RealtimeEvent, RealtimeEventType } from '@/types';

const STATUS_TO_TYPE: Record<EventSummary['status'], RealtimeEventType> = {
  PENDING: 'event.accepted',
  DELIVERING: 'delivery.started',
  RETRYING: 'delivery.retry_scheduled',
  DELIVERED: 'delivery.succeeded',
  FAILED: 'delivery.failed',
};

/**
 * Seed the activity feed from the authoritative event list.
 *
 * The websocket only carries what happens while the dashboard is connected, so
 * a freshly opened tab would otherwise show an empty feed after a busy period.
 * These entries are derived from REST, marked as history, and pushed below
 * anything that arrives live.
 */
export function historyFromEvents(events: EventSummary[], limit = 15): RealtimeEvent[] {
  return events.slice(0, limit).map((event) => ({
    type: STATUS_TO_TYPE[event.status],
    eventId: event.eventId,
    eventType: event.type,
    status: event.status,
    attemptNumber: event.attemptCount,
    maxAttempts: event.maxAttempts,
    nextAttemptAt: event.nextAttemptAt,
    httpStatus: event.lastError?.httpStatus ?? null,
    errorMessage: event.lastError?.message ?? null,
    emittedAt: event.updatedAt,
    historical: true,
    message: describe(event),
  }));
}

function describe(event: EventSummary): string {
  const error = event.lastError
    ? ` (last response ${event.lastError.httpStatus ?? event.lastError.errorType})`
    : '';

  switch (event.status) {
    case 'PENDING':
      return 'accepted, waiting for the first delivery attempt';
    case 'DELIVERING':
      return `delivery attempt #${event.attemptCount} in flight`;
    case 'RETRYING':
      return `retrying after ${event.attemptCount} of ${event.maxAttempts} attempts${error}`;
    case 'DELIVERED':
      return `delivered on attempt #${event.attemptCount}`;
    case 'FAILED':
      return event.attemptCount >= event.maxAttempts
        ? `failed after ${event.attemptCount} attempts, retry limit reached${error}`
        : `failed permanently, no retry scheduled${error}`;
    default:
      return 'state unknown';
  }
}
