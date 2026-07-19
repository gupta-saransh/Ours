import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { chartSeries, colors, radius, sp, text } from '@/theme';

/**
 * Chart primitives for the admin dashboard.
 *
 * Two deliberate choices:
 *
 * 1. BARS ARE VIEWS, NOT SVG. A stacked bar chart is a flex column of heights,
 *    and building it from Views means every segment is a real layout node that
 *    Pressable can hit, hover, and measure. Interactivity comes free instead of
 *    needing hit-test math over an SVG canvas.
 * 2. SPARKLINES ARE SVG, because a smooth line genuinely needs a path, and
 *    react-native-svg is already a dependency (lucide renders through it).
 *
 * Hovering is web-only (`onHoverIn`, which react-native-web maps to real mouse
 * events); tapping does the same job everywhere else, so the same component
 * works on a phone without a second code path.
 */

export const SERIES_COLORS = chartSeries;

export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * The shape a KPI traced getting to its current value. Deliberately unlabelled:
 * a sparkline answers "which way is this going", and axis furniture at this
 * size would only crowd it out.
 */
export function Sparkline({
  values,
  color = colors.accent,
  width = 96,
  height = 28,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const stepX = width / (values.length - 1);
    // A flat series would otherwise hug the very bottom edge and read as
    // "nothing here"; centring it says "steady" instead.
    const pts = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * (height - 2) - 1;
      return [x, y] as const;
    });
    const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return { d, last: pts[pts.length - 1] };
  }, [values, width, height]);

  if (!path) return <View style={{ width, height }} />;
  return (
    <Svg width={width} height={height}>
      <Path d={path.d} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={path.last[0]} cy={path.last[1]} r={2.5} fill={color} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Stacked bar trend chart
// ---------------------------------------------------------------------------

export interface TrendPoint {
  day: string;
  total: number;
  counts: Record<string, number>;
}

function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * The main activity chart: one column per day, segmented by source.
 *
 * Selection is keyed by the DAY STRING, never an array index. The window slides
 * every day, so an index held across a refresh can point past the end of the
 * new series; a day either resolves or falls back cleanly. (That exact bug
 * crashed the previous dashboard's charts.)
 */
export function TrendChart({
  data,
  keys,
  activeKeys,
  height = 180,
  emptyLabel = 'Nothing yet in this window.',
}: {
  data: TrendPoint[];
  keys: string[];
  /** Subset of `keys` currently switched on in the legend. */
  activeKeys: Set<string>;
  height?: number;
  emptyLabel?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      data.map((p) => {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const k of keys) {
          if (!activeKeys.has(k)) continue;
          const n = p.counts[k] ?? 0;
          counts[k] = n;
          total += n;
        }
        return { day: p.day, total, counts };
      }),
    [data, keys, activeKeys]
  );

  const max = Math.max(...shown.map((p) => p.total), 1);
  const peak = shown.reduce((a, b) => (b.total > a.total ? b : a), shown[0]);
  const active = (selected && shown.find((p) => p.day === selected)) || peak;
  const anything = shown.some((p) => p.total > 0);

  if (shown.length === 0) return <Text style={styles.empty}>{emptyLabel}</Text>;

  return (
    <View>
      <View style={styles.readout}>
        <Text style={styles.readoutValue}>{active?.total ?? 0}</Text>
        <Text style={styles.readoutLabel}>
          {active ? `on ${shortDay(active.day)}` : ''}
          {active && selected !== active.day ? ' (busiest day)' : ''}
        </Text>
      </View>

      <View style={[styles.plot, { height }]}>
        {shown.map((p) => {
          const isActive = active?.day === p.day;
          return (
            <Pressable
              key={p.day}
              style={styles.column}
              onPress={() => setSelected(p.day === selected ? null : p.day)}
              onHoverIn={Platform.OS === 'web' ? () => setSelected(p.day) : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${p.day}: ${p.total}`}
            >
              <View style={styles.columnInner}>
                {p.total === 0 ? (
                  <View style={styles.zeroTick} />
                ) : (
                  keys
                    .filter((k) => activeKeys.has(k) && (p.counts[k] ?? 0) > 0)
                    .map((k) => (
                      <View
                        key={k}
                        style={{
                          height: Math.max(1, ((p.counts[k] ?? 0) / max) * (height - 22)),
                          backgroundColor: seriesColor(keys.indexOf(k)),
                          opacity: isActive ? 1 : 0.78,
                        }}
                      />
                    ))
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{shown[0] ? shortDay(shown[0].day) : ''}</Text>
        {!anything && <Text style={styles.axisLabel}>{emptyLabel}</Text>}
        <Text style={styles.axisLabel}>{shown[shown.length - 1] ? shortDay(shown[shown.length - 1].day) : ''}</Text>
      </View>
    </View>
  );
}

/** Tappable legend that doubles as a filter for the chart above it. */
export function Legend({
  keys,
  labels,
  activeKeys,
  totals,
  onToggle,
}: {
  keys: string[];
  /** Human labels per key; the raw key is used when one is missing. */
  labels?: Record<string, string>;
  activeKeys: Set<string>;
  totals: Record<string, number>;
  onToggle: (key: string) => void;
}) {
  return (
    <View style={styles.legend}>
      {keys.map((k, i) => {
        const on = activeKeys.has(k);
        return (
          <Pressable key={k} onPress={() => onToggle(k)} style={[styles.legendItem, !on && styles.legendItemOff]}>
            <View style={[styles.legendDot, { backgroundColor: on ? seriesColor(i) : colors.inkFaint }]} />
            <Text style={[styles.legendLabel, !on && { color: colors.inkFaint }]}>{labels?.[k] ?? k}</Text>
            <Text style={[styles.legendCount, !on && { color: colors.inkFaint }]}>{totals[k] ?? 0}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars
// ---------------------------------------------------------------------------

/**
 * Content mix. Scaled against the LARGEST bar, not the sum: chat is about two
 * thirds of every row in the database, so a share-of-total scale would render
 * every other source as an invisible sliver.
 */
export function BarList({
  rows,
  labels,
  max,
}: {
  rows: { src: string; n: number }[];
  /** Human labels per key; the raw key is used when one is missing. */
  labels?: Record<string, string>;
  max?: number;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.n), 1);
  return (
    <View style={{ gap: sp.sm }}>
      {rows.map((r, i) => (
        <View key={r.src} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1}>
            {labels?.[r.src] ?? r.src}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={{
                width: `${Math.max(1.5, (r.n / top) * 100)}%`,
                height: '100%',
                backgroundColor: seriesColor(i),
                borderRadius: 2,
              }}
            />
          </View>
          <Text style={styles.barValue}>{r.n.toLocaleString()}</Text>
        </View>
      ))}
    </View>
  );
}

/** A single proportion bar, for a per-couple composition strip. */
export function StackStrip({ counts, keys }: { counts: Record<string, number>; keys: string[] }) {
  const total = keys.reduce((a, k) => a + (counts[k] ?? 0), 0);
  if (total === 0) return <View style={[styles.stackStrip, { backgroundColor: colors.hairline }]} />;
  return (
    <View style={styles.stackStrip}>
      {keys.map((k, i) => {
        const n = counts[k] ?? 0;
        if (n === 0) return null;
        return <View key={k} style={{ flex: n, backgroundColor: seriesColor(i) }} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    paddingVertical: sp.xl,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: sp.sm,
    marginBottom: sp.sm,
    minHeight: 28,
  },
  readoutValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  readoutLabel: {
    ...text.caption,
    color: colors.inkMuted,
  },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: 0,
  },
  column: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null),
  },
  columnInner: {
    // Segments stack upward: the column is bottom-anchored and rendered in
    // reverse so the first key sits at the base.
    flexDirection: 'column-reverse',
    borderRadius: 2,
    overflow: 'hidden',
  },
  zeroTick: {
    height: 2,
    backgroundColor: colors.hairline,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: sp.xs,
  },
  axisLabel: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.inkFaint,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sp.xs,
    marginTop: sp.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: sp.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null),
  },
  legendItemOff: {
    backgroundColor: 'transparent',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.ink,
  },
  legendCount: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
  },
  barLabel: {
    ...text.caption,
    color: colors.inkMuted,
    width: 76,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    overflow: 'hidden',
  },
  barValue: {
    ...text.caption,
    color: colors.ink,
    width: 48,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  stackStrip: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.hairline,
  },
});
