import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, LockKeyhole, RefreshCw } from 'lucide-react-native';
import { apiUrl } from '@/lib/api';
import { BarList, Legend, Sparkline, StackStrip, TrendChart, seriesColor } from '@/components/charts';
import { FormError, PrimaryButton, Screen, TextField } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

/**
 * /admin/dashboard — the operator's view of the product.
 *
 * Gated by a single password (ADMIN_PASSWORD in Vercel), deliberately outside
 * the (auth)/(tabs) groups so it never touches, or is touched by, a couple's
 * own session: the admin token lives only in this screen's state, never
 * localStorage, never the shared api() client.
 *
 * WHAT THIS SCREEN IS FOR. Five questions, in the order an operator asks them:
 *   1. Is anything broken?           -> health strip, first, above the fold
 *   2. Is it growing?                -> KPI cards, each with a delta and a shape
 *   3. Are people actually using it? -> the activity chart
 *   4. Who is thriving, who is gone? -> the named leaderboard
 *   5. What are they using it for?   -> content mix
 *
 * Rebuilt from scratch after the previous version was (correctly) called
 * unreadable: twelve context-free numbers in a serif display face, no deltas,
 * no interaction, and a headline that was simply wrong. The specific traps,
 * each now guarded, so do not undo them:
 *   1. "Couples" counted couple ROWS, including abandoned shells with zero
 *      members. Five of twelve were empty, so the headline overstated reality
 *      by 71% and disagreed with the paired/solo counts printed beside it. A
 *      space is now a couple that HAS members; the shells became a health item.
 *   2. An expired admin token (12h) landed on a retry-only error screen with no
 *      way back to the password gate. A 401 returns to the gate.
 *   3. A failed REFRESH left stale numbers on screen with no indication. It now
 *      shows a banner and labels the old data.
 *   4. Charts stored the highlighted bar as an ARRAY INDEX; the window slides
 *      daily, so a held index could point past the end of the new series and
 *      crash the render. Selection is a day STRING (see TrendChart).
 */

const WINDOWS = [7, 30, 90] as const;

const SOURCE_LABELS: Record<string, string> = {
  messages: 'Chat',
  memories: 'Memories',
  notes: 'Notes',
  todos: 'To-dos',
  prompts: 'Prompts',
  comments: 'Comments',
  bucket: 'Bucket list',
  wishlist: 'Wishlist',
  dates: 'Dates',
  milestones: 'Milestones',
};

interface Kpi {
  value: number;
  previous: number;
  deltaPct: number | null;
  spark: number[];
}

interface Stats {
  generatedAt: string;
  window: { days: number; from: string | null; to: string | null };
  sources: string[];
  kpis: { activeSpaces: Kpi; spaces: Kpi; people: Kpi; content: Kpi; messages: Kpi };
  membership: { spaces: number; paired: number; solo: number; empty: number; coupleRowsTotal: number };
  health: {
    emptySpaces: number;
    noPushSubscription: number;
    notificationsOff: number;
    unpairedPeople: number;
    totalPeople: number;
  };
  engagement: {
    onStreak: number;
    longestEver: number;
    avgStreak: number;
    gameRounds: number;
    todos: number;
    todosDone: number;
    reactions: number;
    capsules: number;
    reflections: number;
    referred: number;
  };
  activity: { day: string; counts: Record<string, number>; total: number }[];
  signups: { day: string; n: number }[];
  contentMix: { src: string; n: number }[];
  couples: {
    id: string;
    names: string[];
    members: number;
    created_at: string;
    encrypted: boolean;
    streak: number;
    counts: Record<string, number>;
    total: number;
    last_active: string | null;
    empty: boolean;
  }[];
}

/** Thrown for a 401 so callers can tell "token expired" from "request failed". */
class UnauthorizedError extends Error {}

async function adminFetch<T>(
  path: string,
  token: string | null,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body (a gateway error page, say); fall through to the status
  }
  if (res.status === 401) throw new UnauthorizedError(data?.error ?? 'Session expired');
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** "3d ago" / "just now": a leaderboard needs recency at a glance. */
function ago(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'never';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export default function AdminDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [days, setDays] = useState<number>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [loading, spin]);

  const load = useCallback(async (tok: string, windowDays: number) => {
    setLoading(true);
    try {
      const data = await adminFetch<Stats>(`/api/admin/stats?days=${windowDays}`, tok);
      setStats(data);
      setError(null);
      setStale(false);
      // Every source on for the first load, then leave the operator's legend
      // choices alone across refreshes and window changes.
      setActiveKeys((cur) => (cur.size === 0 ? new Set(data.sources) : cur));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setToken(null);
        setStats(null);
        setGateError('That session expired. Enter the password again.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load');
      // Keep whatever is on screen, but say plainly that it is old.
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token, days).catch(() => {});
  }, [token, days, load]);

  const signIn = async () => {
    setSigningIn(true);
    setGateError(null);
    try {
      const { token: tok } = await adminFetch<{ token: string }>('/api/admin/auth', null, {
        method: 'POST',
        body: { password },
      });
      setPassword('');
      setToken(tok);
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setSigningIn(false);
    }
  };

  const toggleKey = (key: string) =>
    setActiveKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Switching everything off leaves an empty chart that reads as broken
      // with no obvious way back; the last one stays on.
      return next.size === 0 ? cur : next;
    });

  /** Per-source totals WITHIN the selected window, for the legend counts. */
  const windowTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of stats?.activity ?? []) {
      for (const [k, n] of Object.entries(p.counts)) out[k] = (out[k] ?? 0) + n;
    }
    return out;
  }, [stats?.activity]);

  // ---- password gate ------------------------------------------------------
  if (!token) {
    return (
      <Screen>
        <View style={styles.gate}>
          <View style={styles.gateIcon}>
            <LockKeyhole size={22} color={colors.onSealed} strokeWidth={1.75} />
          </View>
          <Text style={styles.gateTitle}>Analytics</Text>
          <Text style={styles.gateHint}>Counts and names only. Nobody's content is ever read.</Text>
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={signIn}
          />
          {gateError ? <FormError message={gateError} /> : null}
          <PrimaryButton title={signingIn ? 'Checking…' : 'Unlock'} onPress={signIn} disabled={signingIn} />
        </View>
      </Screen>
    );
  }

  const k = stats?.kpis;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>
            {stale ? 'Showing the last numbers that loaded' : `Updated ${ago(stats?.generatedAt ?? null)}`}
          </Text>
        </View>
        <View style={styles.headerBtns}>
          <View style={styles.segment}>
            {WINDOWS.map((w) => (
              <Pressable
                key={w}
                onPress={() => setDays(w)}
                style={[styles.segmentBtn, days === w && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, days === w && styles.segmentTextActive]}>{w}d</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => token && load(token, days)}
            disabled={loading}
            style={styles.iconBtn}
            accessibilityLabel="Refresh"
          >
            <Animated.View
              style={{
                transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
              }}
            >
              <RefreshCw size={17} color={colors.ink} strokeWidth={1.75} />
            </Animated.View>
          </Pressable>
          <Pressable onPress={() => setToken(null)} style={styles.iconBtn} accessibilityLabel="Lock">
            <LockKeyhole size={17} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
        </View>
      </View>

      {stale && error ? (
        <View style={styles.staleBanner}>
          <AlertTriangle size={15} color={colors.danger} strokeWidth={1.75} />
          <Text style={styles.staleText}>Refresh failed: {error}</Text>
        </View>
      ) : null}

      {!stats ? (
        <Text style={styles.loading}>{loading ? 'Loading…' : error ?? 'No data'}</Text>
      ) : (
        <>
          <HealthStrip health={stats.health} />

          <View style={styles.kpiGrid}>
            <KpiCard
              label="Active spaces"
              sub="made something in 7d"
              kpi={k!.activeSpaces}
              of={stats.membership.spaces}
              color={seriesColor(0)}
            />
            <KpiCard label="Spaces" sub="couples with people in them" kpi={k!.spaces} color={seriesColor(4)} />
            <KpiCard label="People" sub="signed up" kpi={k!.people} color={seriesColor(2)} />
            <KpiCard label="Things made" sub={`in ${days}d`} kpi={k!.content} color={seriesColor(1)} />
          </View>

          <Section title="Activity" hint="Tap or hover a day. Tap a source to filter.">
            <TrendChart
              data={stats.activity}
              keys={stats.sources}
              activeKeys={activeKeys}
              emptyLabel="Nothing made in this window."
            />
            <Legend
              keys={stats.sources}
              labels={SOURCE_LABELS}
              activeKeys={activeKeys}
              totals={windowTotals}
              onToggle={toggleKey}
            />
          </Section>

          <Section
            title="Spaces"
            hint={`${stats.membership.paired} paired · ${stats.membership.solo} solo${
              stats.membership.empty ? ` · ${stats.membership.empty} empty` : ''
            }`}
          >
            <CoupleTable couples={stats.couples} sources={stats.sources} />
          </Section>

          <View style={styles.twoUp}>
            <Section title="What they make" style={styles.half}>
              <BarList rows={stats.contentMix} labels={SOURCE_LABELS} />
            </Section>
            <Section title="Engagement" style={styles.half}>
              <StatGrid
                items={[
                  ['On a streak', stats.engagement.onStreak],
                  ['Longest ever', stats.engagement.longestEver],
                  ['Game rounds', stats.engagement.gameRounds],
                  ['To-dos done', `${stats.engagement.todosDone}/${stats.engagement.todos}`],
                  ['Reactions', stats.engagement.reactions],
                  ['Capsules', stats.engagement.capsules],
                  ['Reflections', stats.engagement.reflections],
                  ['Via referral', stats.engagement.referred],
                ]}
              />
            </Section>
          </View>

          <Text style={styles.footnote}>
            Streak figures read the cached counters on each couple, refreshed when a prompt reveals. Each couple's own
            screen recomputes from history and is the source of truth.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

/**
 * The first thing on the page, because a dashboard that buries breakage under
 * growth numbers is decoration. Every row is actionable, and rows at zero
 * disappear rather than sitting there as green noise.
 */
function HealthStrip({ health }: { health: Stats['health'] }) {
  const issues: { label: string; value: number; hint: string }[] = [];
  if (health.noPushSubscription > 0)
    issues.push({
      label: 'no push subscription',
      value: health.noPushSubscription,
      hint: `of ${health.totalPeople} people. Every reminder silently skips them.`,
    });
  if (health.notificationsOff > 0)
    issues.push({ label: 'notifications off', value: health.notificationsOff, hint: 'switched off by choice' });
  if (health.emptySpaces > 0)
    issues.push({ label: 'empty spaces', value: health.emptySpaces, hint: 'couple rows with no members left' });
  if (health.unpairedPeople > 0)
    issues.push({ label: 'people with no space', value: health.unpairedPeople, hint: 'should not be possible' });

  if (issues.length === 0) {
    return (
      <View style={[styles.health, { borderColor: colors.positive }]}>
        <Text style={[styles.healthTitle, { color: colors.positive }]}>Everything looks healthy</Text>
      </View>
    );
  }

  return (
    <View style={styles.health}>
      <View style={styles.healthHead}>
        <AlertTriangle size={14} color={colors.danger} strokeWidth={2} />
        <Text style={styles.healthTitle}>Needs attention</Text>
      </View>
      <View style={styles.healthRows}>
        {issues.map((i) => (
          <View key={i.label} style={styles.healthRow}>
            <Text style={styles.healthValue}>{i.value}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.healthLabel}>{i.label}</Text>
              <Text style={styles.healthHint}>{i.hint}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Label, value, delta, shape. The order every readable KPI card uses. */
function KpiCard({
  label: title,
  sub,
  kpi,
  of,
  color,
}: {
  label: string;
  sub: string;
  kpi: Kpi;
  /** Renders "5 of 7" when the value is a share of something. */
  of?: number;
  color: string;
}) {
  const d = kpi.deltaPct;
  const dir = d === null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
  const DeltaIcon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : ArrowRight;
  const deltaColor = dir === 'up' ? colors.positive : dir === 'down' ? colors.danger : colors.inkFaint;

  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{title}</Text>
      <View style={styles.kpiValueRow}>
        <Text style={styles.kpiValue}>{kpi.value.toLocaleString()}</Text>
        {of !== undefined && <Text style={styles.kpiOf}>of {of}</Text>}
      </View>
      <View style={styles.kpiFooter}>
        <View style={styles.kpiDelta}>
          {d === null ? (
            <Text style={styles.kpiSub}>{sub}</Text>
          ) : (
            <>
              <DeltaIcon size={13} color={deltaColor} strokeWidth={2} />
              <Text style={[styles.kpiDeltaText, { color: deltaColor }]}>{Math.abs(d)}%</Text>
              <Text style={styles.kpiSub}>vs prev.</Text>
            </>
          )}
        </View>
        <Sparkline values={kpi.spark} color={color} width={72} height={24} />
      </View>
    </View>
  );
}

/**
 * The leaderboard, which is what this dashboard is really for: which couples
 * are thriving, and which signed up and vanished. Names are shown deliberately
 * (see the API's header comment); nothing beside the name is anything but a
 * count.
 */
function CoupleTable({ couples, sources }: { couples: Stats['couples']; sources: string[] }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const real = couples.filter((c) => !c.empty);
  const empty = couples.filter((c) => c.empty);
  const rows = showEmpty ? [...real, ...empty] : real;
  const top = Math.max(...real.map((c) => c.total), 1);

  return (
    <View>
      <View style={[styles.trow, styles.thead]}>
        <Text style={[styles.thName, styles.th]}>Couple</Text>
        <Text style={[styles.thBar, styles.th]}>Makeup</Text>
        <Text style={[styles.thNum, styles.th]}>Items</Text>
        <Text style={[styles.thNum, styles.th]}>Streak</Text>
        <Text style={[styles.thLast, styles.th]}>Last seen</Text>
      </View>

      {rows.map((c, i) => (
        <View key={c.id} style={styles.trow}>
          <View style={styles.thName}>
            <Text style={styles.cName} numberOfLines={1}>
              {c.names.length > 0 ? c.names.join(' + ') : 'empty space'}
            </Text>
            <Text style={styles.cMeta}>
              {c.id} · {c.members === 2 ? 'paired' : c.members === 1 ? 'solo' : 'no members'}
            </Text>
          </View>
          <View style={styles.thBar}>
            <StackStrip counts={c.counts} keys={sources} />
            <View style={styles.miniTrack}>
              <View style={{ width: `${(c.total / top) * 100}%`, height: '100%', backgroundColor: colors.inkFaint }} />
            </View>
          </View>
          <Text style={[styles.thNum, styles.cNum, i === 0 && !c.empty && styles.cNumTop]}>{c.total}</Text>
          <Text style={[styles.thNum, styles.cNum]}>{c.streak > 0 ? c.streak : '·'}</Text>
          <Text style={[styles.thLast, styles.cLast]}>{ago(c.last_active)}</Text>
        </View>
      ))}

      {empty.length > 0 && (
        <Pressable onPress={() => setShowEmpty((s) => !s)} style={styles.showMore}>
          <Text style={styles.showMoreText}>
            {showEmpty ? 'Hide' : 'Show'} {empty.length} empty space{empty.length === 1 ? '' : 's'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function StatGrid({ items }: { items: [string, string | number][] }) {
  return (
    <View style={styles.statGrid}>
      {items.map(([l, v]) => (
        <View key={l} style={styles.statCell}>
          <Text style={styles.statValue}>{v}</Text>
          <Text style={styles.statLabel}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({
  title,
  hint,
  style,
  children,
}: {
  title: string;
  hint?: string;
  style?: any;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Tabular figures keep columns of numbers from jittering as values change. */
const MONO: TextStyle = { fontVariant: ['tabular-nums'] };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    padding: sp.base,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    gap: sp.md,
  },
  loading: { ...text.caption, color: colors.inkMuted, textAlign: 'center', paddingVertical: sp.huge },

  gate: { gap: sp.md, maxWidth: 340, width: '100%', alignSelf: 'center', paddingTop: sp.huge },
  gateIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  gateTitle: { ...text.title, textAlign: 'center' },
  gateHint: { ...text.caption, color: colors.inkMuted, textAlign: 'center', marginBottom: sp.sm },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, marginBottom: sp.xs },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink, letterSpacing: -0.4 },
  subtitle: { ...text.caption, color: colors.inkMuted, marginTop: 1 },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  segmentBtn: { paddingHorizontal: sp.md, paddingVertical: 6 },
  segmentBtnActive: { backgroundColor: colors.surfaceSealed },
  segmentText: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkMuted },
  segmentTextActive: { color: colors.onSealed, fontWeight: '600' },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },

  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    padding: sp.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  staleText: { ...text.caption, color: colors.danger, flex: 1 },

  health: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: sp.md,
    backgroundColor: colors.surfaceRaised,
    gap: sp.sm,
  },
  healthHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  healthTitle: { ...text.micro, color: colors.danger, fontWeight: '700' },
  healthRows: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.md },
  healthRow: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm, minWidth: 210, flex: 1 },
  healthValue: { fontSize: 20, fontWeight: '700', color: colors.danger, lineHeight: 22, ...MONO },
  healthLabel: { ...text.caption, color: colors.ink, fontWeight: '600' },
  healthHint: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkMuted },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  kpi: {
    flexGrow: 1,
    flexBasis: 190,
    minWidth: 168,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    padding: sp.md,
    gap: 2,
  },
  kpiLabel: { ...text.micro, color: colors.inkMuted, fontWeight: '600' },
  kpiValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  kpiValue: { fontSize: 28, fontWeight: '700', color: colors.ink, letterSpacing: -0.6, ...MONO },
  kpiOf: { ...text.caption, color: colors.inkFaint },
  kpiFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 2 },
  kpiDelta: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  kpiDeltaText: { ...text.caption, fontWeight: '700', ...MONO },
  kpiSub: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkFaint, flexShrink: 1 },

  section: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    padding: sp.md,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: sp.sm,
    marginBottom: sp.md,
  },
  sectionTitle: { ...text.subtitle, fontSize: 15 },
  sectionHint: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkFaint, flexShrink: 1 },
  twoUp: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.md },
  half: { flexGrow: 1, flexBasis: 320 },

  trow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingVertical: sp.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  thead: { paddingTop: 0, paddingBottom: 6 },
  th: { ...text.micro, color: colors.inkFaint },
  thName: { flex: 3, minWidth: 130 },
  thBar: { flex: 2, minWidth: 70, gap: 3 },
  thNum: { width: 52, textAlign: 'right' },
  thLast: { width: 76, textAlign: 'right' },
  cName: { ...text.caption, color: colors.ink, fontWeight: '600' },
  cMeta: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkFaint },
  cNum: { ...text.caption, color: colors.ink, ...MONO },
  cNumTop: { fontWeight: '700', color: colors.accent },
  cLast: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkMuted },
  miniTrack: { height: 2, borderRadius: 1, overflow: 'hidden' },
  showMore: { paddingVertical: sp.sm, alignItems: 'center' },
  showMoreText: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.accent },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.md },
  statCell: { flexGrow: 1, flexBasis: 68, minWidth: 62 },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.ink, ...MONO },
  statLabel: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkMuted },

  footnote: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.inkFaint, lineHeight: 15 },
});
