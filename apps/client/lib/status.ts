import type { DeliveryStatus } from '@/types';

export interface StatusPresentation {
  label: string;
  /** Paired with the colour so state never depends on hue alone. */
  icon: string;
  color: string;
  tint: string;
  border: string;
  description: string;
}

/**
 * Status roles map onto the reserved status palette (good / warning / critical).
 * PENDING and DELIVERING are informational rather than severities, so they take
 * muted ink and the single series hue instead of a status colour.
 */
export const STATUS_PRESENTATION: Record<DeliveryStatus, StatusPresentation> = {
  PENDING: {
    label: 'Pending',
    icon: '◷',
    color: 'var(--text-secondary)',
    tint: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)',
    border: 'color-mix(in srgb, var(--text-secondary) 35%, transparent)',
    description: 'Queued in the database, waiting for the worker to claim it.',
  },
  DELIVERING: {
    label: 'Delivering',
    icon: '◆',
    color: 'var(--series-1)',
    tint: 'color-mix(in srgb, var(--series-1) 12%, transparent)',
    border: 'color-mix(in srgb, var(--series-1) 40%, transparent)',
    description: 'A worker holds the lease and the HTTP request is in flight.',
  },
  RETRYING: {
    label: 'Retrying',
    icon: '↻',
    color: 'var(--status-warning)',
    tint: 'color-mix(in srgb, var(--status-warning) 16%, transparent)',
    border: 'color-mix(in srgb, var(--status-warning) 45%, transparent)',
    description: 'A retryable failure was recorded and the next attempt is scheduled.',
  },
  DELIVERED: {
    label: 'Delivered',
    icon: '✓',
    color: 'var(--status-good)',
    tint: 'color-mix(in srgb, var(--status-good) 12%, transparent)',
    border: 'color-mix(in srgb, var(--status-good) 40%, transparent)',
    description: 'The receiver answered 2xx. Terminal state.',
  },
  FAILED: {
    label: 'Failed',
    icon: '✕',
    color: 'var(--status-critical)',
    tint: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
    border: 'color-mix(in srgb, var(--status-critical) 40%, transparent)',
    description: 'Permanently failed, or the retry budget was spent. Terminal state.',
  },
};

/** Colour role for an HTTP status code in the distribution chart. */
export function httpStatusRole(code: number): { color: string; label: string } {
  if (code >= 200 && code < 300) return { color: 'var(--status-good)', label: 'Success' };
  if (code === 408 || code === 429 || code >= 500)
    return { color: 'var(--status-warning)', label: 'Retryable' };
  return { color: 'var(--status-critical)', label: 'Permanent' };
}
