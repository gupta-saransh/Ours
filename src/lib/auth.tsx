import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api, setAuthToken } from './api';
import { loadToken, saveToken } from './storage';
import { isThemePresetId, persistThemePreset, themePreset } from '@/theme';

export interface User {
  id: string;
  email: string;
  display_name: string;
  couple_id: string | null;
  notifications_enabled: boolean;
  avatar?: string | null; // mark id (src/components/Avatar.tsx); absent on signup/login responses
}

export interface Couple {
  id: string;
  invite_code: string;
  created_at: string;
  theme_preset: string | null; // shared: either partner sets it, both wear it
}

export interface Partner {
  id: string;
  /** The name to show for the partner: their nickname if you set one, else their real name. */
  display_name: string;
  realName?: string;
  /** The pet name you gave them (null if none). Only you see it. */
  nickname?: string | null;
  avatar?: string | null;
}

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: Status;
  user: User | null;
  couple: Couple | null;
  partner: Partner | null;
  token: string | null;
  encryption: boolean; // server confirms envelope encryption at rest is active
  encryptionCode: string | null; // "seal code": same for both partners, derived from the couple's key
  /** True only for a brand new signup that has not finished the first-run flow. */
  needsOnboarding: boolean;
  /** `ref` is a friend-referral code from a /sign-up?ref= link, if any. */
  signUp(email: string, password: string, displayName: string, ref?: string | null): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  refresh(): Promise<void>;
  createSpace(): Promise<Couple>;
  joinSpace(code: string): Promise<void>;
  updateProfile(patch: {
    displayName?: string;
    notificationsEnabled?: boolean;
    themePreset?: string;
    avatar?: string | null;
    partnerNickname?: string | null;
    /** Marks the first-run flow finished. One way, set only by onboarding. */
    onboarded?: boolean;
  }): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [encryption, setEncryption] = useState(false);
  const [encryptionCode, setEncryptionCode] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

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
    setEncryptionCode(null);
    setStatus('signedOut');
  }, []);

  const refresh = useCallback(async () => {
    const data = await api<{
      user: User;
      couple: Couple | null;
      partner: Partner | null;
      encryption?: boolean;
      encryptionCode?: string | null;
      needsOnboarding?: boolean;
    }>('/api/auth/me');
    setUser(data.user);
    setCouple(data.couple);
    setPartner(data.partner);
    setEncryption(!!data.encryption);
    setEncryptionCode(data.encryptionCode ?? null);
    // Absent (pre-v17 server) means "already onboarded": never trap an existing
    // account in the first-run flow.
    setNeedsOnboarding(!!data.needsOnboarding);
    // The couple's shared preset bakes into module-scope styles at bundle
    // evaluation, so a look either partner chose (on any device) applies here
    // via one reload on the next app load.
    const shared = data.couple?.theme_preset;
    if (Platform.OS === 'web' && isThemePresetId(shared) && shared !== themePreset) {
      persistThemePreset(shared);
      if (typeof window !== 'undefined') window.location.reload();
    }
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
      encryptionCode,
      needsOnboarding,
      async signUp(email, password, displayName, ref) {
        const data = await api<{ token: string; user: User }>('/api/auth/signup', {
          method: 'POST',
          body: { email, password, displayName, ref: ref || undefined },
        });
        await applySession(data.token, data.user);
        // A fresh signup always owes the first-run flow. Set locally so the
        // redirect fires before /auth/me has a chance to come back.
        setNeedsOnboarding(true);
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
        if (patch.onboarded) setNeedsOnboarding(false);
      },
    }),
    [
      status,
      user,
      couple,
      partner,
      token,
      encryption,
      encryptionCode,
      needsOnboarding,
      applySession,
      clearSession,
      refresh,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
