import { formatClock, formatDuration } from '@/lib/format';
import type { DeliveryAttempt } from '@/types';

const PRESENTATION = {
  SUCCESS: { icon: '✓', color: 'var(--status-good)', label: 'Success' },
  FAILED: { icon: '✕', color: 'var(--status-critical)', label: 'Failed' },
  IN_PROGRESS: { icon: '◆', color: 'var(--series-1)', label: 'In flight' },
} as const;

/** The immutable attempt log for one event, newest last. */
export function AttemptTimeline({ attempts }: { attempts: DeliveryAttempt[] }) {
  return (
    <section className="card" aria-label="Attempt history">
      <header className="card-header">
        <h2 className="card-title">Attempt history</h2>
        <span className="text-xs text-muted">{attempts.length} recorded</span>
      </header>

      {attempts.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No attempts yet.</p>
      ) : (
        <ol className="divide-y divide-hairline">
          {attempts.map((attempt) => {
            const presentation = PRESENTATION[attempt.status];
            const duration =
              attempt.completedAt !== null
                ? new Date(attempt.completedAt).getTime() - new Date(attempt.startedAt).getTime()
                : null;

            return (
              <li key={attempt.id} className="flex gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    color: presentation.color,
                    background: `color-mix(in srgb, ${presentation.color} 14%, transparent)`,
                  }}
                >
                  {presentation.icon}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-ink">
                      Attempt {attempt.attemptNumber}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: presentation.color }}>
                      {presentation.label}
                    </span>
                    {attempt.httpStatus !== null && (
                      <span className="font-mono text-xs tabular-nums text-ink-2">
                        HTTP {attempt.httpStatus}
                      </span>
                    )}
                    {attempt.errorType && (
                      <span className="text-xs text-muted">{attempt.errorType}</span>
                    )}
                  </div>

                  <div className="mt-0.5 text-xs tabular-nums text-muted">
                    started {formatClock(attempt.startedAt)}
                    {attempt.completedAt && ` · completed ${formatClock(attempt.completedAt)}`}
                    {duration !== null && ` · ${formatDuration(duration)}`}
                  </div>

                  {attempt.errorMessage && (
                    <p className="mt-1 break-words rounded-md bg-raised px-2 py-1 font-mono text-[11px] text-ink-2">
                      {attempt.errorMessage}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
