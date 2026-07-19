import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import * as Ably from 'ably';
import { apiUrl } from './api';
import { useAuth } from './auth';

type Listener = (data: any) => void;

interface RealtimeContextValue {
  subscribe(event: string, listener: Listener): () => void;
  enterPresence(data: Record<string, unknown>): void;
  leavePresence(): void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  subscribe: () => () => {},
  enterPresence: () => {},
  leavePresence: () => {},
});

/**
 * One Ably connection per session, one private channel per couple.
 * Token auth via /api/ably-token — the API key never reaches the client.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const listeners = useRef<Map<string, Set<Listener>>>(new Map());
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const coupleId = user?.couple_id ?? null;

  useEffect(() => {
    if (!coupleId || !token) return;
    const client = new Ably.Realtime({
      authUrl: apiUrl('/api/ably-token'),
      authHeaders: { Authorization: `Bearer ${token}` },
      authMethod: 'GET',
    });
    const channel = client.channels.get(`couple:${coupleId}`);
    channelRef.current = channel;
    const handler = (msg: Ably.Message) => {
      const set = listeners.current.get(msg.name ?? '');
      if (set) set.forEach((fn) => fn(msg.data));
    };
    channel.subscribe(handler);
    return () => {
      channel.unsubscribe(handler);
      channelRef.current = null;
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

  // Best-effort: if the channel has not attached yet (a screen mounted the
  // instant the app opened, before the token round-trip finished), this is a
  // silent no-op rather than a queued retry. Worst case is one extra push in
  // a race that lasts a fraction of a second; isActiveInChat on the server
  // already fails open the same way.
  const enterPresence = useCallback((data: Record<string, unknown>) => {
    channelRef.current?.presence.enter(data).catch(() => {});
  }, []);
  const leavePresence = useCallback(() => {
    channelRef.current?.presence.leave().catch(() => {});
  }, []);

  return (
    <RealtimeContext.Provider value={{ subscribe, enterPresence, leavePresence }}>{children}</RealtimeContext.Provider>
  );
}

/** Subscribe to a couple-channel event for the lifetime of the component. */
export function useCoupleEvent(event: string, listener: Listener) {
  const { subscribe } = useContext(RealtimeContext);
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => subscribe(event, (data) => ref.current(data)), [event, subscribe]);
}

/**
 * Marks presence with `data` for as long as `active` stays true, and always
 * leaves on unmount. Chat uses this (tagged `{ screen: 'chat' }`) so the
 * server can tell "is this person looking at the chat right now" and skip the
 * push notification for a message they're about to see arrive live.
 */
export function useChatPresence(active: boolean, data: Record<string, unknown>) {
  const { enterPresence, leavePresence } = useContext(RealtimeContext);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!active) return;
    enterPresence(dataRef.current);
    return () => leavePresence();
  }, [active, enterPresence, leavePresence]);
}
