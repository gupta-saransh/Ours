import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { tapHaptic } from '@/lib/haptics';
import { useSafeBottom } from '@/lib/safeArea';
import { useFabMenuOpen } from '@/lib/fabMenu';
import { colors, sp } from '@/theme';

/**
 * Chat launcher: a round button parked directly above the add FAB, carrying an
 * unread dot. Opens the full chat screen (`/chat`). Only shown once you have a
 * partner, and only on the main tab routes (like the FAB). Hides while the add
 * menu is expanded so it never overlaps the action column.
 *
 * The geometry constants mirror AddMenu.tsx; keep the two in step.
 */

const FAB_SIZE = 56;
const FAB_RIGHT = sp.xl;
const CHAT_SIZE = 52;

const VISIBLE_ON = new Set(['/', '/memories', '/notes', '/dates', '/wishlist', '/milestones']);

export function ChatButton() {
  const { user, partner } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const safeBottom = useSafeBottom();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const menuOpen = useFabMenuOpen();
  const [hasUnread, setHasUnread] = useState(false);

  const visible = !!partner && VISIBLE_ON.has(pathname);

  // Refresh the unread badge on mount and whenever we land back on a main route
  // (e.g. returning from the chat, which has just marked everything read).
  useEffect(() => {
    if (!partner || !VISIBLE_ON.has(pathname)) return;
    api<{ unread: number }>('/api/messages/unread')
      .then((d) => setHasUnread(d.unread > 0))
      .catch(() => {});
  }, [partner, pathname]);

  // A message from the partner lights the dot immediately.
  useCoupleEvent('message.created', (m) => {
    if (m?.sender_id && m.sender_id !== user?.id) setHasUnread(true);
  });

  if (!visible || menuOpen) return null;

  const fabBottom = wide ? safeBottom + sp.xl : safeBottom + 54 + sp.base;
  const bottom = fabBottom + FAB_SIZE + sp.md;
  const right = FAB_RIGHT + (FAB_SIZE - CHAT_SIZE) / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        onPress={() => {
          tapHaptic();
          setHasUnread(false);
          router.push('/chat');
        }}
        accessibilityRole="button"
        accessibilityLabel="Open chat"
        style={[styles.button, { right, bottom }]}
      >
        <MessageCircle size={22} color={colors.surfaceSealed} strokeWidth={1.75} />
        {hasUnread && <View style={styles.dot} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    width: CHAT_SIZE,
    height: CHAT_SIZE,
    borderRadius: CHAT_SIZE / 2,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surfaceSealed,
    borderWidth: 1.5,
    borderColor: colors.surfaceRaised,
  },
});
