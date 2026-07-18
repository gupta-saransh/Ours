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
import { colors, font, radius, sp, text } from '@/theme';
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
  recent?: { kind: string; points: number; created_at: string }[];
}

interface GameState {
  game: { game_date: string; round: number; a: string; b: string };
  /** 1 or 2: there are two questions a day (v18). */
  round: number;
  /** Set while round one is done and round two has not opened yet. */
  nextRoundAt: string | null;
  played: boolean;
  partnerPlayed: boolean;
  mine: { pick: 'a' | 'b'; guess: 'a' | 'b' } | null;
  reveal: { partnerPick: 'a' | 'b'; iGuessedRight: boolean; theyGuessedRight: boolean } | null;
}

// Client copies of the server's levels + point sources (api/_routes/home.ts);
// keep in sync.
const LEVELS: { at: number; title: string }[] = [
  { at: 0, title: 'First Glance' },
  { at: 15, title: 'Getting Closer' },
  { at: 40, title: 'Finding Our Rhythm' },
  { at: 80, title: 'Love Letters' },
  { at: 140, title: 'Slow Dances' },
  { at: 220, title: 'Golden Hours' },
  { at: 320, title: 'Building a Life' },
  { at: 450, title: 'The Long Song' },
  { at: 620, title: 'A Thousand Days' },
  { at: 850, title: 'Ever After' },
];

// How the road ceremony describes the place you reached: real things, never a
// score. Singular/plural forms for the top few counts.
const MADE_OF: { key: string; one: string; many: string }[] = [
  { key: 'memories', one: 'memory', many: 'memories' },
  { key: 'notes', one: 'little note', many: 'little notes' },
  { key: 'answers', one: 'answered question', many: 'answered questions' },
  { key: 'dates_done', one: 'date', many: 'dates' },
  { key: 'bucket_done', one: 'wish come true', many: 'wishes come true' },
  { key: 'milestones', one: 'day that matters', many: 'days that matter' },
  { key: 'comments', one: 'comment', many: 'comments' },
  { key: 'guesses', one: 'right guess', many: 'right guesses' },
];

// How a recent road-moving moment reads in "What moved you lately".
const RECENT_LABEL: Record<string, string> = {
  memory: 'A memory you kept',
  note: 'A note you left',
  answer: 'A question you answered',
  comment: 'A comment under a memory',
  milestone: 'A day you marked',
  bucket: 'A wish that came true',
  date: 'A date you went on',
  guess: 'A right guess',
  todo: 'A to-do you finished',
};

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
  game: GameState | null;
  todos: {
    weekDone: number;
    weekTotal: number;
    overdue: number;
    todayTotal: number;
    todayDone: number;
    wins: { title: string; done_by: string | null }[];
  } | null;
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
  useCoupleEvent('game.updated', () => load().catch(() => {}));

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
              <AppPressable onPress={() => router.push('/streak')} style={styles.streakChip}>
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

        {/* This-or-That: the daily two-tap game with a mutual reveal. */}
        {data.game && (
          <FadeIn delay={90}>
            <Section label="Today's This or That">
              <GameCard
                state={data.game}
                partnerName={data.partner?.display_name ?? 'your partner'}
                hasPartner={!!data.partner}
                onPlayed={(next) => setData((d) => (d ? { ...d, game: next } : d))}
              />
            </Section>
          </FadeIn>
        )}

        {/* The winding path: where you two are, never a number. Tap to unfold
            what moved you lately; "See the whole road" opens the map. */}
        {data.story && (
          <FadeIn delay={100}>
            <Section label="Your path">
              <PressableCard
                onPress={() => {
                  tapHaptic();
                  setStoryOpen((o) => !o);
                }}
              >
                {/* The road: passed places gold, you two at the heart, the rest ahead. */}
                <View style={styles.pathTrack}>
                  {LEVELS.map((_, i) => {
                    const n = i + 1;
                    if (n === data.story.level) {
                      return (
                        <Text key={i} style={styles.pathHere}>
                          ♥
                        </Text>
                      );
                    }
                    return <View key={i} style={[styles.pathDot, n < data.story.level && styles.pathDotPassed]} />;
                  })}
                </View>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={text.micro}>You two are at</Text>
                    <Text style={[text.subtitle, { marginTop: 2 }]}>{data.story.levelTitle}</Text>
                    <Text style={[text.caption, { marginTop: sp.xs }]}>
                      {data.story.nextAt !== null
                        ? `The road bends on toward ${LEVELS[data.story.level]?.title ?? 'somewhere new'}.`
                        : 'The far end of the road. You walk on together. ♥'}
                    </Text>
                  </View>
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
                      The road moves as your life fills this place: memories, little notes, answers to the daily
                      question, dates you go on, wishes that come true. No score, no hurry. Just keep going.
                    </Text>
                    {data.story.recent && data.story.recent.length > 0 && (
                      <>
                        <Text style={[text.micro, { marginBottom: sp.xs }]}>What moved you lately</Text>
                        {data.story.recent.map((r, i) => (
                          <View key={`${r.kind}-${r.created_at}-${i}`} style={styles.storySourceRow}>
                            <Text style={text.caption}>{RECENT_LABEL[r.kind] ?? 'Something you kept'}</Text>
                            <Text style={[text.caption, { color: colors.accent }]}>{formatDay(r.created_at)}</Text>
                          </View>
                        ))}
                      </>
                    )}
                    <Pressable
                      onPress={() => setLevelsOpen(true)}
                      hitSlop={8}
                      style={{ alignSelf: 'center', marginTop: sp.md }}
                    >
                      <Text style={[text.caption, { color: colors.accent }]}>See the whole road</Text>
                    </Pressable>
                  </View>
                )}
              </PressableCard>
            </Section>
          </FadeIn>
        )}

        {/* Weekly to-do standing: what got done together, what is still waiting. */}
        {data.todos && (data.todos.weekTotal > 0 || data.todos.overdue > 0) && (
          <FadeIn delay={110}>
            <Section label="Keeping each other on track">
              <PressableCard onPress={() => router.push('/todos')}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={text.subtitle}>
                      {data.todos.weekDone} of {data.todos.weekTotal} done this week
                    </Text>
                    {data.todos.overdue > 0 && (
                      <Text style={[text.caption, { color: colors.danger, marginTop: sp.xs }]}>
                        {data.todos.overdue} unfinished from earlier
                      </Text>
                    )}
                  </View>
                  {data.todos.todayTotal > 0 && (
                    <Text style={styles.upcomingDays}>
                      {data.todos.todayDone}/{data.todos.todayTotal} today
                    </Text>
                  )}
                </View>
                {data.todos.wins.length > 0 && (
                  <View style={{ marginTop: sp.md }}>
                    {data.todos.wins.map((w, i) => (
                      <Text
                        key={i}
                        style={[text.caption, i > 0 && { marginTop: sp.xs }]}
                        numberOfLines={1}
                      >
                        ✓ {w.title}
                        {w.done_by === user?.id ? ' · you' : data.partner ? ` · ${data.partner.display_name}` : ''}
                      </Text>
                    ))}
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
              <PressableCard onPress={() => router.push('/timeline')}>
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
              <PressableCard onPress={() => router.push('/timeline')}>
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

      {/* The road map: where you have been, where you are, what lies ahead */}
      <Sheet visible={levelsOpen} onClose={() => setLevelsOpen(false)} title="The whole road">
        <Text style={[text.caption, { marginBottom: sp.lg }]}>
          A winding road of places you pass through together. It moves as your life fills this place, and there is
          no score and no hurry. Places you have passed are marked in gold.
        </Text>
        {LEVELS.map((c, i) => {
          const n = i + 1;
          const now = n === data.story.level;
          const done = n < data.story.level;
          return (
            <View key={c.at} style={styles.chapterRow}>
              <Text style={[styles.chapterNum, done && { color: colors.accent }, now && { color: colors.surfaceSealed }]}>
                {done ? '✦' : now ? '♥' : '·'}
              </Text>
              <Text
                style={[
                  now ? text.subtitle : text.body,
                  { flex: 1 },
                  !done && !now && { color: colors.inkFaint },
                ]}
              >
                {c.title}
              </Text>
              <Text style={[text.caption, { color: colors.inkFaint }]}>
                {now ? 'you are here' : done ? 'passed through' : ''}
              </Text>
            </View>
          );
        })}
      </Sheet>

      {/* Road ceremony: shown once when the couple reaches a new place */}
      <Sheet visible={!!levelReveal} onClose={() => setLevelReveal(null)} title="Somewhere new" sealed>
        {levelReveal && (
          <>
            <Text style={styles.chapterSeal}>✦ ✦</Text>
            <Text style={[text.micro, { color: colors.onSealed, textAlign: 'center' }]}>
              The road has carried you to
            </Text>
            <Text style={styles.chapterTitle}>{levelReveal.levelTitle}</Text>
            <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.md }]}>
              {madeOfSummary(levelReveal)}
            </Text>
            <PrimaryButton inverted title="Keep walking" onPress={() => setLevelReveal(null)} style={{ marginTop: sp.xl }} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/** "in 5 hours" / "in a few minutes", for when the day's second question opens. */
function opensIn(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 1) return 'any moment now';
  if (mins < 60) return `in ${mins} minutes`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? 'in an hour' : `in ${hours} hours`;
}

/**
 * The daily This-or-That, styled as the prompt card's sibling: the unplayed
 * game is a SEALED (oxblood) card with two parchment options and a gold "or",
 * the reveal is a light card with both partners' marks facing each other over
 * their picks. Two taps: pick your side, then guess theirs. Nothing shows until
 * both of you have played.
 */
function GameCard({
  state,
  partnerName,
  hasPartner,
  onPlayed,
}: {
  state: GameState;
  partnerName: string;
  hasPartner: boolean;
  onPlayed: (next: GameState) => void;
}) {
  const { user, partner } = useAuth();
  const [pick, setPick] = useState<'a' | 'b' | null>(null);
  const [busy, setBusy] = useState(false);
  const { game } = state;
  const optionText = (letter: 'a' | 'b') => (letter === 'a' ? game.a : game.b);

  const play = async (guess: 'a' | 'b') => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      const next = await api<GameState>('/api/game/today', { method: 'POST', body: { pick, guess } });
      successHaptic();
      onPlayed(next);
    } catch {
      // A 409 (already played elsewhere) or a network slip: leave the card be,
      // the next home load settles it.
    } finally {
      setBusy(false);
    }
  };

  // The duel row: two parchment options with a small gold "or" between them.
  // The flex lives on a wrapping View, NOT on AppPressable: AppPressable puts
  // its `style` on an inner Animated.View, so flex there never reaches the
  // Pressable and each option would size to its own text, leaving the row
  // lopsided (a real reported bug, do not "simplify" this back).
  const option = (letter: 'a' | 'b', onChoose: (l: 'a' | 'b') => void) => (
    <View style={styles.gameOptionCell}>
      <AppPressable
        onPress={() => {
          tapHaptic();
          onChoose(letter);
        }}
        style={styles.gameOption}
      >
        <Text style={styles.gameOptionText}>{letter === 'a' ? game.a : game.b}</Text>
      </AppPressable>
    </View>
  );

  const duelRow = (onChoose: (l: 'a' | 'b') => void) => (
    <View style={styles.gameRow}>
      {option('a', onChoose)}
      <Text style={styles.gameOr}>or</Text>
      {option('b', onChoose)}
    </View>
  );

  if (!hasPartner) {
    return (
      <Card>
        <Text style={text.caption}>
          {game.a} or {game.b}? A tiny daily game for the two of you. Pair with your person to play.
        </Text>
      </Card>
    );
  }

  // Reveal: both played. Marks face each other over the picks.
  if (state.reveal && state.mine) {
    const { reveal, mine } = state;
    return (
      <Card>
        <View style={styles.gameRevealRow}>
          <View style={styles.gameRevealSide}>
            <Avatar id={user?.avatar} name={user?.display_name} size={44} />
            <Text style={[text.subtitle, { marginTop: sp.sm }]}>{optionText(mine.pick)}</Text>
            <Text style={text.micro}>You</Text>
          </View>
          <Text style={styles.gameRevealHeart}>♥</Text>
          <View style={styles.gameRevealSide}>
            <Avatar id={partner?.avatar} name={partnerName} size={44} />
            <Text style={[text.subtitle, { marginTop: sp.sm }]}>{optionText(reveal.partnerPick)}</Text>
            <Text style={text.micro}>{partnerName}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <Text style={[text.bodySerif, { fontStyle: 'italic', textAlign: 'center' }]}>
          {reveal.iGuessedRight && reveal.theyGuessedRight
            ? 'You both knew each other. Of course you did. ♥'
            : reveal.iGuessedRight
              ? 'You guessed them right. They are still figuring you out. ♥'
              : reveal.theyGuessedRight
                ? 'They knew you. You got a little surprise.'
                : 'You surprised each other today.'}
        </Text>
        <Text style={[text.micro, { marginTop: sp.sm, textAlign: 'center' }]}>
          {state.nextRoundAt ? `One more opens ${opensIn(state.nextRoundAt)} ✦` : 'A new one tomorrow ✦'}
        </Text>
      </Card>
    );
  }

  // Played, waiting on the partner. Quiet parchment, like the prompt's waiting state.
  if (state.played && state.mine) {
    return (
      <Card>
        <Text style={[text.bodySerif, { fontStyle: 'italic', marginBottom: sp.sm }]}>
          {game.a} or {game.b}?
        </Text>
        <Text style={text.caption}>
          ✦ You said {optionText(state.mine.pick)}, and guessed {optionText(state.mine.guess)} for {partnerName}. The
          reveal comes when they play.
        </Text>
        {state.round === 2 && (
          <Text style={[text.micro, { marginTop: sp.sm }]}>The second one today ✦</Text>
        )}
      </Card>
    );
  }

  // Not played yet: the sealed duel. Step 1 pick yours, step 2 guess theirs.
  return (
    <Card sealed>
      <Text style={styles.gameQuestion}>{pick === null ? 'Which one is you?' : `And which one is ${partnerName}?`}</Text>
      {duelRow((l) => (pick === null ? setPick(l) : play(l)))}
      {pick !== null ? (
        <Pressable onPress={() => setPick(null)} hitSlop={8} style={{ alignSelf: 'center', marginTop: sp.md }}>
          <Text style={[text.caption, { color: colors.onSealed, opacity: 0.8 }]}>
            You are {optionText(pick)}. Change it
          </Text>
        </Pressable>
      ) : (
        <Text style={[text.micro, styles.gameHint]}>
          {state.partnerPlayed
            ? `${partnerName} already played ✦ two taps to the reveal`
            : state.round === 2
              ? 'Your second one today ✦ pick yours, then guess theirs'
              : 'Pick yours, then guess theirs'}
        </Text>
      )}
    </Card>
  );
}

/** "A place made of 18 memories, 12 answered questions and 9 notes." No score, only things. */
function madeOfSummary(story: StoryState): string {
  const top = MADE_OF.map((s) => ({ ...s, n: story.counts[s.key] ?? 0 }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((s) => `${s.n} ${s.n === 1 ? s.one : s.many}`);
  const list = top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}` : top[0] ?? '';
  return list ? `A place made of ${list}.` : 'A place you have made together.';
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
  // The winding road: passed places gold, a heart where you two stand.
  pathTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.base,
    paddingHorizontal: sp.xs,
  },
  pathDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.inkFaint,
    backgroundColor: colors.surfaceRaised,
  },
  pathDotPassed: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pathHere: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.surfaceSealed,
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
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
  },
  // The flex-carrying wrapper: see the comment on `option` in GameCard.
  gameOptionCell: { flex: 1 },
  // Parchment options on the sealed (oxblood) card, echoing the wax-seal duel.
  gameOption: {
    width: '100%',
    minHeight: 72,
    paddingVertical: sp.md,
    paddingHorizontal: sp.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameOptionText: {
    ...text.body,
    fontFamily: font.serif,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
    textAlign: 'center',
  },
  gameOr: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.accent,
    paddingHorizontal: sp.xs,
  },
  gameQuestion: {
    ...text.bodySerif,
    fontSize: 22,
    lineHeight: 30,
    fontStyle: 'italic',
    color: colors.onSealed,
    textAlign: 'center',
    marginVertical: sp.lg,
  },
  gameHint: {
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.onSealed,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: sp.md,
  },
  gameRevealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    marginBottom: sp.md,
  },
  gameRevealSide: {
    flex: 1,
    alignItems: 'center',
  },
  gameRevealHeart: {
    fontSize: 22,
    color: colors.surfaceSealed,
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
