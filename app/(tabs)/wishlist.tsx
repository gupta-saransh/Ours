import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Link as LinkIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { showHearts } from '@/components/HeartsRain';
import {
  AppPressable,
  Card,
  Empty,
  ErrorState,
  FormError,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Section,
  Skeleton,
  TextField,
} from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { LockBadge } from '@/components/LockBadge';
import { colors, font, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';

interface Wish {
  id: string;
  author_id: string;
  title: string;
  done: boolean;
  completed_at: string | null;
  created_at: string;
}

interface GiftWish {
  id: string;
  owner_id: string;
  added_by: string;
  title: string;
  url: string | null;
  notes: string | null;
  secret: boolean;
  gotten: boolean;
}

/** Deterministic per-wish scatter so the sky looks scattered but never jumps. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Fixed faint stars that give the sky its texture (pointerEvents none).
const SKY_DUST = [
  { top: '8%', left: '12%' },
  { top: '16%', right: '10%' },
  { top: '38%', left: '6%' },
  { top: '55%', right: '18%' },
  { top: '74%', left: '20%' },
  { top: '86%', right: '8%' },
] as const;

/**
 * Wishes: one tab, two halves, split like Memories splits calendar and
 * timeline (side by side on wide web, one scroll on narrow).
 *
 *  - The night sky: wishes the two of you have made together, each one a gold
 *    star on oxblood. "Pull one down" draws a random wish and offers to plan it
 *    as a date. When one comes true it falls out of the sky onto parchment
 *    below, in gold, with its date. (Data: the old bucket_items, unchanged.)
 *  - Gift wishes: each partner's list, tag-styled. A plan added secretly to
 *    the partner's list carries a small wax mark only you can see.
 */
export default function Wishes() {
  const { user, partner } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;

  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [gifts, setGifts] = useState<{ mine: GiftWish[]; theirs: GiftWish[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [newWish, setNewWish] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingLetGo, setConfirmingLetGo] = useState(false);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [rewriteDraft, setRewriteDraft] = useState('');
  const [drawn, setDrawn] = useState<Wish | null>(null);

  const [giftSeg, setGiftSeg] = useState<'mine' | 'theirs'>('mine');
  const [giftComposer, setGiftComposer] = useState<'mine' | 'theirs' | null>(null);

  const wishInputRef = useRef<TextInput>(null);
  // The universal add button says "Make a wish": focus the sky's composer.
  useComposeParam(() => wishInputRef.current?.focus());

  const loadWishes = useCallback(async () => {
    const data = await api<{ items: Wish[] }>('/api/bucket');
    setWishes(data.items);
  }, []);
  const loadGifts = useCallback(async () => {
    const data = await api<{ mine: GiftWish[]; theirs: GiftWish[] }>('/api/wishlist');
    setGifts(data);
  }, []);
  const load = useCallback(async () => {
    setFailed(false);
    await Promise.all([loadWishes(), loadGifts()]);
  }, [loadWishes, loadGifts]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('bucket.updated', () => loadWishes().catch(() => {}));
  useCoupleEvent('wishlist.updated', () => loadGifts().catch(() => {}));

  // ---- Sky handlers ----
  const makeWish = async () => {
    const title = newWish.trim();
    if (!title) return;
    setNewWish('');
    try {
      const res = await api<{ item: Wish }>('/api/bucket', { method: 'POST', body: { title } });
      setWishes((prev) => [res.item, ...(prev ?? [])]);
      successHaptic();
    } catch {
      setNewWish(title);
    }
  };

  const select = (id: string | null) => {
    tapHaptic();
    setSelectedId((cur) => (cur === id ? null : id));
    setConfirmingLetGo(false);
    setRewritingId(null);
  };

  const cameTrue = async (wish: Wish) => {
    setSelectedId(null);
    successHaptic();
    showHearts(); // a wish coming true earns the shower
    setWishes((prev) =>
      prev
        ? prev.map((w) => (w.id === wish.id ? { ...w, done: true, completed_at: new Date().toISOString() } : w))
        : prev
    );
    try {
      const res = await api<{ item: Wish }>(`/api/bucket/${wish.id}`, { method: 'PATCH', body: { done: true } });
      setWishes((prev) => (prev ? prev.map((w) => (w.id === wish.id ? res.item : w)) : prev));
    } catch {
      loadWishes().catch(() => {});
    }
  };

  const backToSky = async (wish: Wish) => {
    setSelectedId(null);
    setWishes((prev) =>
      prev ? prev.map((w) => (w.id === wish.id ? { ...w, done: false, completed_at: null } : w)) : prev
    );
    await api(`/api/bucket/${wish.id}`, { method: 'PATCH', body: { done: false } }).catch(() =>
      loadWishes().catch(() => {})
    );
  };

  const letGo = async (wish: Wish) => {
    setSelectedId(null);
    setConfirmingLetGo(false);
    setWishes((prev) => (prev ? prev.filter((w) => w.id !== wish.id) : prev));
    await api(`/api/bucket/${wish.id}`, { method: 'DELETE' }).catch(() => loadWishes().catch(() => {}));
  };

  const saveRewrite = async (wish: Wish) => {
    const title = rewriteDraft.trim();
    setRewritingId(null);
    setSelectedId(null);
    if (!title || title === wish.title) return;
    setWishes((prev) => (prev ? prev.map((w) => (w.id === wish.id ? { ...w, title } : w)) : prev));
    await api(`/api/bucket/${wish.id}`, { method: 'PATCH', body: { title } }).catch(() => loadWishes().catch(() => {}));
  };

  const planAsDate = (wish: Wish) => {
    setDrawn(null);
    setSelectedId(null);
    router.navigate({ pathname: '/dates', params: { compose: String(Date.now()), wish: wish.title } });
  };

  const pullOneDown = (open: Wish[]) => {
    if (open.length === 0) return;
    tapHaptic();
    setDrawn(open[Math.floor(Math.random() * open.length)]);
  };

  // ---- Gift handlers ----
  const toggleGotten = async (item: GiftWish) => {
    successHaptic();
    setGifts((d) =>
      d ? { mine: d.mine, theirs: d.theirs.map((i) => (i.id === item.id ? { ...i, gotten: !i.gotten } : i)) } : d
    );
    await api(`/api/wishlist/${item.id}`, { method: 'PATCH', body: { gotten: !item.gotten } }).catch(() =>
      loadGifts().catch(() => {})
    );
  };

  const removeGift = async (item: GiftWish) => {
    setGifts((d) =>
      d ? { mine: d.mine.filter((i) => i.id !== item.id), theirs: d.theirs.filter((i) => i.id !== item.id) } : d
    );
    await api(`/api/wishlist/${item.id}`, { method: 'DELETE' }).catch(() => loadGifts().catch(() => {}));
  };

  if (failed && (!wishes || !gifts)) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!wishes || !gifts) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={220} style={{ marginBottom: sp.lg }} />
          <Skeleton height={64} style={{ marginBottom: sp.lg }} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }

  const openWishes = wishes.filter((w) => !w.done);
  const trueWishes = wishes.filter((w) => w.done);

  // ---- The night sky ----
  const sky = (
    <Section label="Wished together">
      <View style={styles.sky}>
        {SKY_DUST.map((pos, i) => (
          <Text key={i} style={[styles.skyDust, pos as object]} pointerEvents="none">
            ✦
          </Text>
        ))}

        {openWishes.length === 0 ? (
          <Text style={styles.skyEmpty}>Nothing up there yet. Make the first wish.</Text>
        ) : (
          openWishes.map((w) => {
            const h = hashOf(w.id);
            const selected = selectedId === w.id;
            return (
              <View key={w.id} style={{ paddingLeft: (h % 5) * 10, paddingRight: (h % 3) * 8 }}>
                {rewritingId === w.id ? (
                  <TextInput
                    value={rewriteDraft}
                    onChangeText={setRewriteDraft}
                    onBlur={() => saveRewrite(w)}
                    onSubmitEditing={() => saveRewrite(w)}
                    autoFocus
                    style={styles.rewriteInput}
                    returnKeyType="done"
                  />
                ) : (
                  <Pressable onPress={() => select(w.id)} style={styles.skyWish}>
                    <Text style={styles.skyStar}>✦</Text>
                    <Text style={[styles.skyWishText, selected && { color: colors.accent }]}>{w.title}</Text>
                  </Pressable>
                )}
                {selected && rewritingId !== w.id && (
                  <View style={styles.skyActions}>
                    <Pressable onPress={() => cameTrue(w)} hitSlop={6}>
                      <Text style={[styles.skyAction, { color: colors.accent }]}>It came true ♥</Text>
                    </Pressable>
                    <Pressable onPress={() => planAsDate(w)} hitSlop={6}>
                      <Text style={styles.skyAction}>Plan it as a date</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setRewritingId(w.id);
                        setRewriteDraft(w.title);
                      }}
                      hitSlop={6}
                    >
                      <Text style={styles.skyAction}>Rewrite</Text>
                    </Pressable>
                    {confirmingLetGo ? (
                      <Pressable onPress={() => letGo(w)} hitSlop={6}>
                        <Text style={[styles.skyAction, { color: colors.blush }]}>Really let it go?</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => setConfirmingLetGo(true)} hitSlop={6}>
                        <Text style={[styles.skyAction, { opacity: 0.6 }]}>Let it go</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}

        <View style={styles.skyComposer}>
          <TextInput
            ref={wishInputRef}
            value={newWish}
            onChangeText={setNewWish}
            placeholder="We wish..."
            placeholderTextColor="rgba(249, 239, 220, 0.45)"
            style={styles.skyInput}
            onSubmitEditing={makeWish}
            returnKeyType="done"
          />
          <AppPressable onPress={makeWish} disabled={!newWish.trim()} style={[styles.wishBtn, !newWish.trim() && { opacity: 0.4 }]}>
            <Text style={styles.wishBtnStar}>✦</Text>
          </AppPressable>
        </View>

        {openWishes.length > 0 && (
          <AppPressable onPress={() => pullOneDown(openWishes)} style={styles.pullBtn}>
            <Text style={styles.pullBtnText}>Pull one down</Text>
          </AppPressable>
        )}
      </View>

      {trueWishes.length > 0 && (
        <View style={{ marginTop: sp.lg }}>
          <Text style={[text.section, { marginBottom: sp.sm }]}>Came true</Text>
          <Card>
            {trueWishes.map((w, i) => {
              const selected = selectedId === w.id;
              return (
                <View key={w.id} style={[i > 0 && styles.trueBorder]}>
                  <Pressable onPress={() => select(w.id)} style={styles.trueRow}>
                    <Text style={styles.trueStar}>✦</Text>
                    <Text style={styles.trueTitle}>{w.title}</Text>
                    {w.completed_at ? <Text style={styles.trueDate}>{formatDay(w.completed_at)}</Text> : null}
                  </Pressable>
                  {selected && (
                    <View style={[styles.skyActions, { paddingBottom: sp.sm }]}>
                      <Pressable onPress={() => backToSky(w)} hitSlop={6}>
                        <Text style={[styles.skyAction, { color: colors.inkMuted }]}>Back to the sky</Text>
                      </Pressable>
                      {confirmingLetGo ? (
                        <Pressable onPress={() => letGo(w)} hitSlop={6}>
                          <Text style={[styles.skyAction, { color: colors.danger }]}>Really remove?</Text>
                        </Pressable>
                      ) : (
                        <Pressable onPress={() => setConfirmingLetGo(true)} hitSlop={6}>
                          <Text style={[styles.skyAction, { color: colors.inkFaint }]}>Remove</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        </View>
      )}
    </Section>
  );

  // ---- Gift wishes ----
  const giftList = giftSeg === 'mine' ? gifts.mine : gifts.theirs;
  const giftTags = (
    <Section
      label="Gift wishes"
      trailing={
        <View style={{ flexDirection: 'row', gap: sp.xs }}>
          {(['mine', 'theirs'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                tapHaptic();
                setGiftSeg(s);
              }}
              style={[styles.giftSegPill, giftSeg === s && styles.giftSegPillActive]}
            >
              <Text style={[text.micro, { textTransform: 'none', letterSpacing: 0.2 }, giftSeg === s && { color: colors.onSealed }]}>
                {s === 'mine' ? 'Mine' : partner ? `${partner.display_name}'s` : 'Theirs'}
              </Text>
            </Pressable>
          ))}
        </View>
      }
    >
      {giftSeg === 'theirs' && !partner ? (
        <Empty line="Once you pair with your person, their wishes show up here." />
      ) : (
        <>
          {giftList.length === 0 ? (
            <Card>
              <Text style={text.caption}>
                {giftSeg === 'mine'
                  ? 'Nothing here yet. Add something they could surprise you with.'
                  : 'Their list is empty so far. You can tuck a gift plan in below.'}
              </Text>
            </Card>
          ) : (
            giftList.map((item) => {
              const ownList = giftSeg === 'mine';
              return (
                <View key={item.id} style={styles.tag}>
                  {/* The tag's "hole": on their list it doubles as the got-it tick. */}
                  {!ownList ? (
                    <AppPressable onPress={() => toggleGotten(item)} style={[styles.tagHole, item.gotten && styles.tagHoleDone]} />
                  ) : (
                    <View style={styles.tagHole} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.tagTitle,
                        ownList && item.gotten && { textDecorationLine: 'line-through', color: colors.positive },
                        !ownList && item.gotten && { color: colors.inkFaint },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {item.notes ? (
                      <Text style={text.caption} numberOfLines={2}>
                        {item.notes}
                      </Text>
                    ) : null}
                    {item.secret ? (
                      <View style={styles.sealRow}>
                        <View style={styles.sealDot} />
                        <Text style={[text.micro, { textTransform: 'none', letterSpacing: 0.2, color: colors.inkMuted }]}>
                          only you see this
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {item.url ? (
                    <Pressable onPress={() => Linking.openURL(item.url!).catch(() => {})} hitSlop={8}>
                      <LinkIcon size={16} color={colors.accent} strokeWidth={1.75} />
                    </Pressable>
                  ) : null}
                  {item.added_by === user?.id ? (
                    <Pressable onPress={() => removeGift(item)} hitSlop={8}>
                      <Text style={[text.micro, { textTransform: 'none', color: colors.inkFaint }]}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}
          <SecondaryButton
            title={giftSeg === 'mine' ? 'Add a wish of mine' : 'Tuck a gift plan in'}
            onPress={() => setGiftComposer(giftSeg)}
            style={{ marginTop: sp.md }}
          />
          {giftSeg === 'theirs' && (
            <Text style={[text.caption, { marginTop: sp.sm, textAlign: 'center' }]}>
              Tap a tag's little hole once you have it. They never see who got what.
            </Text>
          )}
        </>
      )}
    </Section>
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.body, wide && styles.bodyWide]}
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
        <View style={wide ? styles.col : undefined}>{sky}</View>
        <View style={wide ? styles.col : { marginTop: sp.xl }}>{giftTags}</View>
      </ScrollView>

      {/* The pulled-down wish */}
      <Sheet visible={!!drawn} onClose={() => setDrawn(null)} title="This one fell for you">
        {drawn && (
          <>
            <Text style={styles.drawnStar}>✦</Text>
            <Text style={styles.drawnTitle}>{drawn.title}</Text>
            <PrimaryButton title="Plan it as a date" onPress={() => planAsDate(drawn)} />
            <SecondaryButton
              title="Pull another"
              onPress={() => pullOneDown(openWishes.filter((w) => w.id !== drawn.id).length ? openWishes.filter((w) => w.id !== drawn.id) : openWishes)}
              style={{ marginTop: sp.sm }}
            />
            <Pressable onPress={() => setDrawn(null)} hitSlop={8} style={{ alignSelf: 'center', marginTop: sp.md }}>
              <Text style={[text.caption, { color: colors.inkFaint }]}>Back to the sky</Text>
            </Pressable>
          </>
        )}
      </Sheet>

      <GiftComposer
        target={giftComposer}
        partnerName={partner?.display_name ?? 'them'}
        partnerId={partner?.id ?? null}
        myId={user?.id ?? ''}
        onClose={() => setGiftComposer(null)}
        onDone={() => {
          setGiftComposer(null);
          loadGifts().catch(() => {});
        }}
      />
    </Screen>
  );
}

function GiftComposer({
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
    <Sheet visible={!!target} onClose={onClose} title={forPartner ? `A gift for ${partnerName}` : 'A wish of mine'}>
      {forPartner && (
        <View style={styles.visChoice}>
          <Pressable onPress={() => setSecret(true)} style={[styles.visOption, secret && styles.visOptionActive]}>
            <Text style={[text.body, secret && { color: colors.surfaceSealed, fontWeight: '600' }]}>A secret</Text>
            <Text style={text.caption}>Only you ever see it.</Text>
          </Pressable>
          <Pressable onPress={() => setSecret(false)} style={[styles.visOption, !secret && styles.visOptionActive]}>
            <Text style={[text.body, !secret && { color: colors.surfaceSealed, fontWeight: '600' }]}>They can see it</Text>
            <Text style={text.caption}>You are adding on their behalf.</Text>
          </Pressable>
        </View>
      )}

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
  bodyWide: {
    maxWidth: 1100,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp.xl,
  },
  col: { flex: 1, minWidth: 0 },

  // ---- Night sky ----
  sky: {
    backgroundColor: colors.surfaceSealed,
    borderRadius: radius.lg,
    padding: sp.lg,
    paddingTop: sp.xl,
    overflow: 'hidden',
  },
  skyDust: {
    position: 'absolute',
    color: colors.accent,
    opacity: 0.28,
    fontSize: 10,
  },
  skyEmpty: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.onSealed,
    opacity: 0.75,
    textAlign: 'center',
    marginVertical: sp.lg,
  },
  skyWish: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp.sm,
    paddingVertical: sp.sm,
  },
  skyStar: {
    color: colors.accent,
    fontSize: 15,
    lineHeight: 22,
  },
  skyWishText: {
    ...text.bodySerif,
    fontSize: 17,
    lineHeight: 24,
    color: colors.onSealed,
    flexShrink: 1,
  },
  skyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sp.base,
    paddingLeft: sp.lg,
    paddingBottom: sp.sm,
  },
  skyAction: {
    ...text.caption,
    color: colors.onSealed,
    textDecorationLine: 'underline',
  },
  rewriteInput: {
    ...text.bodySerif,
    fontSize: 17,
    color: colors.onSealed,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: sp.sm,
    marginVertical: sp.xs,
  },
  skyComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    marginTop: sp.lg,
  },
  skyInput: {
    flex: 1,
    height: 44,
    fontFamily: font.serif,
    fontStyle: 'italic',
    fontSize: 16,
    color: colors.onSealed,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(249, 239, 220, 0.35)',
  },
  wishBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wishBtnStar: {
    color: colors.surfaceSealed,
    fontSize: 18,
  },
  pullBtn: {
    alignSelf: 'center',
    marginTop: sp.lg,
    paddingVertical: sp.sm,
    paddingHorizontal: sp.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  pullBtnText: {
    ...text.caption,
    color: colors.accent,
  },

  // ---- Came true ----
  trueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: sp.sm,
    paddingVertical: sp.md,
  },
  trueBorder: { borderTopWidth: 1, borderTopColor: colors.hairline },
  trueStar: { color: colors.accent, fontSize: 14 },
  trueTitle: {
    ...text.bodySerif,
    flex: 1,
    color: colors.ink,
  },
  trueDate: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.accent,
  },

  // ---- Gift tags ----
  giftSegPill: {
    paddingVertical: 4,
    paddingHorizontal: sp.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  giftSegPillActive: {
    backgroundColor: colors.surfaceSealed,
    borderColor: colors.surfaceSealed,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    paddingVertical: sp.md,
    paddingHorizontal: sp.base,
    marginBottom: sp.sm,
  },
  tagHole: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  tagHoleDone: {
    backgroundColor: colors.accent,
  },
  tagTitle: {
    ...text.bodySerif,
    fontSize: 16,
    color: colors.ink,
  },
  sealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.xs,
    marginTop: 3,
  },
  sealDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surfaceSealed,
  },

  // ---- Drawn wish sheet ----
  drawnStar: {
    color: colors.accent,
    fontSize: 26,
    textAlign: 'center',
    marginBottom: sp.sm,
  },
  drawnTitle: {
    ...text.bodySerif,
    fontSize: 21,
    lineHeight: 30,
    fontStyle: 'italic',
    textAlign: 'center',
    color: colors.ink,
    marginBottom: sp.xl,
  },

  // ---- Gift composer ----
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
