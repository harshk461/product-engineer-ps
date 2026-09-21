import { Fragment } from 'react';
import { formatClock } from '@/lib/format';
import type { RealtimeEvent, RealtimeEventType } from '@/types';

/** Icon + colour per event type; the written message always carries the meaning. */
const PRESENTATION: Record<RealtimeEventType, { icon: string; color: string }> = {
  'event.accepted': { icon: '＋', color: 'var(--series-1)' },
  'duplicate.event': { icon: '⧉', color: 'var(--text-secondary)' },
  'delivery.started': { icon: '→', color: 'var(--series-1)' },
  'delivery.succeeded': { icon: '✓', color: 'var(--status-good)' },
  'delivery.failed': { icon: '✕', color: 'var(--status-critical)' },
  'delivery.retry_scheduled': { icon: '↻', color: 'var(--status-warning)' },
  'delivery.exhausted': { icon: '⊘', color: 'var(--status-critical)' },
  'delivery.recovered': { icon: '⚑', color: 'var(--status-serious)' },
  'receiver.delivery_received': { icon: '◇', color: 'var(--text-muted)' },
  'receiver.config_changed': { icon: '⚙', color: 'var(--text-muted)' },
};

export function ActivityFeed({ feed }: { feed: RealtimeEvent[] }) {
  return (
    <section className="card flex flex-col" aria-label="Live activity">
      <header className="card-header">
        <h2 className="card-title">Live activity</h2>
        <span className="text-xs text-muted">websocket</span>
      </header>

      <ol className="max-h-[26rem] min-h-[9rem] overflow-y-auto px-2 py-2">
        {feed.length === 0 && (
          <li className="px-2 py-8 text-center text-sm text-muted">
            Waiting for engine activity…
          </li>
        )}

        {feed.map((entry, index) => {
          const presentation = PRESENTATION[entry.type] ?? {
            icon: '•',
            color: 'var(--text-muted)',
          };

          // Mark where the live stream ends and the reconstructed history begins.
          const startsHistory = entry.historical && !feed[index - 1]?.historical;

          return (
            <Fragment key={`${entry.emittedAt}-${entry.type}-${entry.eventId}-${index}`}>
              {startsHistory && (
                <li className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted">
                  {index === 0 ? 'Recent history' : 'Earlier — from event history'}
                </li>
              )}
            <li
              className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-raised"
              style={entry.historical ? { opacity: 0.65 } : undefined}
              title={entry.historical ? 'Reconstructed from the event history' : undefined}
            >
              <span className="pt-0.5 font-mono text-[11px] tabular-nums text-muted">
                {formatClock(entry.emittedAt)}
              </span>
              <span aria-hidden="true" style={{ color: presentation.color }} className="pt-0.5">
                {presentation.icon}
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
                {entry.eventId !== '-' && (
                  <span className="mr-1.5 font-mono text-[12px] text-ink">{entry.eventId}</span>
                )}
                {entry.message}
              </span>
            </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
