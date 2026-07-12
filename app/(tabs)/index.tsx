import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { Card } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';
import { countdownTo, daysSince, formatDay, nextOccurrence } from '@/lib/format';

interface HomeData {
  couple: { id: string; invite_code: string; created_at: string } | null;
  partner: { id: string; display_name: string } | null;
  daysBasis: string | null;
  milestones: { id: string; title: string; date: string; kind: string }[];
  resurfaced: { id: string; thumb_data: string | null; note: string; memory_date: string; tag: string } | null;
  bucket: { id: string; title: string; done: boolean }[];
  pinnedNote: { id: string; body: string; author_name: string } | null;
}

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  const load = useCallback(async () => {
    const home = await api<HomeData>('/api/home');
    setData(home);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useCoupleEvent('partner.joined', () => load().catch(() => {}));

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  if (!data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  const basis = data.daysBasis ?? data.couple?.created_at ?? new Date().toISOString();
  const days = daysSince(basis);
  const firstName = user?.display_name?.split(' ')[0] ?? '';
  const now = new Date();
  const upcoming = [...data.milestones]
    .map((m) => ({ ...m, next: nextOccurrence(m.date, m.kind, now) }))
    .filter((m) => m.next.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime())
    .sort((a, b) => a.next.getTime() - b.next.getTime())
    .slice(0, 2);

  const copyCode = async () => {
    if (!data.couple) return;
    await Clipboard.setStringAsync(data.couple.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addBucketItem = async () => {
    const title = newItem.trim();
    if (!title || addingItem) return;
    setAddingItem(true);
    try {
      const res = await api<{ item: HomeData['bucket'][0] }>('/api/bucket', { method: 'POST', body: { title } });
      setNewItem('');
      setData((d) => (d ? { ...d, bucket: [res.item, ...d.bucket].slice(0, 5) } : d));
    } catch {
      // keep the draft
    } finally {
      setAddingItem(false);
    }
  };

  const toggleBucketItem = async (id: string) => {
    setData((d) => (d ? { ...d, bucket: d.bucket.filter((b) => b.id !== id) } : d));
    await api(`/api/bucket/${id}`, { method: 'PATCH', body: { done: true } }).catch(() => load().catch(() => {}));
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.rose} />}
    >
      <Text style={styles.greeting}>Hi {firstName} ♥</Text>
      <Text style={styles.daysNumber}>{days.toLocaleString()}</Text>
      <Text style={styles.daysLabel}>
        {days === 1 ? 'day' : 'days'} {data.daysBasis ? 'of you two' : 'since your space began'}
        {' · since '}
        {formatDay(basis)}
      </Text>

      {!data.partner && data.couple && (
        <Card style={[styles.card, styles.inviteCard]}>
          <Text style={styles.cardKicker}>Just you here so far</Text>
          <Text style={styles.inviteLine}>
            Ours is better with your person in it. Share your code and everything you have added comes with you.
          </Text>
          <Pressable onPress={copyCode} style={styles.codeChip}>
            <Text style={styles.codeText}>{data.couple.invite_code}</Text>
            <Text style={styles.codeHint}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/pair')} hitSlop={6}>
            <Text style={styles.linkAction}>I have their code instead</Text>
          </Pressable>
        </Card>
      )}

      {data.resurfaced && (
        <Pressable onPress={() => router.push('/memories')}>
          <Card style={styles.card}>
            <Text style={styles.cardKicker}>✦ {data.resurfaced.tag}</Text>
            <View style={styles.resurfacedRow}>
              {data.resurfaced.thumb_data && (
                <Image source={{ uri: data.resurfaced.thumb_data }} style={styles.resurfacedPhoto} contentFit="cover" />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.resurfacedNote} numberOfLines={3}>
                  {data.resurfaced.note}
                </Text>
                <Text style={styles.metaLine}>{formatDay(data.resurfaced.memory_date)}</Text>
              </View>
            </View>
          </Card>
        </Pressable>
      )}

      {upcoming.length > 0 && (
        <Card style={styles.card}>
          <Text style={styles.cardKicker}>Coming up</Text>
          {upcoming.map((m) => {
            const c = countdownTo(m.next, now);
            return (
              <Pressable key={m.id} onPress={() => router.push('/milestones')} style={styles.upcomingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upcomingTitle}>{m.title}</Text>
                  <Text style={styles.metaLine}>
                    {m.next.getDate()} {m.next.toLocaleString('en', { month: 'long' })}
                  </Text>
                </View>
                <Text style={styles.upcomingDays}>
                  {c.days === 0 ? 'today ♥' : `${c.days} ${c.days === 1 ? 'day' : 'days'}`}
                </Text>
              </Pressable>
            );
          })}
        </Card>
      )}

      <Card style={styles.card}>
        <Text style={styles.cardKicker}>Our list</Text>
        {data.bucket.length === 0 && (
          <Text style={styles.emptyLine}>Things you two want to do. Add the first one.</Text>
        )}
        {data.bucket.map((item) => (
          <Pressable key={item.id} onPress={() => toggleBucketItem(item.id)} style={styles.bucketRow}>
            <View style={styles.checkbox} />
            <Text style={styles.bucketTitle}>{item.title}</Text>
          </Pressable>
        ))}
        <View style={styles.bucketComposer}>
          <TextInput
            value={newItem}
            onChangeText={setNewItem}
            placeholder="Someday, together we will..."
            placeholderTextColor={colors.inkSoft}
            style={styles.bucketInput}
            onSubmitEditing={addBucketItem}
          />
          <Pressable
            onPress={addBucketItem}
            disabled={!newItem.trim()}
            style={({ pressed }) => [styles.bucketAdd, !newItem.trim() && { opacity: 0.4 }, pressed && { backgroundColor: colors.rosePressed }]}
          >
            <Text style={{ color: colors.onRose, fontSize: 18 }}>＋</Text>
          </Pressable>
        </View>
      </Card>

      {data.pinnedNote && (
        <Pressable onPress={() => router.push('/notes')}>
          <Card style={[styles.card, styles.pinnedCard]}>
            <Text style={styles.cardKicker}>✦ Pinned on your wall</Text>
            <Text style={styles.pinnedBody} numberOfLines={3}>
              {data.pinnedNote.body}
            </Text>
            <Text style={styles.metaLine}>{data.pinnedNote.author_name}</Text>
          </Card>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  body: {
    padding: space(6),
    paddingBottom: space(16),
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  greeting: { fontSize: type.body, color: colors.rose, marginBottom: space(4) },
  daysNumber: {
    fontFamily: font.display,
    fontSize: 72,
    lineHeight: 76,
    color: colors.ink,
    letterSpacing: -2,
  },
  daysLabel: {
    fontFamily: font.serifItalic,
    fontSize: type.heading,
    color: colors.inkSoft,
    marginBottom: space(7),
  },
  card: { marginBottom: space(4) },
  inviteCard: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  cardKicker: {
    fontSize: type.tiny,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.sage,
    fontWeight: '700',
    marginBottom: space(3),
  },
  inviteLine: { fontSize: type.body, color: colors.ink, lineHeight: 23, marginBottom: space(4) },
  codeChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    alignItems: 'center',
    paddingVertical: space(3.5),
    marginBottom: space(3),
  },
  codeText: { fontFamily: font.display, fontSize: 26, letterSpacing: 8, color: colors.ink },
  codeHint: { fontSize: type.tiny, color: colors.inkSoft, marginTop: 2 },
  linkAction: { fontSize: type.small, color: colors.rose, fontWeight: '600', textAlign: 'center' },
  resurfacedRow: { flexDirection: 'row', gap: space(4), alignItems: 'center' },
  resurfacedPhoto: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.blushSoft },
  resurfacedNote: { fontFamily: font.serif, fontSize: type.heading, lineHeight: 26, color: colors.ink },
  metaLine: { fontSize: type.small, color: colors.inkSoft, marginTop: space(1.5) },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space(2.5),
  },
  upcomingTitle: { fontFamily: font.displayMedium, fontSize: type.heading, color: colors.ink },
  upcomingDays: { fontFamily: font.display, fontSize: type.heading, color: colors.rose },
  emptyLine: { fontSize: type.small, color: colors.inkSoft, marginBottom: space(2) },
  bucketRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2) },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.blush,
    backgroundColor: colors.surface,
  },
  bucketTitle: { fontSize: type.body, color: colors.ink, flex: 1 },
  bucketComposer: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(3) },
  bucketInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: type.body,
    color: colors.ink,
  },
  bucketAdd: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnedCard: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  pinnedBody: { fontFamily: font.serif, fontSize: type.heading, lineHeight: 27, color: colors.ink },
});
