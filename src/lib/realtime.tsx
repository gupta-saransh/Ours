import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Ably from 'ably';
import { apiUrl } from './api';
import { useAuth } from './auth';

type Listener = (data: any) => void;
type PresenceListener = (member: Ably.PresenceMessage) => void;

interface RealtimeContextValue {
  subscribe(event: string, listener: Listener): () => void;
  enterPresence(data: Record<string, unknown>): void;
  updatePresence(data: Record<string, unknown>): void;
  leavePresence(): void;
  subscribePresence(listener: PresenceListener): () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  subscribe: () => () => {},
  enterPresence: () => {},
  updatePresence: () => {},
  leavePresence: () => {},
  subscribePresence: () => () => {},
});

/**
 * One Ably connection per session, one private channel per couple.
 * Token auth via /api/ably-token — the API key never reaches the client.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const listeners = useRef<Map<string, Set<Listener>>>(new Map());
  const presenceListeners = useRef<Set<PresenceListener>>(new Set());
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
    const presenceHandler: PresenceListener = (member) => {
      presenceListeners.current.forEach((fn) => fn(member));
    };
    channel.presence.subscribe(presenceHandler);
    return () => {
      channel.unsubscribe(handler);
      channel.presence.unsubscribe(presenceHandler);
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

  const subscribePresence = useCallback((listener: PresenceListener) => {
    presenceListeners.current.add(listener);
    return () => {
      presenceListeners.current.delete(listener);
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
  // Updates the SAME member's presence data (e.g. "now typing") without a
  // full leave/enter cycle, which would otherwise flap the couple channel's
  // enter/leave events for every keystroke.
  const updatePresence = useCallback((data: Record<string, unknown>) => {
    channelRef.current?.presence.update(data).catch(() => {});
  }, []);
  const leavePresence = useCallback(() => {
    channelRef.current?.presence.leave().catch(() => {});
  }, []);

  return (
    <RealtimeContext.Provider value={{ subscribe, enterPresence, updatePresence, leavePresence, subscribePresence }}>
      {children}
    </RealtimeContext.Provider>
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
  const { enterPresence, updatePresence, leavePresence } = useContext(RealtimeContext);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!active) return;
    enterPresence(dataRef.current);
    return () => leavePresence();
  }, [active, enterPresence, leavePresence]);

  // Lets the screen layer extra fields (e.g. "typing") on top of the base
  // presence data, live, without a full leave/enter cycle. A no-op while not
  // active, so a caller does not need to gate every call on `active` itself.
  return useCallback(
    (extra: Record<string, unknown>) => {
      if (active) updatePresence({ ...dataRef.current, ...extra });
    },
    [active, updatePresence]
  );
}

/**
 * The partner's live presence data on the couple channel (their `enterPresence`/
 * `updatePresence` payload), or null when they are not present at all. Used
 * for the "X is typing…" / "X is recording a voice note…" line above the
 * chat composer: the sender writes `{ screen: 'chat', activity }` via
 * useChatPresence's update function, and this hook is how the OTHER side
 * reads it back. Purely ephemeral (Ably presence, not a database write): it
 * clears itself the moment the sender updates again or leaves/disconnects.
 */
export function usePartnerPresence(): Record<string, unknown> | null {
  const { subscribePresence } = useContext(RealtimeContext);
  const { user } = useAuth();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const myId = user?.id;

  useEffect(() => {
    setData(null);
    return subscribePresence((member) => {
      if (!myId || member.clientId === myId) return; // ignore my own presence
      if (member.action === 'leave' || member.action === 'absent') {
        setData(null);
      } else {
        setData((member.data as Record<string, unknown>) ?? null);
      }
    });
  }, [subscribePresence, myId]);

  return data;
}
