import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { useCoupleEvent } from './realtime';

export interface Notification {
  id: string;
  actor_id: string;
  kind: 'nudge' | 'memory' | 'note' | 'milestone' | 'partner' | 'bucket';
  text: string;
  created_at: string;
}

interface NotificationsContextValue {
  unseen: number;
  markSeen(): Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unseen: 0,
  markSeen: async () => {},
});

/** Tracks the unread count for the bell; the live dot updates over Ably. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    if (!user?.couple_id) return;
    api<{ unseen: number }>('/api/notifications')
      .then((data) => setUnseen(data.unseen))
      .catch(() => {});
  }, [user?.couple_id]);

  useCoupleEvent('notification', (n) => {
    if (n?.actor_id && n.actor_id !== user?.id) setUnseen((c) => c + 1);
  });

  const markSeen = useCallback(async () => {
    setUnseen(0);
    await api('/api/notifications', { method: 'POST' }).catch(() => {});
  }, []);

  return (
    <NotificationsContext.Provider value={{ unseen, markSeen }}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
