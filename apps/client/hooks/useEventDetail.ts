'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, API_URL } from '@/lib/api';
import type { EventDetail, RealtimeEvent } from '@/types';

export interface EventDetailState {
  event: EventDetail | null;
  timeline: RealtimeEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Detail view for a single event. Same contract as the overview: REST holds the
 * truth, the socket says when to read it again.
 */
export function useEventDetail(eventId: string): EventDetailState {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [timeline, setTimeline] = useState<RealtimeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEvent(await api.event(eventId));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void refresh();

    const socket: Socket = io(`${API_URL}/realtime`, { transports: ['websocket'] });
    socket.on('connect', () => void refresh());
    socket.on('activity', (incoming: RealtimeEvent) => {
      if (incoming.eventId !== eventId) return;
      setTimeline((current) => [...current, incoming]);
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      reconcileTimer.current = setTimeout(() => void refresh(), 200);
    });

    return () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [eventId, refresh]);

  return { event, timeline, loading, error, refresh };
}
