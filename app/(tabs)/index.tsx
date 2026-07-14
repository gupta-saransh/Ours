import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { Image } from 'expo-image';
import { Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic } from '@/lib/haptics';
import {
  AppPressable,
  Card,
  ErrorState,
  FadeIn,
  PressableCard,
  PrimaryButton,
  Screen,
  Section,
  SecondaryButton,
  Skeleton,
  TextField,
} from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { BellButton, NudgeButton, SettingsButton } from '@/components/HeaderActions';
import { colors, radius, sp, text } from '@/theme';
import { countdownTo, daysSince, formatDay, nextOccurrence } from '@/lib/format';

interface PromptState {
  prompt: { prompt_date: string; text: string };
  myAnswer: string | null;
  partnerAnswer: string | null;
  partnerAnswered: boolean;
  bothAnswered: boolean;
}

interface HomeData {
  couple: { id: string; invite_code: string; created_at: string } | null;
  partner: { id: string; display_name: string } | null;
  daysBasis: string | null;
  milestones: { id: string; title: string; date: string; kind: string }[];
  resurfaced: { id: string; thumb_data: string | null; note: string; memory_date: string; tag: string } | null;
  bucket: { id: string; title: string; done: boolean }[];
  pinnedNote: { id: string; body: string; author_name: string } | null;
  prompt: PromptState;
  upcomingDate: { id: string; title: string; location: string | null; proposed_for: string } | null;
  isSunday: boolean;
  reflection: {
    week_start: string;
    week_end: string;
    counts: Record<string, number>;
    highlight: { id: string; thumb_data: string | null; note: string } | null;
    saved: boolean;
  } | null;
}

export default function Home() {
  const { user, encryption } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [answerOpen, setAnswerOpen] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const home = await api<HomeData>('/api/home');
    setData(home);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('partner.joined', () => load().catch(() => {}));
  useCoupleEvent('prompt.answered', () => load().catch(() => {}));
  useCoupleEvent('prompt.revealed', () => load().catch(() => {}));
  useCoupleEvent('date.updated', () => load().catch(() => {}));

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
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
          <View style={{ alignItems: 'center', paddingVertical: sp.xxxl, gap: sp.md }}>
            <Skeleton height={88} width={88} round={44} />
            <Skeleton height={32} width={220} />
            <Skeleton height={16} width={160} />
          </View>
          <Skeleton height={140} style={{ marginBottom: sp.lg }} />
          <Skeleton height={96} style={{ marginBottom: sp.lg }} />
          <Skeleton height={96} />
        </View>
      </Screen>
    );
  }

  const basis = data.daysBasis ?? data.couple?.created_at ?? new Date().toISOString();
  const days = daysSince(basis);
  const now = new Date();
  const upcoming = [...data.milestones]
    .map((m) => ({ ...m, next: nextOccurrence(m.date, m.kind, now) }))
    .filter((m) => m.next.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime())
    .sort((a, b) => a.next.getTime() - b.next.getTime())
    .slice(0, 2);
  const initials = [user?.display_name?.[0], data.partner?.display_name?.[0]].filter(Boolean).join(' ♥ ');

  const copyCode = async () => {
    if (!data.couple) return;
    await Clipboard.setStringAsync(data.couple.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addBucketItem = async () => {
    const title = newItem.trim();
    if (!title) return;
    setNewItem('');
    try {
      const res = await api<{ item: HomeData['bucket'][0] }>('/api/bucket', { method: 'POST', body: { title } });
      setData((d) => (d ? { ...d, bucket: [res.item, ...d.bucket].slice(0, 5) } : d));
    } catch {
      setNewItem(title);
    }
  };

  const toggleBucketItem = async (id: string) => {
    successHaptic();
    setData((d) => (d ? { ...d, bucket: d.bucket.filter((b) => b.id !== id) } : d));
    await api(`/api/bucket/${id}`, { method: 'PATCH', body: { done: true } }).catch(() => load().catch(() => {}));
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {!wide && (
          <View style={styles.heroChrome}>
            <NudgeButton />
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <BellButton />
              <SettingsButton />
            </View>
          </View>
        )}

        <FadeIn>
          <View style={styles.hero}>
            <View style={styles.monogram}>
              <Text style={styles.monogramText}>{initials || '✦'}</Text>
            </View>
            <Text style={[text.display, styles.heroDays]}>
              {days.toLocaleString()} {days === 1 ? 'day' : 'days'} of you two
            </Text>
            <Text style={[text.caption, { textAlign: 'center' }]}>
              since {formatDay(basis)}
              {upcoming[0] ? `  ·  ${upcoming[0].title} in ${countdownTo(upcoming[0].next, now).days} days` : ''}
            </Text>
          </View>
        </FadeIn>

        {!data.partner && data.couple && (
          <FadeIn delay={40}>
            <Section label="Just you here so far">
              <Card>
                <Text style={[text.bodySerif, { marginBottom: sp.base }]}>
                  Ours is better with your person in it. Share your code and everything you have added comes with you.
                </Text>
                <AppPressable onPress={copyCode} style={styles.codeChip}>
                  <Text style={styles.codeText}>{data.couple.invite_code}</Text>
                  <Text style={text.caption}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
                </AppPressable>
                <SecondaryButton title="I have their code" onPress={() => router.push('/pair')} />
              </Card>
            </Section>
          </FadeIn>
        )}

        {/* Today's prompt */}
        <FadeIn delay={80}>
          <Section label="Today's prompt" trailing={
            <Pressable onPress={() => router.push('/prompts')} hitSlop={8}>
              <Text style={[text.caption, { color: colors.accent }]}>History</Text>
            </Pressable>
          }>
            {!data.prompt.myAnswer ? (
              <Card sealed>
                <Text style={styles.promptQuestion}>{data.prompt.prompt.text}</Text>
                {data.prompt.partnerAnswered && (
                  <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginBottom: sp.md }]}>
                    Their answer is waiting for yours.
                  </Text>
                )}
                <PrimaryButton inverted title="Answer" onPress={() => setAnswerOpen(true)} />
              </Card>
            ) : !data.prompt.bothAnswered ? (
              <Card>
                <Text style={[text.bodySerif, { fontStyle: 'italic', marginBottom: sp.sm }]}>
                  {data.prompt.prompt.text}
                </Text>
                <Text style={text.caption}>✦ You answered. Waiting for your partner.</Text>
              </Card>
            ) : (
              <Card>
                <Text style={[text.bodySerif, { fontStyle: 'italic', marginBottom: sp.base }]}>
                  {data.prompt.prompt.text}
                </Text>
                <Text style={text.micro}>You</Text>
                <Text style={[text.bodySerif, { marginBottom: sp.md }]}>{data.prompt.myAnswer}</Text>
                <View style={styles.divider} />
                <Text style={text.micro}>{data.partner?.display_name ?? 'Them'}</Text>
                <Text style={text.bodySerif}>{data.prompt.partnerAnswer}</Text>
              </Card>
            )}
          </Section>
        </FadeIn>

        {/* Weekly reflection, Sundays only */}
        {data.isSunday && data.reflection && (
          <FadeIn delay={120}>
            <Section label="This week">
              <ReflectionCard
                reflection={data.reflection}
                onSaved={() => setData((d) => (d && d.reflection ? { ...d, reflection: { ...d.reflection, saved: true } } : d))}
                onOpenHistory={() => router.push('/reflections')}
              />
            </Section>
          </FadeIn>
        )}

        {data.upcomingDate && (
          <FadeIn delay={120}>
            <Section label="Upcoming date">
              <PressableCard onPress={() => router.push('/dates')}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={text.subtitle}>{data.upcomingDate.title}</Text>
                    <Text style={text.caption}>
                      {formatDay(data.upcomingDate.proposed_for)}
                      {data.upcomingDate.location ? ` · ${data.upcomingDate.location}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.upcomingDays}>
                    {daysUntilLabel(data.upcomingDate.proposed_for)}
                  </Text>
                </View>
              </PressableCard>
            </Section>
          </FadeIn>
        )}

        {upcoming.length > 0 && (
          <FadeIn delay={160}>
            <Section label="Coming up soon">
              <Card>
                {upcoming.map((m, i) => {
                  const c = countdownTo(m.next, now);
                  return (
                    <AppPressable key={m.id} onPress={() => router.push('/milestones')}>
                      <View style={[styles.rowBetween, i > 0 && styles.rowTopBorder]}>
                        <View style={{ flex: 1 }}>
                          <Text style={text.subtitle}>{m.title}</Text>
                          <Text style={text.caption}>{formatDay(m.next.toISOString())}</Text>
                        </View>
                        <Text style={styles.upcomingDays}>{c.days === 0 ? 'today ♥' : `${c.days}d`}</Text>
                      </View>
                    </AppPressable>
                  );
                })}
              </Card>
            </Section>
          </FadeIn>
        )}

        <FadeIn delay={200}>
          <Section label="Our list">
            <Card>
              {data.bucket.length === 0 && (
                <Text style={[text.caption, { marginBottom: sp.sm }]}>Your bucket list is empty.</Text>
              )}
              {data.bucket.map((item) => (
                <AppPressable key={item.id} onPress={() => toggleBucketItem(item.id)}>
                  <View style={styles.bucketRow}>
                    <View style={styles.checkbox} />
                    <Text style={[text.body, { flex: 1 }]}>{item.title}</Text>
                  </View>
                </AppPressable>
              ))}
              <View style={styles.bucketComposer}>
                <TextInput
                  value={newItem}
                  onChangeText={setNewItem}
                  placeholder="Someday, together we will..."
                  placeholderTextColor={colors.inkFaint}
                  style={styles.bucketInput}
                  onSubmitEditing={addBucketItem}
                />
                <AppPressable onPress={addBucketItem} disabled={!newItem.trim()} style={[styles.bucketAdd, !newItem.trim() && { opacity: 0.4 }]}>
                  <Text style={{ color: colors.onSealed, fontSize: 18, lineHeight: 20 }}>＋</Text>
                </AppPressable>
              </View>
            </Card>
          </Section>
        </FadeIn>

        {data.pinnedNote && (
          <FadeIn delay={240}>
            <Section label="Pinned on your wall">
              <PressableCard onPress={() => router.push('/notes')}>
                <Text style={text.bodySerif} numberOfLines={3}>
                  {data.pinnedNote.body}
                </Text>
                <Text style={[text.caption, { marginTop: sp.sm }]}>{data.pinnedNote.author_name} ✦</Text>
              </PressableCard>
            </Section>
          </FadeIn>
        )}

        {data.resurfaced && (
          <FadeIn delay={280}>
            <Section label={data.resurfaced.tag}>
              <PressableCard onPress={() => router.push('/memories')}>
                <View style={{ flexDirection: 'row', gap: sp.base, alignItems: 'center' }}>
                  {data.resurfaced.thumb_data && (
                    <Image source={{ uri: data.resurfaced.thumb_data }} style={styles.resurfacedPhoto} contentFit="cover" />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={text.bodySerif} numberOfLines={3}>
                      {data.resurfaced.note}
                    </Text>
                    <Text style={[text.caption, { marginTop: sp.xs }]}>{formatDay(data.resurfaced.memory_date)}</Text>
                  </View>
                </View>
              </PressableCard>
            </Section>
          </FadeIn>
        )}

        {encryption && (
          <View style={styles.lockLine}>
            <Lock size={12} color={colors.inkFaint} strokeWidth={1.75} />
            <Text style={[text.caption, { color: colors.inkFaint }]}>
              Encrypted at rest, kept just for the two of you.
            </Text>
          </View>
        )}
      </ScrollView>

      <AnswerSheet
        open={answerOpen}
        question={data.prompt.prompt.text}
        onClose={() => setAnswerOpen(false)}
        onSubmitted={(state) => {
          setAnswerOpen(false);
          setData((d) => (d ? { ...d, prompt: state } : d));
        }}
      />
    </Screen>
  );
}

function daysUntilLabel(date: string): string {
  const d = daysSince(date) === 0 ? 0 : -daysSince(date);
  const target = new Date(date);
  const today = new Date();
  const diff = Math.round(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  );
  void d;
  return diff <= 0 ? 'today ♥' : `${diff}d`;
}

function AnswerSheet({
  open,
  question,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  question: string;
  onClose: () => void;
  onSubmitted: (state: PromptState) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await api<PromptState>('/api/prompt/today', { method: 'POST', body: { text: answer.trim() } });
      successHaptic();
      setAnswer('');
      onSubmitted(state);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={open} onClose={onClose} title="Today's prompt">
      <Text style={[text.bodySerif, { fontStyle: 'italic', marginBottom: sp.lg }]}>{question}</Text>
      <TextField
        value={answer}
        onChangeText={setAnswer}
        placeholder="Only they will read this"
        multiline
        style={{ height: 96 }}
      />
      {error ? <Text style={[text.caption, { color: colors.danger, marginBottom: sp.md }]}>{error}</Text> : null}
      <Text style={[text.caption, { marginBottom: sp.lg }]}>
        Your answer stays hidden until you have both written one.
      </Text>
      <PrimaryButton title="Answer" onPress={submit} loading={busy} disabled={!answer.trim()} />
    </Sheet>
  );
}

function ReflectionCard({
  reflection,
  onSaved,
  onOpenHistory,
}: {
  reflection: NonNullable<HomeData['reflection']>;
  onSaved: () => void;
  onOpenHistory: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const labels: Record<string, string> = {
    memories: 'memories',
    notes: 'notes',
    prompts_together: 'prompts together',
    hearts: 'hearts',
    bucket_added: 'list items',
    nudges: 'nudges',
  };

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/reflection', { method: 'POST' });
      successHaptic();
      onSaved();
    } catch {
      // soft failure; the card stays savable
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <View style={styles.reflectionRule} />
      <Text style={[text.title, { marginBottom: sp.base }]}>
        {formatDay(reflection.week_start)} to {formatDay(reflection.week_end)}
      </Text>
      <View style={{ flexDirection: 'row', gap: sp.base }}>
        <View style={styles.reflectionGrid}>
          {Object.entries(labels).map(([key, label]) => (
            <View key={key} style={styles.reflectionStat}>
              <Text style={[text.title, { color: colors.surfaceSealed }]}>
                {(reflection.counts[key] ?? 0).toLocaleString()}
              </Text>
              <Text style={text.caption}>{label}</Text>
            </View>
          ))}
        </View>
        {reflection.highlight?.thumb_data && (
          <Image source={{ uri: reflection.highlight.thumb_data }} style={styles.reflectionHighlight} contentFit="cover" />
        )}
      </View>
      <View style={[styles.rowBetween, { marginTop: sp.lg }]}>
        <Pressable onPress={onOpenHistory} hitSlop={8}>
          <Text style={[text.caption, { color: colors.accent }]}>Past weeks</Text>
        </Pressable>
        <SecondaryButton
          title={reflection.saved ? 'Saved ✓' : 'Save this week'}
          onPress={save}
          loading={saving}
          disabled={reflection.saved}
        />
      </View>
    </Card>
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
  heroChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hero: {
    alignItems: 'center',
    paddingVertical: sp.xxl,
  },
  monogram: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sp.lg,
  },
  monogramText: {
    ...text.subtitle,
    color: colors.surfaceSealed,
  },
  heroDays: {
    textAlign: 'center',
    marginBottom: sp.sm,
  },
  promptQuestion: {
    ...text.bodySerif,
    fontSize: 22,
    lineHeight: 30,
    fontStyle: 'italic',
    color: colors.onSealed,
    textAlign: 'center',
    marginVertical: sp.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginBottom: sp.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sp.md,
    paddingVertical: sp.sm,
  },
  rowTopBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  upcomingDays: {
    ...text.subtitle,
    color: colors.surfaceSealed,
  },
  codeChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    alignItems: 'center',
    paddingVertical: sp.md,
    marginBottom: sp.md,
  },
  codeText: {
    ...text.title,
    letterSpacing: 8,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  bucketComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    marginTop: sp.md,
  },
  bucketInput: {
    flex: 1,
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    fontSize: 15,
    color: colors.ink,
  },
  bucketAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resurfacedPhoto: {
    width: 84,
    height: 84,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  reflectionRule: {
    height: 1,
    backgroundColor: colors.accent,
    marginBottom: sp.base,
  },
  reflectionGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  reflectionStat: {
    width: '33.3%',
    marginBottom: sp.md,
  },
  reflectionHighlight: {
    width: 88,
    height: 88,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  lockLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.sm,
    marginTop: sp.xl,
  },
});
