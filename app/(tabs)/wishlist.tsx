import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Check, Link as LinkIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import {
  AppPressable,
  Card,
  Empty,
  ErrorState,
  FormError,
  Pill,
  PrimaryButton,
  Screen,
  Section,
  Skeleton,
  TextField,
} from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, sp, text } from '@/theme';

interface WishItem {
  id: string;
  owner_id: string;
  added_by: string;
  title: string;
  url: string | null;
  notes: string | null;
  secret: boolean;
  gotten: boolean;
}

export default function Wishlist() {
  const { user, partner } = useAuth();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const [data, setData] = useState<{ mine: WishItem[]; theirs: WishItem[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'mine' | 'theirs'>('mine');
  const [composerFor, setComposerFor] = useState<'mine' | 'theirs' | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const res = await api<{ mine: WishItem[]; theirs: WishItem[] }>('/api/wishlist');
    setData(res);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('wishlist.updated', () => load().catch(() => {}));

  const toggleGotten = async (item: WishItem) => {
    successHaptic();
    setData((d) =>
      d
        ? {
            mine: d.mine,
            theirs: d.theirs.map((i) => (i.id === item.id ? { ...i, gotten: !i.gotten } : i)),
          }
        : d
    );
    await api(`/api/wishlist/${item.id}`, { method: 'PATCH', body: { gotten: !item.gotten } }).catch(() =>
      load().catch(() => {})
    );
  };

  const remove = async (item: WishItem) => {
    setData((d) =>
      d
        ? {
            mine: d.mine.filter((i) => i.id !== item.id),
            theirs: d.theirs.filter((i) => i.id !== item.id),
          }
        : d
    );
    await api(`/api/wishlist/${item.id}`, { method: 'DELETE' }).catch(() => load().catch(() => {}));
  };

  if (failed && !data) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={64} style={{ marginBottom: sp.lg }} />
          <Skeleton height={64} style={{ marginBottom: sp.lg }} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }

  const renderItem = (item: WishItem, ownList: boolean, last: boolean) => (
    <View key={item.id} style={[styles.itemRow, !last && styles.itemBorder]}>
      {!ownList ? (
        <AppPressable onPress={() => toggleGotten(item)} style={[styles.check, item.gotten && styles.checkDone]}>
          {item.gotten ? <Check size={14} color={colors.onSealed} strokeWidth={2.5} /> : null}
        </AppPressable>
      ) : (
        <View style={[styles.check, { borderColor: colors.hairline }]} />
      )}
      <View style={{ flex: 1, opacity: !ownList && item.gotten ? 0.6 : 1 }}>
        <Text
          style={[
            text.body,
            ownList && item.gotten && { textDecorationLine: 'line-through', color: colors.positive },
          ]}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        {item.notes ? (
          <Text style={text.caption} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
        {item.secret ? <Pill label="Only you can see this" tone="accent" style={{ marginTop: sp.xs }} /> : null}
      </View>
      {item.url ? (
        <Pressable onPress={() => Linking.openURL(item.url!).catch(() => {})} hitSlop={8}>
          <LinkIcon size={16} color={colors.accent} strokeWidth={1.75} />
        </Pressable>
      ) : null}
      {item.added_by === user?.id ? (
        <Pressable onPress={() => remove(item)} hitSlop={8}>
          <Text style={[text.caption, { color: colors.inkFaint }]}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const mineBlock = (
    <Section label="Yours" style={wide ? { flex: 1 } : undefined}>
      <Card>
        {data.mine.length === 0 && <Text style={text.caption}>Nothing wished for yet.</Text>}
        {data.mine.map((i, idx) => renderItem(i, true, idx === data.mine.length - 1))}
      </Card>
      <PrimaryButton title="Add a wish" onPress={() => setComposerFor('mine')} style={{ marginTop: sp.md }} />
    </Section>
  );

  const theirsBlock = (
    <Section label={partner ? `${partner.display_name}'s` : 'Theirs'} style={wide ? { flex: 1 } : undefined}>
      <Card>
        {data.theirs.length === 0 && <Text style={text.caption}>Their list is empty so far.</Text>}
        {data.theirs.map((i, idx) => renderItem(i, false, idx === data.theirs.length - 1))}
      </Card>
      {partner && (
        <PrimaryButton title="Plan a secret gift" onPress={() => setComposerFor('theirs')} style={{ marginTop: sp.md }} />
      )}
    </Section>
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.body, wide && { maxWidth: 1000 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load().catch(() => {});
              setRefreshing(false);
            }}
            tintColor={colors.accent}
          />
        }
      >
        {data.mine.length === 0 && data.theirs.length === 0 ? (
          <Empty line="Your wishlists are empty." actionTitle="Add a wish" onAction={() => setComposerFor('mine')} />
        ) : null}

        {wide ? (
          <View style={{ flexDirection: 'row', gap: sp.xl }}>
            {mineBlock}
            {theirsBlock}
          </View>
        ) : (
          <>
            <View style={styles.tabs}>
              {(['mine', 'theirs'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => {
                    tapHaptic();
                    setTab(t);
                  }}
                  style={[styles.tab, tab === t && styles.tabActive]}
                >
                  <Text style={[text.caption, tab === t && { color: colors.surfaceSealed, fontWeight: '600' }]}>
                    {t === 'mine' ? 'Yours' : partner ? `${partner.display_name}'s` : 'Theirs'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {tab === 'mine' ? mineBlock : theirsBlock}
          </>
        )}
      </ScrollView>

      <WishComposer
        target={composerFor}
        partnerName={partner?.display_name ?? 'them'}
        onClose={() => setComposerFor(null)}
        onDone={() => {
          setComposerFor(null);
          load().catch(() => {});
        }}
        partnerId={partner?.id ?? null}
        myId={user?.id ?? ''}
      />
    </Screen>
  );
}

function WishComposer({
  target,
  partnerName,
  partnerId,
  myId,
  onClose,
  onDone,
}: {
  target: 'mine' | 'theirs' | null;
  partnerName: string;
  partnerId: string | null;
  myId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const secret = target === 'theirs';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/wishlist', {
        method: 'POST',
        body: {
          ownerId: secret ? partnerId : myId,
          title: title.trim(),
          url: url.trim() || undefined,
          notes: notes.trim() || undefined,
          secret,
        },
      });
      setTitle('');
      setUrl('');
      setNotes('');
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={!!target} onClose={onClose} title={secret ? 'A secret gift plan' : 'Add a wish'}>
      {secret && (
        <Text style={[text.caption, { marginBottom: sp.lg }]}>
          This goes on {partnerName}'s list, but only you will ever see it.
        </Text>
      )}
      <TextField label="What is it?" value={title} onChangeText={setTitle} placeholder="That ceramic vase" />
      <TextField label="Link (optional)" value={url} onChangeText={setUrl} placeholder="https://" autoCapitalize="none" />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Size, color, where to find it" />
      <FormError message={error} />
      <PrimaryButton title={secret ? 'Keep the secret' : 'Add it'} onPress={submit} loading={busy} disabled={!title.trim()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.xl,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  tabs: {
    flexDirection: 'row',
    gap: sp.sm,
    marginBottom: sp.lg,
  },
  tab: {
    paddingVertical: sp.sm,
    paddingHorizontal: sp.base,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  tabActive: {
    borderColor: colors.surfaceSealed,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.md,
  },
  itemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: {
    backgroundColor: colors.positive,
    borderColor: colors.positive,
  },
});
