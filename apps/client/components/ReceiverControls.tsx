'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { ReceiverMode, ReceiverState } from '@/types';

const MODES: Array<{ value: ReceiverMode; description: string }> = [
  { value: 'SUCCESS', description: 'Always answers 200. Delivery completes on attempt 1.' },
  { value: 'FAIL_ONCE', description: 'Fails the first delivery of an event, then succeeds.' },
  { value: 'FAIL_ALWAYS', description: 'Fails every delivery until the retry budget is spent.' },
];

const FAILURE_STATUSES = [
  { value: 503, label: '503 Service Unavailable — retryable' },
  { value: 500, label: '500 Internal Server Error — retryable' },
  { value: 429, label: '429 Too Many Requests — retryable' },
  { value: 408, label: '408 Request Timeout — retryable' },
  { value: 400, label: '400 Bad Request — permanent' },
  { value: 401, label: '401 Unauthorized — permanent' },
  { value: 404, label: '404 Not Found — permanent' },
  { value: 422, label: '422 Unprocessable Entity — permanent' },
];

/**
 * Demo-only control surface.
 *
 * It configures the bundled test receiver through the backend API. The
 * dashboard holds no delivery logic: changing a mode here only changes how the
 * receiver answers, never how the engine retries.
 */
export function ReceiverControls({
  receiver,
  onChange,
}: {
  receiver: ReceiverState | null;
  onChange: (next: ReceiverState) => void;
}) {
  const [mode, setMode] = useState<ReceiverMode | null>(null);
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMode = mode ?? receiver?.config.mode ?? 'SUCCESS';
  const currentStatus = failureStatus ?? receiver?.config.failureStatus ?? 503;
  const currentLatency = latencyMs ?? receiver?.config.latencyMs ?? 0;

  async function apply(resetState: boolean) {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await api.updateReceiver({
          mode: currentMode,
          failureStatus: currentStatus,
          latencyMs: currentLatency,
          resetState,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Test receiver">
      <header className="card-header">
        <h2 className="card-title">Test receiver</h2>
        <span className="text-xs text-muted">demo control</span>
      </header>

      <div className="space-y-3 px-4 py-3">
        <label className="block">
          <span className="label">Mode</span>
          <select
            className="field mt-1"
            value={currentMode}
            onChange={(event) => setMode(event.target.value as ReceiverMode)}
          >
            {MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            {MODES.find((option) => option.value === currentMode)?.description}
          </span>
        </label>

        <label className="block">
          <span className="label">Failure status</span>
          <select
            className="field mt-1"
            value={currentStatus}
            disabled={currentMode === 'SUCCESS'}
            onChange={(event) => setFailureStatus(Number(event.target.value))}
          >
            {FAILURE_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            Retryable codes consume the retry budget; permanent codes stop after one attempt.
          </span>
        </label>

        <label className="block">
          <span className="label">Response delay (ms)</span>
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            className="field mt-1"
            value={currentLatency}
            onChange={(event) => setLatencyMs(Number(event.target.value))}
          />
          <span className="mt-1 block text-xs text-muted">
            Exceed the engine&apos;s HTTP timeout to demonstrate transport-level retries.
          </span>
        </label>

        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => apply(false)}>
            {busy ? 'Applying…' : 'Apply'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => apply(true)}
            title="Also clears the receiver's memory of which events it has already seen"
          >
            Apply &amp; reset
          </button>
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--status-critical)' }}>{error}</p>}

        {receiver && (
          <dl className="grid grid-cols-3 gap-2 border-t border-hairline pt-3 text-center">
            <Stat label="Received" value={receiver.stats.totalReceived} />
            <Stat label="Unique" value={receiver.stats.uniqueEvents} />
            <Stat
              label="Duplicates"
              value={receiver.stats.duplicateDeliveries}
              hint="Deliveries the receiver had already seen — at-least-once in action"
            />
          </dl>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="label">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
