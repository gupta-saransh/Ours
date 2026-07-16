import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiUrl } from '@/lib/api';
import { formatDay } from '@/lib/format';
import {
  Card,
  ErrorState,
  FormError,
  PrimaryButton,
  Screen,
  Section,
  Skeleton,
  TextField,
} from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

/**
 * /admin/dashboard — aggregate analytics only, gated by a single password
 * (ADMIN_PASSWORD in Vercel). Deliberately outside the (auth)/(tabs) groups so
 * it never touches, or is touched by, a couple's own session: the admin token
 * lives only in this screen's state (never localStorage, never the shared
 * api() client), and is checked server-side by api/_lib/admin.ts.
 */

interface Totals {
  couples: number;
  users: number;
  encrypted_couples: number;
  memories: number;
  notes: number;
  milestones: number;
  prompt_answers: number;
  comments: number;
  dates: number;
  wishlist: number;
  bucket_total: number;
  bucket_done: number;
}
interface Membership {
  paired: number;
  solo: number;
}
interface Streaks {
  on_streak: number;
  longest_ever: number;
  avg_current: number;
}
interface Stats {
  totals: Totals;
  membership: Membership;
  streaks: Streaks;
  activeCouples: number;
  signups: { day: string; n: number }[];
}

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
    // non-JSON response body
  }
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export default function AdminDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (t: string) => {
    setFailed(false);
    try {
      const data = await adminFetch<Stats>('/api/admin/stats', t);
      setStats(data);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  if (!token) return <AdminGate onUnlocked={setToken} />;

  if (failed && !stats) {
    return (
      <Screen>
        <ErrorState onRetry={() => load(token)} />
      </Screen>
    );
  }

  if (!stats) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={120} style={{ marginBottom: sp.lg }} />
          <Skeleton height={120} style={{ marginBottom: sp.lg }} />
          <Skeleton height={200} />
        </View>
      </Screen>
    );
  }

  const contentItems = [
    { label: 'Memories', value: stats.totals.memories },
    { label: 'Notes', value: stats.totals.notes },
    { label: 'Milestones', value: stats.totals.milestones },
    { label: 'Prompt answers', value: stats.totals.prompt_answers },
    { label: 'Comments', value: stats.totals.comments },
    { label: 'Dates proposed', value: stats.totals.dates },
    { label: 'Wishlist items', value: stats.totals.wishlist },
    { label: 'Bucket items', value: stats.totals.bucket_total },
  ].sort((a, b) => b.value - a.value);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <Text style={text.title}>Analytics</Text>
          <Pressable
            onPress={() => {
              setToken(null);
              setStats(null);
            }}
            hitSlop={8}
          >
            <Text style={[text.caption, { color: colors.accent }]}>Lock</Text>
          </Pressable>
        </View>

        <Section label="Overview">
          <View style={styles.grid}>
            <StatTile label="Couples" value={stats.totals.couples} />
            <StatTile label="Paired" value={stats.membership.paired} />
            <StatTile label="Solo" value={stats.membership.solo} />
            <StatTile label="People" value={stats.totals.users} />
            <StatTile label="Encrypted couples" value={stats.totals.encrypted_couples} />
            <StatTile label="Active this week" value={stats.activeCouples} />
          </View>
        </Section>

        <Section label="Streaks">
          <View style={styles.grid}>
            <StatTile label="Couples on a streak" value={stats.streaks.on_streak} />
            <StatTile label="Longest streak ever" value={stats.streaks.longest_ever} />
            <StatTile label="Avg. current streak" value={stats.streaks.avg_current} />
          </View>
        </Section>

        <Section label="Growth">
          <SignupsChart series={stats.signups} />
        </Section>

        <Section label="Content">
          <ContentBars items={contentItems} bucketDone={stats.totals.bucket_done} bucketTotal={stats.totals.bucket_total} />
        </Section>
      </ScrollView>
    </Screen>
  );
}

function AdminGate({ onUnlocked }: { onUnlocked: (token: string) => void }) {
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
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.gateWrap}>
        <Card style={styles.gateCard}>
          <Text style={[text.title, { marginBottom: sp.xs }]}>Admin</Text>
          <Text style={[text.caption, { marginBottom: sp.lg }]}>Analytics for Ours. Not for your partner.</Text>
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

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
      <Text style={text.caption}>{label}</Text>
    </View>
  );
}

const CHART_HEIGHT = 96;
const BAR_WIDTH = 6;

/** Vertical bar chart, one bar per day. Emphasis form: the peak (or a tapped
 * bar) carries the brand hue, every other bar sits in de-emphasis gray. */
function SignupsChart({ series }: { series: { day: string; n: number }[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((s) => s.n));
  const peakIdx = series.reduce((best, s, i) => (s.n > series[best].n ? i : best), 0);
  const shown = selected ?? peakIdx;
  const shownEntry = series[shown];

  return (
    <Card>
      <View style={styles.chartHeader}>
        <Text style={text.subtitle}>New signups</Text>
        <Text style={text.caption}>
          {formatDay(series[0].day)} – {formatDay(series[series.length - 1].day)}
        </Text>
      </View>
      <View style={styles.barsRow}>
        {series.map((s, i) => {
          const h = Math.max(2, Math.round((s.n / max) * CHART_HEIGHT));
          const isShown = i === shown;
          return (
            <Pressable key={s.day} onPress={() => setSelected(i)} style={styles.barCol}>
              <View style={[styles.bar, { height: h, backgroundColor: isShown ? colors.surfaceSealed : colors.inkFaint }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axisLine} />
      <Text style={[text.caption, { marginTop: sp.sm, textAlign: 'center' }]}>
        {formatDay(shownEntry.day)} · {shownEntry.n} {shownEntry.n === 1 ? 'signup' : 'signups'}
      </Text>
    </Card>
  );
}

/** Horizontal magnitude bars, one hue, sorted high to low; value printed at
 * the tip rather than inside the fill so it never gets clipped on short bars. */
function ContentBars({
  items,
  bucketDone,
  bucketTotal,
}: {
  items: { label: string; value: number }[];
  bucketDone: number;
  bucketTotal: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card>
      <Text style={[text.subtitle, { marginBottom: sp.base }]}>What you two have made</Text>
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
      {bucketTotal > 0 && (
        <Text style={[text.caption, { marginTop: sp.lg }]}>
          {bucketDone} of {bucketTotal} bucket-list items marked done.
        </Text>
      )}
    </Card>
  );
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
  body: {
    padding: sp.xl,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    width: '50%',
    marginBottom: sp.lg,
  },
  tileValue: {
    ...text.title,
    color: colors.surfaceSealed,
    fontVariant: ['tabular-nums'],
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: sp.base,
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
    width: BAR_WIDTH,
    borderTopLeftRadius: radius.hairline,
    borderTopRightRadius: radius.hairline,
  },
  axisLine: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
  },
  barLabel: {
    width: 128,
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
    width: 40,
    textAlign: 'right',
  },
});
