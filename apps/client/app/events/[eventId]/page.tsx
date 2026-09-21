'use client';

import Link from 'next/link';
import { use } from 'react';
import { useEventDetail } from '@/hooks/useEventDetail';
import { StatusBadge } from '@/components/StatusBadge';
import { RetryFlow } from '@/components/RetryFlow';
import { AttemptTimeline } from '@/components/AttemptTimeline';
import { ActivityFeed } from '@/components/ActivityFeed';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatCountdown, formatDateTime, secondsUntil } from '@/lib/format';
import { useNow } from '@/hooks/useNow';

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { event, timeline, loading, error } = useEventDetail(decodeURIComponent(eventId));
  const now = useNow();

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-info hover:underline">
            ← Back to overview
          </Link>
          <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight text-ink">
            {decodeURIComponent(eventId)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {event && <StatusBadge status={event.status} />}
          <ThemeToggle />
        </div>
      </header>

      {loading && <p className="text-sm text-muted">Loading event…</p>}
      {error && (
        <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {event && (
        <div className="space-y-4">
          <RetryFlow event={event} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="card" aria-label="Event information">
              <header className="card-header">
                <h2 className="card-title">Event information</h2>
              </header>
              <dl className="divide-y divide-hairline text-sm">
                <Row label="Type" value={event.type} />
                <Row label="Occurred at" value={formatDateTime(event.occurredAt)} />
                <Row label="Ingested at" value={formatDateTime(event.createdAt)} />
                <Row label="Attempts" value={`${event.attemptCount} of ${event.maxAttempts}`} />
                <Row label="Attempts remaining" value={String(event.attemptsRemaining)} />
                <Row
                  label="Next attempt"
                  value={
                    event.nextAttemptAt
                      ? `${formatDateTime(event.nextAttemptAt)} · ${formatCountdown(
                          secondsUntil(event.nextAttemptAt, now),
                        )}`
                      : 'none scheduled'
                  }
                />
                <div className="px-4 py-2.5">
                  <dt className="label">Payload</dt>
                  <dd>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-raised p-2.5 font-mono text-[11px] text-ink-2">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </dd>
                </div>
              </dl>
            </section>

            <AttemptTimeline attempts={event.attempts} />
          </div>

          {/* Only shown once something happens live: the attempt history above
              already carries the complete, authoritative record. */}
          {timeline.length > 0 && <ActivityFeed feed={[...timeline].reverse()} />}
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className="label">{label}</dt>
      <dd className="text-right text-ink-2">{value}</dd>
    </div>
  );
}
