import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, CalendarHeart, Dices, Gift, Heart, Hourglass, Image as ImageIcon, ListChecks, MessageCircle, Sparkles, StickyNote } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useCoupleEvent } from '@/lib/realtime';
import { useNotifications, type Notification } from '@/lib/notifications';
import { useAuth } from '@/lib/auth';
import { PressableCard, Empty, ErrorState, Screen, Skeleton } from '@/components/kit';
import { colors, sp, text } from '@/theme';
import { formatDay, formatTime } from '@/lib/format';

const KIND_ICON: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  nudge: Heart,
  memory: ImageIcon,
  note: StickyNote,
  milestone: Hourglass,
  partner: Sparkles,
  bucket: ListChecks,
  prompt: MessageCircle,
  capsule: Hourglass,
  date: CalendarHeart,
  wishlist: Gift,
  comment: MessageCircle,
  game: Dices,
};

// Where each notification deep-links on tap (mirrors api/_lib/notification-routes.ts).
const KIND_ROUTE: Record<string, string> = {
  nudge: '/',
  memory: '/timeline',
  note: '/timeline',
  milestone: '/milestones',
  partner: '/',
  bucket: '/wishlist',
  prompt: '/prompts',
  capsule: '/timeline',
  date: '/dates',
  wishlist: '/wishlist',
  comment: '/timeline',
  game: '/',
  todo: '/todos',
};

export default function Notifications() {
  const { user, partner } = useAuth();
  const router = useRouter();
  const { markSeen } = useNotifications();

  // Notification text is generated server-side with the partner's real name.
  // Every notification here is about the partner's action, so swap in the pet
  // name you gave them (if any) to match the rest of the app.
  const withNickname = (t: string) =>
    partner?.nickname && partner.realName ? t.split(partner.realName).join(partner.nickname) : t;
  const [items, setItems] = useState<Notification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [seenAt, setSeenAt] = useState<string>(new Date().toISOString());

  useEffect(() => {
    api<{ notifications: Notification[]; seenAt: string }>('/api/notifications')
      .then((data) => {
        setItems(data.notifications);
        setSeenAt(data.seenAt);
        // Give the unread dots a beat before clearing them.
        setTimeout(() => markSeen().catch(() => {}), 500);
      })
      .catch(() => setFailed(true));
  }, [markSeen]);

  useCoupleEvent('notification', (n: Notification) => {
    if (n?.actor_id === user?.id) return;
    setItems((prev) => (prev ? [n, ...prev.filter((x) => x.id !== n.id)] : prev));
  });

  if (failed && !items) {
    return (
      <Screen>
        <ErrorState
          onRetry={() => {
            setFailed(false);
            api<{ notifications: Notification[]; seenAt: string }>('/api/notifications')
              .then((d) => {
                setItems(d.notifications);
                setSeenAt(d.seenAt);
              })
              .catch(() => setFailed(true));
          }}
        />
      </Screen>
    );
  }
  if (!items) {
    return (
      <Screen>
        <View style={styles.list}>
          <Skeleton height={64} style={{ marginBottom: sp.md }} />
          <Skeleton height={64} style={{ marginBottom: sp.md }} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Empty line="All quiet for now. What your person does will gather here." />
        }
        renderItem={({ item }) => {
          const fresh = new Date(item.created_at) > new Date(seenAt);
          const Icon = KIND_ICON[item.kind] ?? Bell;
          const target = KIND_ROUTE[item.kind] ?? '/';
          return (
            <PressableCard onPress={() => router.push(target as any)} style={[styles.row, fresh && styles.rowFresh]}>
              <Icon size={18} color={fresh ? colors.surfaceSealed : colors.inkFaint} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={text.body}>{withNickname(item.text)}</Text>
                <Text style={text.caption}>
                  {formatDay(item.created_at)}, {formatTime(item.created_at)}
                </Text>
              </View>
              {fresh && <View style={styles.freshDot} />}
            </PressableCard>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.base,
    marginBottom: sp.md,
    padding: sp.base,
  },
  rowFresh: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  freshDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceSealed },
});
