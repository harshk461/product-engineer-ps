'use client';

import Link from 'next/link';
import { StatusBadge } from './StatusBadge';
import { formatClock, formatCountdown, secondsUntil } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import type { EventSummary } from '@/types';

export function EventTable({ events }: { events: EventSummary[] }) {
  const now = useNow();

  return (
    <section className="card" aria-label="Events">
      <header className="card-header">
        <h2 className="card-title">Events</h2>
        <span className="text-xs text-muted">{events.length} shown</span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left">
              {['Event ID', 'Type', 'Status', 'Attempts', 'Created', 'Next attempt', 'Last error'].map(
                (heading) => (
                  <th key={heading} className="whitespace-nowrap px-4 py-2 label font-medium">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                  No events yet. Submit one to watch it move through the pipeline.
                </td>
              </tr>
            )}

            {events.map((event) => {
              const countdown =
                event.status === 'RETRYING' || event.status === 'PENDING'
                  ? secondsUntil(event.nextAttemptAt, now)
                  : null;

              return (
                <tr key={event.eventId} className="border-b border-hairline last:border-0 hover:bg-raised">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link
                      href={`/events/${encodeURIComponent(event.eventId)}`}
                      className="font-mono text-[13px] text-info hover:underline"
                    >
                      {event.eventId}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{event.type}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={event.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">
                    {event.attemptCount} / {event.maxAttempts}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">
                    {formatClock(event.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">
                    {event.nextAttemptAt ? (
                      <span title={new Date(event.nextAttemptAt).toLocaleString()}>
                        {formatClock(event.nextAttemptAt)}
                        {countdown !== null && (
                          <span className="ml-1.5 text-xs text-muted">{formatCountdown(countdown)}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-2.5 text-ink-2" title={event.lastError?.message ?? ''}>
                    {event.lastError ? (
                      <span style={{ color: 'var(--status-critical)' }}>
                        {event.lastError.httpStatus ?? event.lastError.errorType}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {event.lastError?.message && (
                      <span className="ml-1.5 text-muted">{event.lastError.message}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
