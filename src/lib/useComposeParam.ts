import { useEffect, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';

/**
 * Opens a screen's composer when the universal AddMenu deep-links here. The
 * AddMenu passes a fresh `compose` nonce on every press, so this fires each
 * time even if we were already on the tab. Tracks the last handled nonce in a
 * ref, so it never re-fires on unrelated re-renders or tab refocus.
 */
export function useComposeParam(onCompose: () => void): void {
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const last = useRef<string | undefined>(undefined);
  const cb = useRef(onCompose);
  cb.current = onCompose;
  useEffect(() => {
    if (compose && compose !== last.current) {
      last.current = compose;
      cb.current();
    }
  }, [compose]);
}
