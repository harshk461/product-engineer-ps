'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, API_URL } from '@/lib/api';
import { historyFromEvents } from '@/lib/history';
import type { DashboardStats, EventSummary, RealtimeEvent, ReceiverState } from '@/types';

const MAX_FEED_ENTRIES = 120;
const RECONCILE_DEBOUNCE_MS = 250;

export type ConnectionState = 'connecting' | 'live' | 'offline';

export interface EngineState {
  stats: DashboardStats | null;
  events: EventSummary[];
  feed: RealtimeEvent[];
  receiver: ReceiverState | null;
  connection: ConnectionState;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setReceiver: (state: ReceiverState) => void;
}

/**
 * The dashboard's data contract with the engine.
 *
 * REST is authoritative: the full state is fetched on mount and re-fetched
 * whenever the socket (re)connects, so a dropped connection can only ever cost
 * liveness, never correctness. Websocket messages drive the activity feed and
 * trigger a debounced reconciliation read -- they are treated as a hint that
 * something changed, not as the new state.
 */
export function useEngineState(): EngineState {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [receiver, setReceiverState] = useState<ReceiverState | null>(null);
  const [feed, setFeed] = useState<RealtimeEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStats, nextEvents, nextReceiver] = await Promise.all([
        api.stats(),
        api.events(),
        api.receiver(),
      ]);
      setStats(nextStats);
      setEvents(nextEvents.items);
      // Only seeds an empty feed; live entries are never displaced by history.
      setFeed((current) =>
        current.length === 0 ? historyFromEvents(nextEvents.items) : current,
      );
      setReceiverState(nextReceiver);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => {
      void refresh();
    }, RECONCILE_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    void refresh();

    const socket: Socket = io(`${API_URL}/realtime`, {
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });

    socket.on('connect', () => {
      setConnection('live');
      // Anything that happened while we were away is read back from REST.
      void refresh();
    });
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));

    socket.on('activity', (event: RealtimeEvent) => {
      setFeed((current) => [event, ...current].slice(0, MAX_FEED_ENTRIES));
      applyOptimisticPatch(setEvents, event);
      scheduleReconcile();
    });

    // The server pushes a fresh aggregate after each burst of activity.
    socket.on('stats', (next: DashboardStats) => setStats(next));

    return () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [refresh, scheduleReconcile]);

  const setReceiver = useCallback((next: ReceiverState) => setReceiverState(next), []);

  return useMemo(
    () => ({ stats, events, feed, receiver, connection, error, loading, refresh, setReceiver }),
    [stats, events, feed, receiver, connection, error, loading, refresh, setReceiver],
  );
}

/**
 * Paint the row immediately so a transition is visible the moment it happens.
 * The debounced REST read that follows overwrites this with authoritative data.
 */
function applyOptimisticPatch(
  setEvents: React.Dispatch<React.SetStateAction<EventSummary[]>>,
  event: RealtimeEvent,
): void {
  if (!event.status || event.eventId === '-') return;

  setEvents((current) => {
    const index = current.findIndex((row) => row.eventId === event.eventId);
    if (index === -1) return current;

    const row = current[index];
    const next: EventSummary = {
      ...row,
      status: event.status ?? row.status,
      attemptCount: event.attemptNumber ?? row.attemptCount,
      nextAttemptAt: event.nextAttemptAt !== undefined ? event.nextAttemptAt : row.nextAttemptAt,
      lastError:
        event.type === 'delivery.succeeded'
          ? null
          : event.httpStatus || event.errorMessage
            ? {
                httpStatus: event.httpStatus ?? null,
                errorType: event.errorType ?? null,
                message: event.errorMessage ?? null,
              }
            : row.lastError,
    };

    const copy = [...current];
    copy[index] = next;
    return copy;
  });
}
