import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeBottom } from '@/lib/safeArea';
import { colors, motion, radius, sp, text } from '@/theme';

/**
 * A single, transient, bottom-center toast. One line, auto-dismisses after two
 * seconds, never blocks touches (the overlay is pointerEvents="none"). Used for
 * lightweight confirmations where an Alert would be too heavy (and Alert does
 * not work on web anyway).
 */
interface ToastContextValue {
  show(message: string): void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safeBottom = useSafeBottom();

  const show = useCallback(
    (msg: string) => {
      setMessage(msg);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: motion.fade.duration, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: motion.fade.duration, useNativeDriver: true }).start(
          ({ finished }) => {
            if (finished) setMessage(null);
          }
        );
      }, 2000);
    },
    [opacity]
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message !== null && (
        // Clears the 54px tab bar plus the home-indicator inset so the toast
        // never sits on top of the bar's labels.
        <View pointerEvents="none" style={[styles.overlay, { paddingBottom: 54 + safeBottom + sp.lg }]}>
          <Animated.View style={[styles.toast, { opacity }]}>
            <Text style={styles.toastText}>{message}</Text>
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // Espresso on cream reversed: ink chip, cream text. Small confirmations were
  // barely readable as muted-on-cream; this reads at a glance.
  toast: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: sp.md,
    paddingHorizontal: sp.lg,
    maxWidth: '90%',
  },
  toastText: { ...text.body, fontWeight: '500', color: colors.onRose, textAlign: 'center' },
});
