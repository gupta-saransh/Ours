import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, Link as LinkIcon, Plus, Trash2 } from 'lucide-react-native';
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
import { LockBadge } from '@/components/LockBadge';
import { colors, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';

type Category = 'experience' | 'item';
type Segment = 'ours' | 'mine' | 'theirs';

interface BucketItem {
  id: string;
  author_id: string;
  title: string;
  category: Category;
  done: boolean;
  completed_at: string | null;
  created_at: string;
}

interface WishItem {
  id: string;
  owner_id: string;
  added_by: string;
  title: string;
  url: string | null;
  notes: string | null;
  category: Category;
  secret: boolean;
  gotten: boolean;
}

const CATEGORY_LABEL: Record<Category, string> = { experience: 'Experience', item: 'Thing' };

/**
 * "Wishes": one home for everything you two want. Three views:
 *  - Ours: the shared list of experiences and things to do or get together;
 *    finished items stay, signed off with the day you did them.
 *  - Mine: your own wishlist, which your partner reads to plan gifts.
 *  - Theirs: your partner's wishlist, where you can add a secret gift plan
 *    (hidden from them forever) or add something openly, on their behalf.
 */
export default function Wishes() {
  const { user, partner } = useAuth();
  const [seg, setSeg] = useState<Segment>('ours');
  const [bucket, setBucket] = useState<BucketItem[] | null>(null);
  const [wish, setWish] = useState<{ mine: WishItem[]; theirs: WishItem[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composerFor, setComposerFor] = useState<'mine' | 'theirs' | null>(null);

  // Ours composer + inline edit.
  const [newItem, setNewItem] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('experience');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Opened from the universal add button: jump to your own wishlist composer.
  useComposeParam(() => {
    setSeg('mine');
    setComposerFor('mine');
  });

  const loadBucket = useCallback(async () => {
    const data = await api<{ items: BucketItem[] }>('/api/bucket');
    setBucket(data.items);
  }, []);
  const loadWish = useCallback(async () => {
    const data = await api<{ mine: WishItem[]; theirs: WishItem[] }>('/api/wishlist');
    setWish(data);
  }, []);
  const load = useCallback(async () => {
    setFailed(false);
    await Promise.all([loadBucket(), loadWish()]);
  }, [loadBucket, loadWish]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('wishlist.updated', () => loadWish().catch(() => {}));
  useCoupleEvent('bucket.updated', () => loadBucket().catch(() => {}));

  // ---- Ours (bucket) handlers ----
  const addBucket = async () => {
    const title = newItem.trim();
    if (!title) return;
    setNewItem('');
    const category = newCategory;
    try {
      const res = await api<{ item: BucketItem }>('/api/bucket', { method: 'POST', body: { title, category } });
      setBucket((prev) => [res.item, ...(prev ?? [])]);
      successHaptic();
    } catch {
      setNewItem(title);
    }
  };

  const toggleBucket = async (item: BucketItem) => {
    tapHaptic();
    const next = !item.done;
    if (next) successHaptic();
    setBucket((prev) =>
      prev
        ? prev.map((i) =>
            i.id === item.id ? { ...i, done: next, completed_at: next ? new Date().toISOString() : null } : i
          )
        : prev
    );
    try {
      const res = await api<{ item: BucketItem }>(`/api/bucket/${item.id}`, { method: 'PATCH', body: { done: next } });
      setBucket((prev) => (prev ? prev.map((i) => (i.id === item.id ? res.item : i)) : prev));
    } catch {
      loadBucket().catch(() => {});
    }
  };

  const saveEdit = async (item: BucketItem) => {
    const title = draft.trim();
    setEditingId(null);
    if (!title || title === item.title) return;
    setBucket((prev) => (prev ? prev.map((i) => (i.id === item.id ? { ...i, title } : i)) : prev));
    try {
      await api(`/api/bucket/${item.id}`, { method: 'PATCH', body: { title } });
    } catch {
      loadBucket().catch(() => {});
    }
  };

  const removeBucket = async (item: BucketItem) => {
    setBucket((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    try {
      await api(`/api/bucket/${item.id}`, { method: 'DELETE' });
    } catch {
      loadBucket().catch(() => {});
    }
  };

  // ---- Wishlist handlers ----
  const toggleGotten = async (item: WishItem) => {
    successHaptic();
    setWish((d) =>
      d ? { mine: d.mine, theirs: d.theirs.map((i) => (i.id === item.id ? { ...i, gotten: !i.gotten } : i)) } : d
    );
    await api(`/api/wishlist/${item.id}`, { method: 'PATCH', body: { gotten: !item.gotten } }).catch(() =>
      loadWish().catch(() => {})
    );
  };

  const removeWish = async (item: WishItem) => {
    setWish((d) =>
      d ? { mine: d.mine.filter((i) => i.id !== item.id), theirs: d.theirs.filter((i) => i.id !== item.id) } : d
    );
    await api(`/api/wishlist/${item.id}`, { method: 'DELETE' }).catch(() => loadWish().catch(() => {}));
  };

  if (failed && (!bucket || !wish)) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!bucket || !wish) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={40} style={{ marginBottom: sp.lg }} />
          <Skeleton height={64} style={{ marginBottom: sp.lg }} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }

  const activeBucket = bucket.filter((i) => !i.done);
  const doneBucket = bucket.filter((i) => i.done);

  const segmentTabs: { key: Segment; label: string }[] = [
    { key: 'ours', label: 'Ours' },
    { key: 'mine', label: 'Mine' },
    { key: 'theirs', label: partner ? `${partner.display_name}'s` : 'Theirs' },
  ];

  // ---- Renderers ----
  const bucketRow = (item: BucketItem) => (
    <View key={item.id} style={styles.row}>
      <Pressable onPress={() => toggleBucket(item)} hitSlop={8} style={[styles.check, item.done && styles.checkDone]}>
        {item.done && <Check size={14} color={colors.onSealed} strokeWidth={2.5} />}
      </Pressable>
      {editingId === item.id ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => saveEdit(item)}
          onSubmitEditing={() => saveEdit(item)}
          autoFocus
          style={[styles.rowTitle, styles.titleInput]}
          returnKeyType="done"
        />
      ) : (
        <Pressable style={{ flex: 1 }} onPress={() => (item.done ? undefined : startEdit(item))}>
          <Text style={[styles.rowTitle, item.done && styles.titleDone]}>{item.title}</Text>
          {item.done && item.completed_at ? (
            <Text style={[text.micro, { color: colors.positive, marginTop: 2 }]}>
              Done {formatDay(item.completed_at)}
            </Text>
          ) : null}
        </Pressable>
      )}
      {!item.done && <Text style={styles.catTag}>{CATEGORY_LABEL[item.category]}</Text>}
      <Pressable onPress={() => removeBucket(item)} hitSlop={8} style={styles.trash}>
        <Trash2 size={16} color={colors.inkFaint} strokeWidth={1.75} />
      </Pressable>
    </View>
  );

  const startEdit = (item: BucketItem) => {
    setEditingId(item.id);
    setDraft(item.title);
  };

  const oursView = (
    <>
      <View style={styles.composer}>
        <View style={styles.catChoice}>
          {(['experience', 'item'] as Category[]).map((c) => (
            <Pressable
              key={c}
              onPress={() => {
                tapHaptic();
                setNewCategory(c);
              }}
              style={[styles.catPill, newCategory === c && styles.catPillActive]}
            >
              <Text style={[text.micro, newCategory === c && { color: colors.surfaceSealed, fontWeight: '600' }]}>
                {CATEGORY_LABEL[c]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.composerRow}>
          <TextInput
            value={newItem}
            onChangeText={setNewItem}
            placeholder={newCategory === 'experience' ? 'Someday, together we will...' : 'Something to get together...'}
            placeholderTextColor={colors.inkFaint}
            style={styles.composerInput}
            onSubmitEditing={addBucket}
            returnKeyType="done"
          />
          <AppPressable onPress={addBucket} disabled={!newItem.trim()} style={[styles.addBtn, !newItem.trim() && { opacity: 0.4 }]}>
            <Plus size={20} color={colors.onSealed} strokeWidth={2} />
          </AppPressable>
        </View>
      </View>

      {activeBucket.length === 0 && doneBucket.length === 0 ? (
        <Text style={styles.emptyLine}>Your list is empty. What is the first thing you want to do together?</Text>
      ) : (
        <>
          <Section label={activeBucket.length ? 'To do together' : 'Nothing left, for now'}>
            <Card>
              {activeBucket.length === 0 ? (
                <Text style={text.caption}>Everything here is done. Add the next thing above.</Text>
              ) : (
                activeBucket.map(bucketRow)
              )}
            </Card>
          </Section>
          {doneBucket.length > 0 && (
            <Section label={`Done together · ${doneBucket.length}`}>
              <Card>{doneBucket.map(bucketRow)}</Card>
            </Section>
          )}
        </>
      )}
    </>
  );

  const wishRow = (item: WishItem, ownList: boolean, last: boolean) => (
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
          style={[text.body, ownList && item.gotten && { textDecorationLine: 'line-through', color: colors.positive }]}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        {item.notes ? (
          <Text style={text.caption} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
        <View style={styles.tagRow}>
          <Text style={styles.catTag}>{CATEGORY_LABEL[item.category]}</Text>
          {item.secret ? <Pill label="Only you can see this" tone="accent" /> : null}
        </View>
      </View>
      {item.url ? (
        <Pressable onPress={() => Linking.openURL(item.url!).catch(() => {})} hitSlop={8}>
          <LinkIcon size={16} color={colors.accent} strokeWidth={1.75} />
        </Pressable>
      ) : null}
      {item.added_by === user?.id ? (
        <Pressable onPress={() => removeWish(item)} hitSlop={8}>
          <Text style={[text.caption, { color: colors.inkFaint }]}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const mineView = (
    <Section label="Things you are hoping for">
      <Card>
        {wish.mine.length === 0 ? (
          <Text style={text.caption}>Nothing wished for yet. Add something your partner could surprise you with.</Text>
        ) : (
          wish.mine.map((i, idx) => wishRow(i, true, idx === wish.mine.length - 1))
        )}
      </Card>
      <PrimaryButton title="Add a wish" onPress={() => setComposerFor('mine')} style={{ marginTop: sp.md }} />
    </Section>
  );

  const theirsView = !partner ? (
    <Empty line="Once you pair with your person, their wishlist shows up here." />
  ) : (
    <Section label={`${partner.display_name}'s wishes`}>
      <Card>
        {wish.theirs.length === 0 ? (
          <Text style={text.caption}>Their list is empty so far. You can add a gift plan below.</Text>
        ) : (
          wish.theirs.map((i, idx) => wishRow(i, false, idx === wish.theirs.length - 1))
        )}
      </Card>
      <PrimaryButton title="Add a gift" onPress={() => setComposerFor('theirs')} style={{ marginTop: sp.md }} />
      <Text style={[text.caption, { marginTop: sp.sm, textAlign: 'center' }]}>
        Tick something once you have it. They never see who got what.
      </Text>
    </Section>
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
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
        <View style={styles.segRow}>
          {segmentTabs.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => {
                tapHaptic();
                setSeg(t.key);
              }}
              style={[styles.segTab, seg === t.key && styles.segTabActive]}
            >
              <Text
                style={[text.caption, seg === t.key && { color: colors.surfaceSealed, fontWeight: '600' }]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {seg === 'ours' ? oursView : seg === 'mine' ? mineView : theirsView}
      </ScrollView>

      <WishComposer
        target={composerFor}
        partnerName={partner?.display_name ?? 'them'}
        partnerId={partner?.id ?? null}
        myId={user?.id ?? ''}
        onClose={() => setComposerFor(null)}
        onDone={() => {
          setComposerFor(null);
          loadWish().catch(() => {});
        }}
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
  const [category, setCategory] = useState<Category>('item');
  const [secret, setSecret] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forPartner = target === 'theirs';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/wishlist', {
        method: 'POST',
        body: {
          ownerId: forPartner ? partnerId : myId,
          title: title.trim(),
          url: url.trim() || undefined,
          notes: notes.trim() || undefined,
          category,
          secret: forPartner ? secret : false,
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
    <Sheet visible={!!target} onClose={onClose} title={forPartner ? `A gift for ${partnerName}` : 'Add a wish'}>
      {forPartner && (
        <View style={styles.visChoice}>
          <Pressable
            onPress={() => setSecret(true)}
            style={[styles.visOption, secret && styles.visOptionActive]}
          >
            <Text style={[text.body, secret && { color: colors.surfaceSealed, fontWeight: '600' }]}>A secret</Text>
            <Text style={text.caption}>Only you ever see it.</Text>
          </Pressable>
          <Pressable
            onPress={() => setSecret(false)}
            style={[styles.visOption, !secret && styles.visOptionActive]}
          >
            <Text style={[text.body, !secret && { color: colors.surfaceSealed, fontWeight: '600' }]}>They can see it</Text>
            <Text style={text.caption}>You are adding on their behalf.</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.catChoice, { marginBottom: sp.md }]}>
        {(['item', 'experience'] as Category[]).map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            style={[styles.catPill, category === c && styles.catPillActive]}
          >
            <Text style={[text.micro, category === c && { color: colors.surfaceSealed, fontWeight: '600' }]}>
              {CATEGORY_LABEL[c]}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextField label="What is it?" value={title} onChangeText={setTitle} placeholder="That ceramic vase" />
      <TextField label="Link (optional)" value={url} onChangeText={setUrl} placeholder="https://" autoCapitalize="none" />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Size, color, where to find it" />
      <FormError message={error} />
      <PrimaryButton
        title={forPartner && secret ? 'Keep the secret' : 'Add it'}
        onPress={submit}
        loading={busy}
        disabled={!title.trim()}
      />
      <LockBadge style={{ marginTop: sp.base, alignSelf: 'center' }} />
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
  segRow: {
    flexDirection: 'row',
    gap: sp.sm,
    marginBottom: sp.xl,
  },
  segTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: sp.sm,
    paddingHorizontal: sp.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  segTabActive: { borderColor: colors.surfaceSealed },
  composer: { marginBottom: sp.xl },
  catChoice: { flexDirection: 'row', gap: sp.sm, marginBottom: sp.md },
  catPill: {
    paddingVertical: 6,
    paddingHorizontal: sp.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  catPillActive: { borderColor: colors.surfaceSealed, backgroundColor: colors.blushSoft },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  composerInput: {
    flex: 1,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    fontFamily: 'Fraunces_400Regular',
    fontSize: 16,
    color: colors.ink,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLine: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: sp.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowTitle: { ...text.body, flex: 1 },
  titleInput: { padding: 0, borderBottomWidth: 1, borderBottomColor: colors.accent },
  titleDone: { color: colors.inkFaint, textDecorationLine: 'line-through' },
  catTag: {
    ...text.micro,
    color: colors.inkMuted,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: sp.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  trash: { padding: sp.xs },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.xs, flexWrap: 'wrap' },
  check: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.positive, borderColor: colors.positive },
  visChoice: { flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg },
  visOption: {
    flex: 1,
    padding: sp.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    gap: sp.xs,
  },
  visOptionActive: { borderColor: colors.surfaceSealed, backgroundColor: colors.blushSoft },
});
