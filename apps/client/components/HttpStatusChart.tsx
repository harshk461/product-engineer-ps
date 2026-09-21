import { httpStatusRole } from '@/lib/status';
import type { DashboardStats } from '@/types';

const LEGEND = [
  { label: 'Success (2xx)', color: 'var(--status-good)' },
  { label: 'Retryable (408, 429, 5xx)', color: 'var(--status-warning)' },
  { label: 'Permanent (other 4xx)', color: 'var(--status-critical)' },
];

/**
 * Counts per HTTP status code the receiver has returned.
 *
 * Horizontal bars because the categories are labelled text of varying length,
 * one value each. Every bar carries its code and its count as a direct label,
 * so the colour only reinforces the retry classification rather than carrying it.
 */
export function HttpStatusChart({ stats }: { stats: DashboardStats | null }) {
  const entries = Object.entries(stats?.httpStatusDistribution ?? {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  const max = entries.reduce((peak, [, count]) => Math.max(peak, count), 0);

  return (
    <section className="card" aria-label="HTTP status distribution">
      <header className="card-header">
        <h2 className="card-title">Receiver responses</h2>
        <span className="text-xs text-muted">{stats?.attempts.total ?? 0} attempts</span>
      </header>

      <div className="px-4 py-3">
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No delivery attempts yet. Submit an event to see responses here.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {entries.map(([code, count]) => {
              const role = httpStatusRole(Number(code));
              const width = max === 0 ? 0 : Math.max(2, (count / max) * 100);

              return (
                <li key={code} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-3">
                  <span className="font-mono text-sm tabular-nums text-ink-2" title={role.label}>
                    {code}
                  </span>
                  <span className="h-2.5 w-full overflow-hidden rounded-full bg-raised">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${width}%`, background: role.color }}
                      title={`${code} · ${role.label} · ${count}`}
                    />
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-ink">
                    {count}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
