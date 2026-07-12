import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useCoupleEvent } from '@/lib/realtime';
import { useNotifications, type Notification } from '@/lib/notifications';
import { useAuth } from '@/lib/auth';
import { Card, EmptyState } from '@/components/ui';
import { colors, font, space, type } from '@/theme';
import { formatDay, formatTime } from '@/lib/format';

const KIND_GLYPH: Record<Notification['kind'], string> = {
  nudge: '♥',
  memory: '✧',
  note: '✎',
  milestone: '◷',
  partner: '✦',
  bucket: '☑',
};

export default function Notifications() {
  const { user } = useAuth();
  const { markSeen } = useNotifications();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [seenAt, setSeenAt] = useState<string>(new Date().toISOString());

  useEffect(() => {
    api<{ notifications: Notification[]; seenAt: string }>('/api/notifications')
      .then((data) => {
        setItems(data.notifications);
        setSeenAt(data.seenAt);
        markSeen().catch(() => {});
      })
      .catch(() => setItems([]));
  }, [markSeen]);

  useCoupleEvent('notification', (n: Notification) => {
    if (n?.actor_id === user?.id) return;
    setItems((prev) => (prev ? [n, ...prev.filter((x) => x.id !== n.id)] : prev));
  });

  if (items === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="All quiet for now"
            line="Nudges, memories, notes and milestones from your person will gather here."
          />
        }
        renderItem={({ item }) => {
          const fresh = new Date(item.created_at) > new Date(seenAt);
          return (
            <Card style={[styles.row, fresh && styles.rowFresh]}>
              <Text style={styles.glyph}>{KIND_GLYPH[item.kind] ?? '✧'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{item.text}</Text>
                <Text style={styles.meta}>
                  {formatDay(item.created_at)}, {formatTime(item.created_at)}
                </Text>
              </View>
              {fresh && <View style={styles.freshDot} />}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  list: {
    padding: space(5),
    paddingBottom: space(12),
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(4),
    marginBottom: space(3),
    padding: space(3.5),
  },
  rowFresh: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  glyph: { fontSize: 20, color: colors.rose, width: 26, textAlign: 'center' },
  text: { fontSize: type.body, color: colors.ink, fontFamily: font.serif },
  meta: { fontSize: type.tiny, color: colors.inkSoft, marginTop: 2 },
  freshDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rose },
});
