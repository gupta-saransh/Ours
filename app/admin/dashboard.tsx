import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LockKeyhole, RefreshCw } from 'lucide-react-native';
import { apiUrl } from '@/lib/api';
import { formatDay } from '@/lib/format';
import { Card, FormError, PrimaryButton, Screen, SecondaryButton, Skeleton, TextField } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

/**
 * /admin/dashboard — aggregate analytics only, gated by a single password
 * (ADMIN_PASSWORD in Vercel). Deliberately outside the (auth)/(tabs) groups so
 * it never touches, or is touched by, a couple's own session: the admin token
 * lives only in this screen's state (never localStorage, never the shared
 * api() client), and is checked server-side by api/_lib/admin.ts.
 *
 * Rebuilt from scratch. The bugs the previous version shipped, each of which
 * has a guard here now, so do not undo them:
 *   1. An expired admin token (12h) landed on a retry-only error screen with no
 *      way back to the password gate, so the page was stuck until a full
 *      reload. A 401 now returns to the gate with an explanatory message.
 *   2. A failed REFRESH left stale numbers on screen with no indication, since
 *      the error state only rendered when there was no data at all. A refresh
 *      failure now shows a banner and keeps the (clearly labelled) old data.
 *   3. Charts stored the highlighted bar as an ARRAY INDEX. The 30-day window
 *      shifts every day, so after a refresh an index could point past the end
 *      of the series and crash the render. Selection is now the day STRING,
 *      which is either found or falls back to the peak.
 */

const WINDOW_LABEL = 'last 30 days';

/** Display names for the source keys the server sends in `sources`. */
const SOURCE_LABELS: Record<string, string> = {
  memories: 'Memories',
  notes: 'Notes',
  messages: 'Chat messages',
  prompts: 'Prompt answers',
  comments: 'Comments',
  dates: 'Dates',
  todos: 'To-dos',
  bucket: 'Bucket list',
  wishlist: 'Wishlist',
};

interface Stats {
  generatedAt: string;
  sources: string[];
  totals: Record<string, number>;
  membership: { paired: number; solo: number };
  streaks: { on_streak: number; longest_ever: number; avg_current: number };
  activeCouples: number;
  signups: { day: string; n: number }[];
  activity: { day: string; counts: Record<string, number>; total: number }[];
  couples: {
    id: string;
    created_at: string;
    members: number;
    encrypted: boolean;
    counts: Record<string, number>;
    total: number;
    last_active: string | null;
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

export default function AdminDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lock = useCallback((notice: string | null) => {
    setToken(null);
    setStats(null);
    setError(null);
    setGateNotice(notice);
  }, []);

  const load = useCallback(
    async (t: string) => {
      setLoading(true);
      try {
        const data = await adminFetch<Stats>('/api/admin/stats', t);
        setStats(data);
        setError(null);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          lock('That session expired. Sign in again.');
          return;
        }
        // Keep whatever is already on screen; the banner says it is stale.
        setError(err instanceof Error ? err.message : 'Could not load the numbers.');
      } finally {
        setLoading(false);
      }
    },
    [lock]
  );

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  if (!token) {
    return (
      <AdminGate
        notice={gateNotice}
        onUnlocked={(t) => {
          setGateNotice(null);
          setToken(t);
        }}
      />
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={text.title}>Analytics</Text>
            <Text style={text.caption}>
              {stats ? `As of ${timeOfDay(stats.generatedAt)}` : loading ? 'Loading…' : 'Not loaded'}
            </Text>
          </View>
          <RefreshButton spinning={loading} onPress={() => !loading && load(token)} />
          <Pressable onPress={() => lock(null)} hitSlop={8} style={styles.headerBtn}>
            <LockKeyhole size={18} color={colors.inkMuted} strokeWidth={1.75} />
          </Pressable>
        </View>

        {error && (
          <Card style={styles.errorCard}>
            <Text style={[text.caption, { color: colors.danger }]}>
              {error}
              {stats ? ' Showing the last numbers that loaded.' : ''}
            </Text>
            {!stats && <SecondaryButton title="Try again" onPress={() => load(token)} style={{ marginTop: sp.md }} />}
          </Card>
        )}

        {!stats ? (
          loading ? (
            <View>
              <Skeleton height={120} style={{ marginBottom: sp.lg }} />
              <Skeleton height={160} style={{ marginBottom: sp.lg }} />
              <Skeleton height={200} />
            </View>
          ) : null
        ) : (
          <Report stats={stats} />
        )}
      </ScrollView>
    </Screen>
  );
}

function Report({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const sources = stats.sources?.length ? stats.sources : Object.keys(SOURCE_LABELS);

  const contentItems = sources
    .map((src) => ({ label: SOURCE_LABELS[src] ?? src, value: t[src] ?? 0 }))
    .concat([{ label: 'Milestones', value: t.milestones ?? 0 }])
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <View>
      <Group label="Who is here">
        <View style={styles.grid}>
          <Tile label="Couples" value={t.couples ?? 0} />
          <Tile label="People" value={t.users ?? 0} />
          <Tile label="Paired" value={stats.membership.paired} />
          <Tile label="Solo" value={stats.membership.solo} />
          <Tile label="Active this week" value={stats.activeCouples} />
          <Tile label="Encrypted" value={t.encrypted_couples ?? 0} />
        </View>
      </Group>

      <Group label="Engagement">
        <View style={styles.grid}>
          <Tile label="On a streak" value={stats.streaks.on_streak} />
          <Tile label="Longest ever" value={stats.streaks.longest_ever} />
          <Tile label="Avg. streak" value={stats.streaks.avg_current} />
          <Tile label="Game rounds" value={t.game_rounds ?? 0} />
          <Tile label="To-dos done" value={`${t.todos_done ?? 0}/${t.todos ?? 0}`} />
          <Tile label="Reactions" value={t.reactions ?? 0} />
          <Tile label="Time capsules" value={t.capsules ?? 0} />
          <Tile label="Reflections saved" value={t.reflections ?? 0} />
          <Tile label="Joined via referral" value={t.referred ?? 0} />
        </View>
        <Text style={styles.footnote}>
          Streak figures come from the cached counters on each couple, refreshed when a prompt reveals. The couple's own
          screen recomputes from history and is the source of truth.
        </Text>
      </Group>

      <Group label="New signups">
        <BarChart
          series={stats.signups.map((s) => ({ day: s.day, value: s.n }))}
          caption={(d, v) => `${formatDay(d)} · ${v} ${v === 1 ? 'signup' : 'signups'}`}
          empty="Nobody has signed up yet."
        />
      </Group>

      <Group label="Activity">
        <ActivityChart series={stats.activity ?? []} />
      </Group>

      <Group label="What has been made">
        <MagnitudeBars
          items={contentItems}
          footer={
            (t.bucket ?? 0) > 0 ? `${t.bucket_done ?? 0} of ${t.bucket} bucket-list items marked done.` : undefined
          }
        />
      </Group>

      <Group label="By couple">
        <CoupleList couples={stats.couples ?? []} sources={sources} />
      </Group>
    </View>
  );
}

/* ---------------------------------- charts --------------------------------- */

const CHART_HEIGHT = 96;

interface Point {
  day: string;
  value: number;
}

/**
 * Vertical bars, one per day. The highlighted bar is tracked by DAY STRING,
 * never by index: the window slides every day, so an index kept across a
 * refresh can point past the end of a newly loaded series (that was a real
 * crash). An unknown day simply falls back to the peak.
 */
function BarChart({
  series,
  caption,
  empty,
  header,
}: {
  series: Point[];
  caption: (day: string, value: number) => string;
  empty: string;
  header?: React.ReactNode;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  if (series.length === 0) {
    return (
      <Card>
        {header}
        <Text style={text.caption}>{empty}</Text>
      </Card>
    );
  }

  const max = Math.max(1, ...series.map((p) => p.value));
  const peak = series.reduce((best, p) => (p.value > best.value ? p : best), series[0]);
  const shown = (selectedDay && series.find((p) => p.day === selectedDay)) || peak;

  return (
    <Card>
      {header}
      <View style={styles.barsRow}>
        {series.map((p) => {
          const h = Math.max(2, Math.round((p.value / max) * CHART_HEIGHT));
          const isShown = p.day === shown.day;
          return (
            <Pressable key={p.day} onPress={() => setSelectedDay(p.day)} style={styles.barCol}>
              <View
                style={[styles.bar, { height: h, backgroundColor: isShown ? colors.surfaceSealed : colors.inkFaint }]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axisLine} />
      <Text style={styles.chartCaption}>{caption(shown.day, shown.value)}</Text>
      <Text style={styles.chartSub}>
        {series.reduce((s, p) => s + p.value, 0).toLocaleString()} total over the {WINDOW_LABEL}
      </Text>
    </Card>
  );
}

/** Everything made per day, with a daily/cumulative toggle. */
function ActivityChart({ series }: { series: Stats['activity'] }) {
  const [cumulative, setCumulative] = useState(false);

  let running = 0;
  const points: Point[] = series.map((d) => {
    running += d.total;
    return { day: d.day, value: cumulative ? running : d.total };
  });

  return (
    <BarChart
      series={points}
      empty="Nothing has been made yet."
      header={
        <View style={styles.chartHeader}>
          <Text style={text.subtitle}>{cumulative ? 'Running total' : 'Made each day'}</Text>
          <Pressable onPress={() => setCumulative((c) => !c)} hitSlop={8}>
            <Text style={styles.link}>{cumulative ? 'Show daily' : 'Show cumulative'}</Text>
          </Pressable>
        </View>
      }
      caption={(d, v) => `${formatDay(d)} · ${v.toLocaleString()} ${cumulative ? 'made so far' : 'that day'}`}
    />
  );
}

/** Horizontal magnitude bars, sorted high to low, value printed past the tip. */
function MagnitudeBars({ items, footer }: { items: { label: string; value: number }[]; footer?: string }) {
  if (items.length === 0) {
    return (
      <Card>
        <Text style={text.caption}>Nothing has been made yet.</Text>
      </Card>
    );
  }
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card>
      {items.map((item, i) => (
        <View key={item.label} style={[styles.barRow, i > 0 && { marginTop: sp.sm }]}>
          <Text style={[text.caption, styles.barLabel]} numberOfLines={1}>
            {item.label}
          </Text>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${Math.max(2, (item.value / max) * 100)}%` }]} />
          </View>
          <Text style={[text.caption, styles.barValue]}>{item.value.toLocaleString()}</Text>
        </View>
      ))}
      {footer && <Text style={[text.caption, { marginTop: sp.lg }]}>{footer}</Text>}
    </Card>
  );
}

/** Per-couple volume, biggest first. Counts only, never content. */
function CoupleList({ couples, sources }: { couples: Stats['couples']; sources: string[] }) {
  const [showAll, setShowAll] = useState(false);

  if (couples.length === 0) {
    return (
      <Card>
        <Text style={text.caption}>No couples yet.</Text>
      </Card>
    );
  }

  const shown = showAll ? couples : couples.slice(0, 10);
  const max = Math.max(1, ...couples.map((c) => c.total));

  return (
    <Card>
      {shown.map((c, i) => {
        // Only the kinds this couple actually used, so the line stays short.
        const parts = sources
          .filter((src) => (c.counts?.[src] ?? 0) > 0)
          .map((src) => `${c.counts[src]} ${(SOURCE_LABELS[src] ?? src).toLowerCase()}`);
        return (
          <View key={c.id} style={[styles.coupleRow, i > 0 && styles.coupleBorder]}>
            <View style={styles.coupleHead}>
              <Text style={styles.coupleId}>{c.id}</Text>
              <Text style={styles.coupleTotal}>{c.total.toLocaleString()}</Text>
            </View>
            <View style={styles.coupleTrack}>
              <View style={[styles.coupleFill, { width: `${Math.max(2, (c.total / max) * 100)}%` }]} />
            </View>
            <Text style={[text.caption, { marginTop: sp.xs }]}>
              {c.members === 2 ? 'Paired' : c.members === 1 ? 'Solo' : 'Empty'}
              {parts.length > 0 ? ` · ${parts.join(' · ')}` : ' · nothing yet'}
            </Text>
            <Text style={styles.coupleMeta}>
              joined {formatDay(c.created_at)}
              {c.last_active ? ` · last active ${formatDay(c.last_active)}` : ' · never active'}
            </Text>
          </View>
        );
      })}
      {couples.length > 10 && (
        <Pressable onPress={() => setShowAll((s) => !s)} hitSlop={8} style={styles.showAll}>
          <Text style={styles.link}>{showAll ? 'Show fewer' : `Show all ${couples.length}`}</Text>
        </Pressable>
      )}
    </Card>
  );
}

/* ----------------------------------- bits ---------------------------------- */

/** Spins while a refresh is in flight, so a slow request still feels answered. */
function RefreshButton({ spinning, onPress }: { spinning: boolean; onPress: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spinning) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Pressable onPress={onPress} disabled={spinning} hitSlop={8} style={styles.headerBtn}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <RefreshCw size={18} color={spinning ? colors.inkFaint : colors.accent} strokeWidth={1.75} />
      </Animated.View>
    </Pressable>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={[text.section, { marginBottom: sp.md }]}>{label}</Text>
      {children}
    </View>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
      <Text style={text.caption}>{label}</Text>
    </View>
  );
}

function AdminGate({ notice, onUnlocked }: { notice: string | null; onUnlocked: (token: string) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await adminFetch<{ token: string }>('/api/admin/auth', null, {
        method: 'POST',
        body: { password },
      });
      onUnlocked(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
    // On success the gate unmounts, so busy is deliberately left set.
  };

  return (
    <Screen>
      <View style={styles.gateWrap}>
        <Card style={styles.gateCard}>
          <Text style={[text.title, { marginBottom: sp.xs }]}>Admin</Text>
          <Text style={[text.caption, { marginBottom: sp.lg }]}>Analytics for Ours. Counts only, never content.</Text>
          {notice && <Text style={styles.notice}>{notice}</Text>}
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoFocus
            onSubmitEditing={submit}
          />
          <FormError message={error} />
          <PrimaryButton title="Enter" onPress={submit} loading={busy} disabled={!password.trim()} />
        </Card>
      </View>
    </Screen>
  );
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'just now';
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m} ${d.getHours() >= 12 ? 'pm' : 'am'}`;
}

const styles = StyleSheet.create({
  gateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp.xl,
  },
  gateCard: {
    width: '100%',
    maxWidth: 360,
  },
  notice: {
    ...text.caption,
    color: colors.accent,
    marginBottom: sp.md,
  },
  body: {
    padding: sp.xl,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.xs,
    marginBottom: sp.xl,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  errorCard: {
    borderColor: colors.danger,
    marginBottom: sp.lg,
  },
  group: {
    marginBottom: sp.xxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    width: '33.33%',
    paddingRight: sp.sm,
    marginBottom: sp.lg,
  },
  tileValue: {
    ...text.subtitle,
    fontSize: 22,
    color: colors.surfaceSealed,
    fontVariant: ['tabular-nums'],
  },
  footnote: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.inkFaint,
    lineHeight: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: sp.base,
  },
  link: {
    ...text.caption,
    color: colors.accent,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    gap: 2,
  },
  barCol: {
    flex: 1,
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 10,
    borderTopLeftRadius: radius.hairline,
    borderTopRightRadius: radius.hairline,
  },
  axisLine: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  chartCaption: {
    ...text.caption,
    marginTop: sp.sm,
    textAlign: 'center',
    color: colors.ink,
  },
  chartSub: {
    ...text.caption,
    marginTop: sp.xs,
    textAlign: 'center',
    color: colors.inkFaint,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
  },
  barLabel: {
    width: 110,
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radius.hairline,
    backgroundColor: colors.hairline,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: colors.surfaceSealed,
    borderTopRightRadius: radius.hairline,
    borderBottomRightRadius: radius.hairline,
  },
  barValue: {
    width: 52,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  coupleRow: {
    paddingVertical: sp.md,
  },
  coupleBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  coupleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.xs,
  },
  coupleId: {
    ...text.body,
    fontVariant: ['tabular-nums'],
    ...(Platform.OS === 'web' ? ({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as any) : null),
  },
  coupleTotal: {
    ...text.subtitle,
    color: colors.surfaceSealed,
    fontVariant: ['tabular-nums'],
  },
  coupleTrack: {
    height: 8,
    borderRadius: radius.hairline,
    backgroundColor: colors.hairline,
    overflow: 'hidden',
  },
  coupleFill: {
    height: '100%',
    backgroundColor: colors.surfaceSealed,
    borderTopRightRadius: radius.hairline,
    borderBottomRightRadius: radius.hairline,
  },
  coupleMeta: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.inkFaint,
    marginTop: 2,
  },
  showAll: {
    marginTop: sp.md,
    alignSelf: 'center',
  },
});
