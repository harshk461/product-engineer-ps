'use client';

import Link from 'next/link';
import { useEngineState } from '@/hooks/useEngineState';
import { StatsOverview } from '@/components/StatsOverview';
import { EventTable } from '@/components/EventTable';
import { ActivityFeed } from '@/components/ActivityFeed';
import { HttpStatusChart } from '@/components/HttpStatusChart';
import { ReceiverControls } from '@/components/ReceiverControls';
import { SubmitEventForm } from '@/components/SubmitEventForm';
import { ConnectionIndicator } from '@/components/ConnectionIndicator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { API_URL } from '@/lib/api';

export default function DashboardPage() {
  const { stats, events, feed, receiver, connection, error, loading, refresh, setReceiver } =
    useEngineState();

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Webhook Delivery Overview
          </h1>
          <p className="text-sm text-muted">
            Ingestion, retries and delivery state — read from the engine, not the browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionIndicator state={connection} />
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => void refresh()}>
            Refresh
          </button>
          <ThemeToggle />
        </div>
      </header>

      {connection === 'offline' && (
        <Banner
          tone="var(--status-warning)"
          title="Live updates paused"
          body="The websocket is disconnected. The engine keeps delivering; this view re-reads the authoritative state from REST as soon as it reconnects."
        />
      )}

      {error && (
        <Banner
          tone="var(--status-critical)"
          title="Cannot reach the engine"
          body={`${error} — expected the API at ${API_URL}. Check that the server is running.`}
        />
      )}

      <StatsOverview stats={stats} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <EventTable events={events} />
          <HttpStatusChart stats={stats} />
        </div>

        <div className="space-y-4">
          <ActivityFeed feed={feed} />
          <ReceiverControls receiver={receiver} onChange={setReceiver} />
          <SubmitEventForm />
        </div>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-xs text-muted">
        <span>
          {loading ? 'Loading…' : `Snapshot ${stats ? new Date(stats.generatedAt).toLocaleTimeString() : '—'}`}
          {stats && ` · ${stats.realtime.connectedClients} dashboard(s) connected`}
        </span>
        <span>
          Engine at <span className="font-mono">{API_URL}</span> ·{' '}
          <Link href="/events/evt_123" className="text-info hover:underline">
            event detail example
          </Link>
        </span>
      </footer>
    </main>
  );
}

function Banner({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div
      className="mb-4 rounded-lg border px-4 py-3"
      style={{
        borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`,
        background: `color-mix(in srgb, ${tone} 10%, transparent)`,
      }}
      role="status"
    >
      <p className="text-sm font-semibold" style={{ color: tone }}>
        {title}
      </p>
      <p className="mt-0.5 text-xs text-ink-2">{body}</p>
    </div>
  );
}
