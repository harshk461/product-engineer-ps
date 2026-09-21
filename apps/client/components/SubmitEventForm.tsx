'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { IngestResponse } from '@/types';

const DEFAULT_PAYLOAD = '{\n  "incidentId": "inc_456",\n  "severity": "high"\n}';

function suggestEventId(): string {
  return `evt_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Submits an event through POST /events.
 *
 * "Submit again" re-sends the same eventId deliberately: it is how the
 * idempotency guarantee is demonstrated from the UI.
 */
export function SubmitEventForm() {
  const [eventId, setEventId] = useState(suggestEventId);
  const [type, setType] = useState('incident.created');
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD);
  const [results, setResults] = useState<IngestResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(reuseId: boolean) {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const id = reuseId ? eventId : suggestEventId();
      if (!reuseId) setEventId(id);

      const response = await api.submitEvent({
        eventId: id,
        type,
        occurredAt: new Date().toISOString(),
        payload: parsed,
      });
      setResults((current) => [response, ...current].slice(0, 5));
    } catch (cause) {
      setError(cause instanceof SyntaxError ? `Payload is not valid JSON: ${cause.message}` : (cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Submit event">
      <header className="card-header">
        <h2 className="card-title">Submit an event</h2>
        <span className="text-xs text-muted">POST /events</span>
      </header>

      <div className="space-y-3 px-4 py-3">
        <label className="block">
          <span className="label">Event ID (idempotency key)</span>
          <input
            className="field mt-1 font-mono"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="label">Type</span>
          <input className="field mt-1" value={type} onChange={(event) => setType(event.target.value)} />
        </label>

        <label className="block">
          <span className="label">Payload</span>
          <textarea
            className="field mt-1 h-24 font-mono text-xs"
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => submit(false)}>
            Submit new event
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => submit(true)}
            title="Re-send the same eventId to prove that duplicates create no second delivery"
          >
            Submit same ID again
          </button>
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--status-critical)' }}>{error}</p>}

        {results.length > 0 && (
          <ul className="space-y-1 border-t border-hairline pt-3 text-xs">
            {results.map((result, index) => (
              <li key={`${result.eventId}-${index}`} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  style={{ color: result.duplicate ? 'var(--text-secondary)' : 'var(--status-good)' }}
                >
                  {result.duplicate ? '⧉' : '＋'}
                </span>
                <span className="text-ink-2">
                  <span className="font-mono text-ink">{result.eventId}</span>{' '}
                  {result.duplicate ? 'existing event detected — no new delivery job' : 'accepted — delivery scheduled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
