import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Flame, X } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { tapHaptic } from '@/lib/haptics';
import { Avatar } from '@/components/Avatar';
import { Card, ErrorState, PrimaryButton, Section, Skeleton } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';

/**
 * The streak, in full.
 *
 * Reached from the streak chip on Home and the prompts screen. Everything here
 * is derived from the same source of truth the server already computes
 * (`api/_lib/streak.ts`): a day counts only when BOTH partners answered that
 * day's prompt, and one missed day per Monday-to-Sunday week is forgiven.
 *
 * That weekly grace is the whole safety net, and it is free and automatic.
 * There is no currency and nothing to buy here, by design: Ours has no billing.
 */

interface StreakState {
  current: number;
  longest: number;
  countedToday: boolean;
  atRisk: boolean;
  graceUsed?: boolean;
  graceAvailable?: boolean;
  graceDay?: string | null;
}

interface AnswerDay {
  date: string;
  mine: boolean;
  theirs: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function StreakScreen() {
  const { status, user, partner } = useAuth();
  const router = useRouter();
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [days, setDays] = useState<AnswerDay[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ streak?: StreakState; days?: AnswerDay[] }>('/api/prompt/today?days=1');
    setStreak(data.streak ?? null);
    setDays(data.days ?? []);
  }, []);

  useEffect(() => {
    if (status === 'signedIn') load().catch(() => setFailed(true));
  }, [status, load]);

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

  const close = () => router.back();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your streak</Text>
        <Pressable onPress={close} hitSlop={10} style={styles.closeBtn}>
          <X size={22} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
      </View>

      {failed && !streak ? (
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      ) : !streak || !days ? (
        <View style={styles.body}>
          <Skeleton height={140} style={{ marginBottom: sp.lg }} />
          <Skeleton height={96} style={{ marginBottom: sp.lg }} />
          <Skeleton height={220} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* The count, and what it means right now. */}
          <View style={styles.hero}>
            <View style={styles.flameDisc}>
              <Flame
                size={30}
                color={streak.current > 0 ? colors.accent : colors.inkFaint}
                strokeWidth={1.75}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroCount}>
                {streak.current} {streak.current === 1 ? 'day' : 'days'}
              </Text>
              <Text style={styles.heroLine}>
                {streak.current === 0
                  ? 'No streak yet. Answer today and it begins.'
                  : streak.countedToday
                    ? 'Both of you answered today. Lovely.'
                    : 'Alive, and waiting on today. One answer each keeps it going.'}
              </Text>
            </View>
          </View>

          {streak.longest > 0 && (
            <Text style={styles.longest}>
              Your longest run so far is {streak.longest} {streak.longest === 1 ? 'day' : 'days'}.
            </Text>
          )}

          {/* The weekly grace. Free, automatic, and never a purchase. */}
          <Section label="Your grace day">
            <Card>
              <View style={styles.graceRow}>
                <View style={[styles.graceDisc, streak.graceAvailable === false && styles.graceDiscSpent]}>
                  <Text style={[styles.graceMark, streak.graceAvailable === false && { color: colors.onSealed }]}>
                    ✦
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={text.body}>
                    {streak.graceAvailable === false ? 'Used this week' : 'Unused this week'}
                  </Text>
                  <Text style={text.caption}>
                    {streak.graceAvailable === false
                      ? streak.graceDay
                        ? `It quietly covered ${formatDay(streak.graceDay)}, so your streak held.`
                        : 'It quietly covered a missed day, so your streak held.'
                      : 'One missed day each week is forgiven, on its own. Nothing to buy, nothing to remember.'}
                  </Text>
                </View>
              </View>
              <Text style={styles.graceFoot}>
                A new grace day arrives every Monday.
              </Text>
            </Card>
          </Section>

          {/* Both of you, side by side, then the shared month. */}
          <Section label="Together">
            <View style={styles.pairRow}>
              <PersonCell
                name="You"
                avatar={user?.avatar}
                displayName={user?.display_name}
                answeredToday={days.some((d) => d.date === todayKey() && d.mine)}
              />
              <PersonCell
                name={partner?.display_name ?? 'Your person'}
                avatar={partner?.avatar}
                displayName={partner?.display_name}
                answeredToday={days.some((d) => d.date === todayKey() && d.theirs)}
                muted={!partner}
              />
            </View>
          </Section>

          <Section label="Your days">
            <StreakCalendar days={days} partnerName={partner?.display_name ?? 'Them'} />
          </Section>

          <Card>
            <Text style={[text.bodySerif, { marginBottom: sp.sm }]}>How it works</Text>
            <Text style={text.caption}>
              A day joins your streak when you have both answered that day's question. Miss one and the week's
              grace day covers it. Miss a second in the same week and the streak starts fresh, with no fuss and
              nothing lost. Your memories, notes and everything else stay exactly where they are.
            </Text>
          </Card>

          {!streak.countedToday && (
            <PrimaryButton
              title="Answer today's question"
              onPress={() => router.replace('/prompts')}
              style={{ marginTop: sp.lg }}
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function PersonCell({
  name,
  avatar,
  displayName,
  answeredToday,
  muted = false,
}: {
  name: string;
  avatar?: string | null;
  displayName?: string | null;
  answeredToday: boolean;
  muted?: boolean;
}) {
  return (
    <View style={[styles.personCell, muted && { opacity: 0.55 }]}>
      <Avatar id={avatar} name={displayName ?? name} size={38} />
      <Text style={styles.personName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[text.micro, { color: answeredToday ? colors.positive : colors.inkFaint }]}>
        {answeredToday ? 'answered today' : 'not yet today'}
      </Text>
    </View>
  );
}

/**
 * The shared month. A ♥ marks a day you both answered (the days that actually
 * count); a half mark means only one of you did. Mirrors the Memories calendar
 * so the two read as the same object.
 */
function StreakCalendar({ days, partnerName }: { days: AnswerDay[]; partnerName: string }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const byDate = new Map(days.map((d) => [d.date, d]));

  const shift = (delta: number) => {
    tapHaptic();
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const monthName = new Date(year, month, 1).toLocaleString('en', { month: 'long' });

  return (
    <Card>
      <View style={styles.calendarHeader}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.calendarArrow}>
          <ChevronLeft size={18} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={text.subtitle}>
          {monthName} {year}
        </Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.calendarArrow}>
          <ChevronRight size={18} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`b${i}`} style={styles.cell} />;
          const key = dayKey(year, month, day);
          const entry = byDate.get(key);
          const both = !!entry?.mine && !!entry?.theirs;
          const one = !!entry && !both;
          const isToday = isCurrentMonth && day === today.getDate();
          return (
            <View key={key} style={[styles.cell, isToday && styles.cellToday]}>
              {both ? (
                <Text style={styles.cellHeart}>♥</Text>
              ) : one ? (
                <Text style={styles.cellHalf}>♡</Text>
              ) : (
                <Text style={[text.caption, { color: colors.inkFaint }]}>{day}</Text>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendItem}>
          <Text style={styles.cellHeart}>♥</Text> both of you
        </Text>
        <Text style={styles.legendItem}>
          <Text style={styles.cellHalf}>♡</Text> one of you
        </Text>
      </View>
      <Text style={[text.caption, { textAlign: 'center', marginTop: sp.xs }]}>
        Only the days you and {partnerName} both answered count toward the streak.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.xl,
    paddingBottom: sp.md,
  },
  headerTitle: { ...text.title, fontFamily: font.displayMedium },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: {
    padding: sp.xl,
    paddingTop: sp.sm,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.base,
    marginBottom: sp.md,
  },
  flameDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCount: {
    ...text.display,
    fontFamily: font.displayMedium,
  },
  heroLine: {
    ...text.bodySerif,
    color: colors.inkMuted,
  },
  longest: {
    ...text.caption,
    marginBottom: sp.xl,
  },
  graceRow: { flexDirection: 'row', alignItems: 'center', gap: sp.base },
  graceDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  graceDiscSpent: { backgroundColor: colors.surfaceSealed, borderColor: colors.surfaceSealed },
  graceMark: { color: colors.accent, fontSize: 16 },
  graceFoot: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.inkFaint,
    marginTop: sp.md,
  },
  pairRow: { flexDirection: 'row', gap: sp.md },
  personCell: {
    flex: 1,
    alignItems: 'center',
    gap: sp.xs,
    paddingVertical: sp.base,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  personName: { ...text.body, maxWidth: '90%' },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.md,
  },
  calendarArrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', marginBottom: sp.xs },
  weekday: { flex: 1, textAlign: 'center', ...text.micro, color: colors.inkMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1.1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  cellToday: { borderWidth: 1, borderColor: colors.accent },
  cellHeart: { fontSize: 15, color: colors.surfaceSealed },
  cellHalf: { fontSize: 15, color: colors.accent },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: sp.lg,
    marginTop: sp.md,
  },
  legendItem: { ...text.caption, color: colors.inkMuted },
});
