import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { Card, Empty, ErrorState, Screen, Skeleton } from '@/components/kit';
import { colors, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';

interface Entry {
  prompt_date: string;
  prompt: string;
  answers: { user_id: string; text: string }[];
}

interface StreakState {
  current: number;
  longest: number;
}

/** Every prompt you both answered, newest first. */
export default function Prompts() {
  const { user, partner } = useAuth();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ entries: Entry[] }>('/api/prompt/history');
    setEntries(data.entries);
    api<{ streak?: StreakState }>('/api/prompt/today')
      .then((d) => setStreak(d.streak ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('prompt.revealed', () => load().catch(() => {}));

  if (failed && !entries) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!entries) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={140} style={{ marginBottom: sp.lg }} />
          <Skeleton height={140} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.prompt_date}
        contentContainerStyle={styles.body}
        ListHeaderComponent={
          streak && streak.longest >= 2 ? (
            <Text style={styles.streakLine}>
              {streak.current >= 2
                ? `♥ ${streak.current} days in a row · longest ${streak.longest}`
                : `You paused. Start again whenever. Longest so far, ${streak.longest} days.`}
            </Text>
          ) : null
        }
        ListEmptyComponent={<Empty line="No prompts answered together yet." />}
        renderItem={({ item }) => {
          const mine = item.answers.find((a) => a.user_id === user?.id);
          const theirs = item.answers.find((a) => a.user_id !== user?.id);
          return (
            <Card style={{ marginBottom: sp.lg }}>
              <Text style={text.caption}>{formatDay(item.prompt_date)}</Text>
              <Text style={[text.bodySerif, { fontStyle: 'italic', marginVertical: sp.sm }]}>{item.prompt}</Text>
              {mine && (
                <>
                  <Text style={[text.micro, { marginTop: sp.sm }]}>You</Text>
                  <Text style={text.bodySerif}>{mine.text}</Text>
                </>
              )}
              {theirs && (
                <>
                  <View style={styles.divider} />
                  <Text style={text.micro}>{partner?.display_name ?? 'Them'}</Text>
                  <Text style={text.bodySerif}>{theirs.text}</Text>
                </>
              )}
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
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: sp.md,
  },
  streakLine: {
    ...text.caption,
    textAlign: 'center',
    marginBottom: sp.lg,
  },
});
