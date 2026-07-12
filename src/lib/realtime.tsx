import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import * as Ably from 'ably';
import { apiUrl } from './api';
import { useAuth } from './auth';

type Listener = (data: any) => void;

interface RealtimeContextValue {
  subscribe(event: string, listener: Listener): () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({ subscribe: () => () => {} });

/**
 * One Ably connection per session, one private channel per couple.
 * Token auth via /api/ably-token — the API key never reaches the client.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const listeners = useRef<Map<string, Set<Listener>>>(new Map());
  const coupleId = user?.couple_id ?? null;

  useEffect(() => {
    if (!coupleId || !token) return;
    const client = new Ably.Realtime({
      authUrl: apiUrl('/api/ably-token'),
      authHeaders: { Authorization: `Bearer ${token}` },
      authMethod: 'GET',
    });
    const channel = client.channels.get(`couple:${coupleId}`);
    const handler = (msg: Ably.Message) => {
      const set = listeners.current.get(msg.name ?? '');
      if (set) set.forEach((fn) => fn(msg.data));
    };
    channel.subscribe(handler);
    return () => {
      channel.unsubscribe(handler);
      client.close();
    };
  }, [coupleId, token]);

  const subscribe = useCallback((event: string, listener: Listener) => {
    let set = listeners.current.get(event);
    if (!set) {
      set = new Set();
      listeners.current.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }, []);

  return <RealtimeContext.Provider value={{ subscribe }}>{children}</RealtimeContext.Provider>;
}

/** Subscribe to a couple-channel event for the lifetime of the component. */
export function useCoupleEvent(event: string, listener: Listener) {
  const { subscribe } = useContext(RealtimeContext);
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => subscribe(event, (data) => ref.current(data)), [event, subscribe]);
}
