import type {
  DashboardStats,
  EventDetail,
  EventSummary,
  IngestResponse,
  ReceiverConfig,
  ReceiverState,
} from '@/types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return (await response.json()) as T;
}

/**
 * REST is the authoritative read path. The dashboard calls these on load, on
 * every websocket reconnect, and to reconcile after live updates.
 */
export const api = {
  stats: () => call<DashboardStats>('/dashboard/stats'),

  events: (limit = 50) => call<{ items: EventSummary[]; total: number }>(`/events?limit=${limit}`),

  event: (eventId: string) => call<EventDetail>(`/events/${encodeURIComponent(eventId)}`),

  submitEvent: (body: { eventId: string; type: string; occurredAt: string; payload: unknown }) =>
    call<IngestResponse>('/events', { method: 'POST', body: JSON.stringify(body) }),

  receiver: () => call<ReceiverState>('/test-receiver/config'),

  updateReceiver: (patch: Partial<ReceiverConfig> & { resetState?: boolean }) =>
    call<ReceiverState>('/test-receiver/config', { method: 'POST', body: JSON.stringify(patch) }),
};
