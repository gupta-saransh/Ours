import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'ours.session';

// SecureStore on device, localStorage on web.
export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return (globalThis as any).localStorage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (token) (globalThis as any).localStorage?.setItem(TOKEN_KEY, token);
      else (globalThis as any).localStorage?.removeItem(TOKEN_KEY);
    } catch {
      // private browsing — session just won't persist
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}
