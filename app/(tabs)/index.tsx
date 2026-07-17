import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronDown, Flame, Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { showHearts } from '@/components/HeartsRain';
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
import { Avatar } from '@/components/Avatar';
import { BellButton, NudgeButton, SettingsButton } from '@/components/HeaderActions';
import { colors, radius, sp, text } from '@/theme';
import { countdownTo, daysSince, formatDay, nextOccurrence } from '@/lib/format';

interface StreakState {
  current: number;
  longest: number;
  countedToday: boolean;
  atRisk: boolean;
  graceUsed?: boolean;
}

interface PromptState {
  prompt: { prompt_date: string; text: string };
  myAnswer: string | null;
  partnerAnswer: string | null;
  partnerAnswered: boolean;
  bothAnswered: boolean;
  streak?: StreakState;
}

interface StoryState {
  points: number;
  level: number;
  levelTitle: string;
  levelStart: number;
  nextAt: number | null;
  counts: Record<string, number>;
}

// Client copies of the server's levels + point sources (api/_routes/home.ts);
// keep in sync.
const LEVELS: { at: number; title: string }[] = [
  { at: 0, title: 'First Glance' },
  { at: 15, title: 'Getting Closer' },
  { at: 40, title: 'Finding Our Rhythm' },
  { at: 80, title: 'Love Letters' },
  { at: 140, title: 'Keepsakes' },
  { at: 220, title: 'Golden Hours' },
  { at: 320, title: 'Building a Life' },
  { at: 450, title: 'The Long Song' },
  { at: 620, title: 'A Thousand Days' },
  { at: 850, title: 'Ever After' },
];

const POINT_SOURCES: { key: string; label: string; per: number }[] = [
  { key: 'memories', label: 'memories', per: 5 },
  { key: 'dates_done', label: 'dates you went on', per: 5 },
  { key: 'answers', label: 'prompt answers', per: 3 },
  { key: 'bucket_done', label: 'list items done', per: 3 },
  { key: 'notes', label: 'notes', per: 2 },
  { key: 'milestones', label: 'milestones', per: 2 },
  { key: 'comments', label: 'comments', per: 1 },
];

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
  streak: StreakState;
  story: StoryState;
  nudged?: boolean;
  isSunday: boolean;
  reflection: {
    week_start: string;
    week_end: string;
    counts: Record<string, number>;
    highlight: { id: string; thumb_data: string | null; note: string } | null;
    gallery: { id: string; thumb_data: string | null; note: string }[];
    noteHighlights: string[];
    saved: boolean;
  } | null;
}

export default function Home() {
  const { user, partner: authPartner, encryption } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelReveal, setLevelReveal] = useState<StoryState | null>(null);
  const showeredRef = React.useRef(false);
  // The prompt date we last celebrated for, so the streak hearts shower fires
  // exactly once the day both partners answer (never twice, never on reopen).
  const celebratedDateRef = React.useRef<string | null>(null);

  const load = useCallback(async (): Promise<HomeData> => {
    setFailed(false);
    const home = await api<HomeData>('/api/home');
    setData(home);
    // A nudge arrived while you were away: rain hearts, once per open.
    if (home.nudged && !showeredRef.current) {
      showeredRef.current = true;
      showHearts();
    }
    // Reaching a new level earns the couple their little ceremony. The last
    // celebrated level lives client-side (web localStorage; native skips
    // quietly), so it fires once per device.
    try {
      if (typeof localStorage !== 'undefined' && home.story) {
        const prev = Number(localStorage.getItem('ours.story-chapter') || '0');
        if (prev > 0 && home.story.level > prev) setLevelReveal(home.story);
        localStorage.setItem('ours.story-chapter', String(home.story.level));
      }
    } catch {}
    return home;
  }, []);

  // A streak "extends" the moment a day becomes mutual (both answered). Reward
  // it with the hearts shower, once per prompt day, whichever partner completes
  // it: the submit response covers the second answerer, the reveal event covers
  // the first.
  const celebrateStreak = useCallback((streak: StreakState | undefined, promptDate: string | undefined) => {
    if (!streak?.countedToday || !promptDate) return;
    if (celebratedDateRef.current === promptDate) return;
    celebratedDateRef.current = promptDate;
    successHaptic();
    showHearts();
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('partner.joined', () => load().catch(() => {}));
  useCoupleEvent('prompt.answered', () => load().catch(() => {}));
  useCoupleEvent('prompt.revealed', () => {
    load()
      .then((home) => celebrateStreak(home.streak, home.prompt.prompt.prompt_date))
      .catch(() => {});
  });
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

  const addMilestone = () =>
    router.navigate({ pathname: '/milestones', params: { compose: String(Date.now()) } });

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
            {user?.avatar || authPartner?.avatar ? (
              <View style={styles.heroMarks}>
                <Avatar id={user?.avatar} name={user?.display_name} size={56} />
                {data.partner && (
                  <>
                    <Text style={styles.heroHeart}>♥</Text>
                    <Avatar id={authPartner?.avatar} name={data.partner.display_name} size={56} />
                  </>
                )}
              </View>
            ) : (
              <View style={styles.monogram}>
                <Text style={styles.monogramText}>{initials || '✦'}</Text>
              </View>
            )}
            {data.daysBasis ? (
              <>
                <Text style={[text.display, styles.heroDays]}>
                  {days.toLocaleString()} {days === 1 ? 'day' : 'days'} of you two
                </Text>
                <Text style={[text.caption, { textAlign: 'center' }]}>
                  since {formatDay(basis)}
                  {upcoming[0] ? `  ·  ${upcoming[0].title} in ${countdownTo(upcoming[0].next, now).days} days` : ''}
                </Text>
              </>
            ) : (
              <>
                <Text style={[text.display, styles.heroDays]}>Here is to you two ♥</Text>
                <AppPressable onPress={addMilestone} style={{ marginTop: sp.xs }}>
                  <Text style={[text.caption, { color: colors.accent, textAlign: 'center' }]}>
                    + Add the day it began, and we will start counting
                  </Text>
                </AppPressable>
              </>
            )}
            {data.streak && data.streak.current >= 1 && (
              <AppPressable onPress={() => router.push('/prompts')} style={styles.streakChip}>
                <Flame size={13} color={colors.accent} strokeWidth={1.75} />
                <Text style={[text.caption, { color: colors.inkMuted }]}>
                  {data.streak.current === 1 ? 'Day 1 of your streak' : `${data.streak.current} days in a row`}
                </Text>
              </AppPressable>
            )}
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
                {data.streak?.atRisk && data.streak.current >= 1 && (
                  <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.md }]}>
                    Answer today to keep your {data.streak.current} day streak going.
                  </Text>
                )}
                {data.streak && data.streak.current === 0 && data.streak.longest >= 3 && (
                  <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.md }]}>
                    You paused. Answer together to start again.
                  </Text>
                )}
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
                {data.streak && data.streak.countedToday && data.streak.current >= 1 && (
                  <Text style={[text.caption, { marginTop: sp.md }]}>
                    {data.streak.current === 1
                      ? 'Day one. Come back tomorrow to make it two. ♥'
                      : `That makes ${data.streak.current} days in a row. ♥`}
                  </Text>
                )}
              </Card>
            )}
          </Section>
        </FadeIn>

        {/* Relationship points: a gentle meter of everything you two build here.
            Tap to unfold where the points came from; "All levels" opens the map. */}
        {data.story && (
          <FadeIn delay={100}>
            <Section label="Your journey">
              <PressableCard
                onPress={() => {
                  tapHaptic();
                  setStoryOpen((o) => !o);
                }}
              >
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={text.micro}>Level {data.story.level}</Text>
                    <Text style={[text.subtitle, { marginTop: 2 }]}>{data.story.levelTitle}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: sp.xs }}>
                    <Text style={[text.subtitle, { color: colors.accent }]}>
                      {data.story.points.toLocaleString()}
                    </Text>
                    <Text style={text.micro}>points</Text>
                  </View>
                </View>
                <View style={styles.storyTrack}>
                  <View style={[styles.storyFill, { flex: storyProgress(data.story) }]} />
                  <View style={{ flex: 100 - storyProgress(data.story) }} />
                </View>
                <View style={[styles.rowBetween, { marginTop: sp.sm }]}>
                  <Text style={text.caption}>
                    {data.story.nextAt !== null
                      ? `${data.story.nextAt - data.story.points} points to Level ${data.story.level + 1}`
                      : 'You have reached the final level. ♥'}
                  </Text>
                  <ChevronDown
                    size={16}
                    color={colors.inkFaint}
                    strokeWidth={1.75}
                    style={storyOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
                  />
                </View>
                {storyOpen && (
                  <View style={styles.storyBreakdown}>
                    <Text style={[text.caption, { marginBottom: sp.md }]}>
                      Every memory, note, date, prompt, and milestone you two make earns points. They add up into
                      levels, a keepsake of all you are building together. Nothing to chase, just yours to grow.
                    </Text>
                    {POINT_SOURCES.map((s) => {
                      const n = data.story.counts[s.key] ?? 0;
                      return (
                        <View key={s.key} style={styles.storySourceRow}>
                          <Text style={[text.body, n === 0 && { color: colors.inkFaint }]}>
                            {n} {s.label}
                          </Text>
                          <Text style={[text.caption, n === 0 && { color: colors.inkFaint }]}>
                            {n * s.per} {n * s.per === 1 ? 'point' : 'points'}
                          </Text>
                        </View>
                      );
                    })}
                    <Pressable
                      onPress={() => setLevelsOpen(true)}
                      hitSlop={8}
                      style={{ alignSelf: 'center', marginTop: sp.md }}
                    >
                      <Text style={[text.caption, { color: colors.accent }]}>All levels</Text>
                    </Pressable>
                  </View>
                )}
              </PressableCard>
            </Section>
          </FadeIn>
        )}

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

        <FadeIn delay={160}>
          <Section
            label="Coming up soon!"
            trailing={
              <Pressable onPress={addMilestone} hitSlop={8}>
                <Text style={[text.caption, { color: colors.accent }]}>+ Add</Text>
              </Pressable>
            }
          >
            <Card>
              {upcoming.length === 0 ? (
                <Text style={text.caption}>
                  No dates marked yet. Add an anniversary or birthday to start the countdown.
                </Text>
              ) : (
                upcoming.map((m, i) => {
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
                })
              )}
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
          setData((d) => (d ? { ...d, prompt: state, streak: state.streak ?? d.streak } : d));
          if (state.streak?.graceUsed) toast.show('Grace day used. Streak continues.');
          // Second answerer completes the day: reward the extended streak now.
          celebrateStreak(state.streak, state.prompt.prompt_date);
        }}
      />

      {/* The level map: where you have been, where you are, what comes next */}
      <Sheet visible={levelsOpen} onClose={() => setLevelsOpen(false)} title="Your levels">
        <Text style={[text.caption, { marginBottom: sp.lg }]}>
          Everything you two make together earns points, and points carry you through these levels. It is not a
          score to win, just a quiet measure of how much you are building.
        </Text>
        {LEVELS.map((c, i) => {
          const n = i + 1;
          const now = n === data.story.level;
          const done = n < data.story.level;
          return (
            <View key={c.at} style={styles.chapterRow}>
              <Text style={[styles.chapterNum, done && { color: colors.accent }]}>{done ? '✦' : n}</Text>
              <Text
                style={[
                  now ? text.subtitle : text.body,
                  { flex: 1 },
                  !done && !now && { color: colors.inkFaint },
                ]}
              >
                {c.title}
              </Text>
              <Text style={[text.caption, !done && !now && { color: colors.inkFaint }]}>
                {now ? `${data.story.points} pts` : done ? '' : `${c.at} pts`}
              </Text>
            </View>
          );
        })}
        <Text style={[text.caption, { textAlign: 'center', marginTop: sp.lg }]}>
          Memories and dates earn 5 points. Prompts and list items, 3. Notes and milestones, 2. Comments, 1.
        </Text>
      </Sheet>

      {/* Level-up ceremony: shown once when the couple reaches a new level */}
      <Sheet visible={!!levelReveal} onClose={() => setLevelReveal(null)} title="A new level" sealed>
        {levelReveal && (
          <>
            <Text style={styles.chapterSeal}>✦ ✦</Text>
            <Text style={[text.micro, { color: colors.onSealed, textAlign: 'center' }]}>
              Level {levelReveal.level}
            </Text>
            <Text style={styles.chapterTitle}>{levelReveal.levelTitle}</Text>
            <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.md }]}>
              {pointsSummary(levelReveal)}
            </Text>
            <PrimaryButton inverted title="Keep going" onPress={() => setLevelReveal(null)} style={{ marginTop: sp.xl }} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/** "127 points so far: 18 memories, 12 prompt answers, 9 notes." Top three sources. */
function pointsSummary(story: StoryState): string {
  const top = POINT_SOURCES.map((s) => ({ ...s, n: story.counts[s.key] ?? 0 }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n * b.per - a.n * a.per)
    .slice(0, 3)
    .map((s) => `${s.n} ${s.label}`);
  const list = top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}` : top[0] ?? '';
  return list
    ? `${story.points} points so far: ${list}.`
    : `${story.points} points so far.`;
}

/** 0-100 progress through the current level; never fully empty so the bar reads as begun. */
function storyProgress(story: StoryState): number {
  if (story.nextAt === null) return 100;
  const span = story.nextAt - story.levelStart;
  const done = story.points - story.levelStart;
  return Math.min(100, Math.max(4, Math.round((done / span) * 100)));
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

  const photos = reflection.gallery?.filter((g) => g.thumb_data) ?? [];
  const noteExcerpt = reflection.noteHighlights?.[0];

  return (
    <Card>
      <View style={styles.reflectionRule} />
      <Text style={[text.title, { marginBottom: sp.base }]}>
        {formatDay(reflection.week_start)} to {formatDay(reflection.week_end)}
      </Text>

      {photos.length > 0 && (
        <View style={styles.reflectionStrip}>
          {photos.map((g) => (
            <Image key={g.id} source={{ uri: g.thumb_data! }} style={styles.reflectionStripPhoto} contentFit="cover" />
          ))}
        </View>
      )}

      {noteExcerpt ? (
        <Text style={styles.reflectionQuote} numberOfLines={3}>
          &ldquo;{noteExcerpt}&rdquo;
        </Text>
      ) : null}

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

      <View style={[styles.rowBetween, { marginTop: sp.lg }]}>
        <Pressable onPress={onOpenHistory} hitSlop={8}>
          <Text style={[text.caption, { color: colors.accent }]}>Saved weeks</Text>
        </Pressable>
        <SecondaryButton
          title={reflection.saved ? 'Saved ✓' : 'Keep this week'}
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
  heroMarks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    marginBottom: sp.lg,
  },
  heroHeart: {
    fontSize: 16,
    color: colors.surfaceSealed,
  },
  storyTrack: {
    flexDirection: 'row',
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    marginTop: sp.base,
    overflow: 'hidden',
  },
  storyFill: {
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  storyBreakdown: {
    marginTop: sp.base,
    paddingTop: sp.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  storySourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: sp.xs,
    gap: sp.md,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.sm,
  },
  chapterNum: {
    ...text.caption,
    width: 20,
    textAlign: 'center',
  },
  chapterSeal: {
    fontSize: 22,
    color: colors.accent,
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: sp.lg,
  },
  chapterTitle: {
    ...text.display,
    color: colors.onSealed,
    textAlign: 'center',
    marginTop: sp.xs,
  },
  heroDays: {
    textAlign: 'center',
    marginBottom: sp.sm,
  },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.xs,
    marginTop: sp.md,
    paddingHorizontal: sp.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: sp.md,
  },
  reflectionStat: {
    width: '33.3%',
    marginBottom: sp.md,
  },
  reflectionStrip: {
    flexDirection: 'row',
    gap: sp.sm,
    marginBottom: sp.md,
  },
  reflectionStripPhoto: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  reflectionQuote: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.inkMuted,
    marginBottom: sp.sm,
  },
  lockLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.sm,
    marginTop: sp.xl,
  },
});
