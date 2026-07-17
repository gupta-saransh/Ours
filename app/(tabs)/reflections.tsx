import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { api } from '@/lib/api';
import { Card, Empty, ErrorState, Screen, Skeleton } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';

interface Snapshot {
  gallery?: { id: string; thumb_data: string | null; note: string }[];
  notes?: string[];
}

interface SavedReflection {
  id: string;
  week_start: string;
  counts: Record<string, number>;
  snapshot: Snapshot | null;
  created_at: string;
}

const LABELS: Record<string, string> = {
  memories: 'memories',
  notes: 'notes',
  prompts_together: 'prompts together',
  hearts: 'hearts',
  bucket_added: 'list items',
  nudges: 'nudges',
};

/** Saved weekly keepsakes, newest first. Each is a frozen little snapshot. */
export default function Reflections() {
  const [reflections, setReflections] = useState<SavedReflection[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ reflections: SavedReflection[] }>('/api/reflection/history');
    setReflections(data.reflections);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  if (failed && !reflections) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!reflections) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={160} style={{ marginBottom: sp.lg }} />
          <Skeleton height={160} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={reflections}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.body}
        ListEmptyComponent={<Empty line="No weeks kept yet. Sundays bring the chance." />}
        renderItem={({ item }) => {
          const photos = item.snapshot?.gallery?.filter((g) => g.thumb_data) ?? [];
          const note = item.snapshot?.notes?.[0];
          return (
            <Card style={{ marginBottom: sp.lg }}>
              <View style={styles.rule} />
              <Text style={[text.subtitle, { marginBottom: sp.md }]}>Week of {formatDay(item.week_start)}</Text>

              {photos.length > 0 && (
                <View style={styles.strip}>
                  {photos.map((g) => (
                    <Image key={g.id} source={{ uri: g.thumb_data! }} style={styles.stripPhoto} contentFit="cover" />
                  ))}
                </View>
              )}

              {note ? (
                <Text style={styles.quote} numberOfLines={3}>
                  &ldquo;{note}&rdquo;
                </Text>
              ) : null}

              <View style={styles.grid}>
                {Object.entries(LABELS).map(([key, label]) => (
                  <View key={key} style={styles.stat}>
                    <Text style={[text.subtitle, { color: colors.surfaceSealed }]}>
                      {(item.counts?.[key] ?? 0).toLocaleString()}
                    </Text>
                    <Text style={text.caption}>{label}</Text>
                  </View>
                ))}
              </View>
            </Card>
          );
        }}
      />
    </Screen>
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
  rule: {
    height: 1,
    backgroundColor: colors.accent,
    marginBottom: sp.md,
  },
  strip: {
    flexDirection: 'row',
    gap: sp.sm,
    marginBottom: sp.md,
  },
  stripPhoto: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  quote: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.inkMuted,
    marginBottom: sp.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    width: '33.3%',
    marginBottom: sp.md,
  },
});
