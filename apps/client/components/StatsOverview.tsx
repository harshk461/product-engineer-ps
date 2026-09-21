import { formatDuration } from '@/lib/format';
import { STATUS_PRESENTATION } from '@/lib/status';
import type { DashboardStats, DeliveryStatus } from '@/types';

const TILES: Array<{ key: keyof DashboardStats['totals']; label: string; status?: DeliveryStatus }> = [
  { key: 'events', label: 'Total events' },
  { key: 'delivered', label: 'Delivered', status: 'DELIVERED' },
  { key: 'retrying', label: 'Retrying', status: 'RETRYING' },
  { key: 'failed', label: 'Failed', status: 'FAILED' },
  { key: 'pending', label: 'Pending', status: 'PENDING' },
];

/**
 * Five headline numbers. These are stat tiles rather than a chart: each is a
 * single magnitude whose job is to be read, not compared across a scale.
 */
export function StatsOverview({ stats }: { stats: DashboardStats | null }) {
  return (
    <section aria-label="Webhook delivery overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map((tile) => {
          const presentation = tile.status ? STATUS_PRESENTATION[tile.status] : null;
          const value = stats?.totals[tile.key];

          return (
            <div key={tile.key} className="card px-4 py-3" title={presentation?.description}>
              <div className="flex items-center gap-1.5">
                {presentation && (
                  <span aria-hidden="true" style={{ color: presentation.color }} className="text-sm">
                    {presentation.icon}
                  </span>
                )}
                <span className="label">{tile.label}</span>
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-ink">
                {value ?? '—'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Success rate"
          value={stats?.delivery.successRate === null || stats === null ? '—' : `${stats.delivery.successRate}%`}
          hint="Delivered as a share of events that reached a terminal state"
        />
        <Metric
          label="Avg delivery latency"
          value={formatDuration(stats?.delivery.averageDeliveryLatencyMs)}
          hint="Ingestion to successful delivery, retries included"
        />
        <Metric
          label="Attempts / event"
          value={stats ? stats.attempts.averagePerEvent.toFixed(2) : '—'}
          hint={`${stats?.attempts.total ?? 0} HTTP attempts recorded in total`}
        />
        <Metric
          label="Duplicates ignored"
          value={String(stats?.counters.events_duplicate ?? 0)}
          hint="Repeat submissions that did not create a second event or delivery job"
        />
      </div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="label">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
