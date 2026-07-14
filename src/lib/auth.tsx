import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken } from './api';
import { loadToken, saveToken } from './storage';

export interface User {
  id: string;
  email: string;
  display_name: string;
  couple_id: string | null;
  notifications_enabled: boolean;
}

export interface Couple {
  id: string;
  invite_code: string;
  created_at: string;
}

export interface Partner {
  id: string;
  display_name: string;
}

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: Status;
  user: User | null;
  couple: Couple | null;
  partner: Partner | null;
  token: string | null;
  encryption: boolean; // server confirms envelope encryption at rest is active
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  refresh(): Promise<void>;
  createSpace(): Promise<Couple>;
  joinSpace(code: string): Promise<void>;
  updateProfile(patch: { displayName?: string; notificationsEnabled?: boolean }): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [encryption, setEncryption] = useState(false);

  const applySession = useCallback(async (newToken: string, newUser: User) => {
    setAuthToken(newToken);
    await saveToken(newToken);
    setToken(newToken);
    setUser(newUser);
    setStatus('signedIn');
  }, []);

  const clearSession = useCallback(async () => {
    setAuthToken(null);
    await saveToken(null);
    setToken(null);
    setUser(null);
    setCouple(null);
    setPartner(null);
    setEncryption(false);
    setStatus('signedOut');
  }, []);

  const refresh = useCallback(async () => {
    const data = await api<{ user: User; couple: Couple | null; partner: Partner | null; encryption?: boolean }>(
      '/api/auth/me'
    );
    setUser(data.user);
    setCouple(data.couple);
    setPartner(data.partner);
    setEncryption(!!data.encryption);
  }, []);

  // Hydrate the session on launch.
  useEffect(() => {
    (async () => {
      const stored = await loadToken();
      if (!stored) {
        setStatus('signedOut');
        return;
      }
      setAuthToken(stored);
      setToken(stored);
      try {
        await refresh();
        setStatus('signedIn');
      } catch {
        await clearSession();
      }
    })();
  }, [refresh, clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      couple,
      partner,
      token,
      encryption,
      async signUp(email, password, displayName) {
        const data = await api<{ token: string; user: User }>('/api/auth/signup', {
          method: 'POST',
          body: { email, password, displayName },
        });
        await applySession(data.token, data.user);
      },
      async signIn(email, password) {
        const data = await api<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        await applySession(data.token, data.user);
        await refresh().catch(() => {});
      },
      async signOut() {
        await clearSession();
      },
      async deleteAccount() {
        await api('/api/auth/account', { method: 'DELETE' });
        await clearSession();
      },
      refresh,
      async createSpace() {
        const data = await api<{ couple: Couple }>('/api/couple/create', { method: 'POST' });
        await refresh();
        return data.couple;
      },
      async joinSpace(code) {
        await api('/api/couple/join', { method: 'POST', body: { code } });
        await refresh();
      },
      async updateProfile(patch) {
        const data = await api<{ user: User }>('/api/auth/profile', { method: 'PATCH', body: patch });
        setUser(data.user);
      },
    }),
    [status, user, couple, partner, token, encryption, applySession, clearSession, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
