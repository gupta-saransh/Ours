import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { successHaptic } from '@/lib/haptics';
import {
  Card,
  Empty,
  ErrorState,
  FormError,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Skeleton,
  TextField,
} from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, sp, text } from '@/theme';
import { countdownTo, milestoneDate, nextOccurrence } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';

interface Milestone {
  id: string;
  title: string;
  date: string;
  kind: 'anniversary' | 'birthday' | 'custom';
}

const KIND_LABEL: Record<Milestone['kind'], string> = {
  anniversary: 'Anniversary',
  birthday: 'Birthday',
  custom: 'Special day',
};

export default function Milestones() {
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Opened from the universal add button.
  useComposeParam(() => setComposerOpen(true));

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ milestones: Milestone[] }>('/api/milestones');
    setMilestones(data.milestones);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  // Live countdown tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sorted = useMemo(() => {
    if (!milestones) return null;
    return [...milestones].sort(
      (a, b) => nextOccurrence(a.date, a.kind, now).getTime() - nextOccurrence(b.date, b.kind, now).getTime()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, now.getDate()]);

  const remove = async (id: string) => {
    setMilestones((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    try {
      await api(`/api/milestones/${id}`, { method: 'DELETE' });
    } catch {
      load().catch(() => {});
    }
  };

  if (failed && !milestones) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (sorted === null) {
    return (
      <Screen>
        <View style={styles.list}>
          <Skeleton height={140} style={{ marginBottom: sp.lg }} />
          <Skeleton height={140} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={sorted}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Empty
            line="No dates marked yet."
            actionTitle="Add the first"
            onAction={() => setComposerOpen(true)}
          />
        }
        ListFooterComponent={
          sorted.length > 0 ? (
            <PrimaryButton title="Add a date" onPress={() => setComposerOpen(true)} style={{ marginTop: sp.md }} />
          ) : null
        }
        renderItem={({ item }) => <MilestoneCard milestone={item} now={now} onRemove={() => remove(item.id)} />}
      />
      <MilestoneComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(m) => {
          setMilestones((prev) => [...(prev ?? []), m]);
          setComposerOpen(false);
        }}
      />
    </Screen>
  );
}

function MilestoneCard({ milestone, now, onRemove }: { milestone: Milestone; now: Date; onRemove: () => void }) {
  const target = nextOccurrence(milestone.date, milestone.kind, now);
  const c = countdownTo(target, now);
  const original = milestoneDate(milestone.date);
  const yearsNext = milestone.kind !== 'custom' ? target.getFullYear() - original.getFullYear() : 0;

  return (
    <Card style={styles.milestone}>
      <View style={styles.topRow}>
        <Pill label={KIND_LABEL[milestone.kind]} tone="positive" />
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={[text.caption, { color: colors.inkFaint }]}>Remove</Text>
        </Pressable>
      </View>
      <Text style={[text.title, { marginTop: sp.md, marginBottom: sp.base }]}>{milestone.title}</Text>
      {c.past && milestone.kind === 'custom' ? (
        <Text style={styles.countPast}>
          {c.days === 0 ? 'Today ♥' : `${c.days.toLocaleString()} ${c.days === 1 ? 'day' : 'days'} ago`}
        </Text>
      ) : (
        <View style={styles.countRow}>
          <CountUnit n={c.days} label={c.days === 1 ? 'day' : 'days'} />
          <CountUnit n={c.hours} label="hrs" />
          <CountUnit n={c.minutes} label="min" />
          <CountUnit n={c.seconds} label="sec" />
        </View>
      )}
      <Text style={[text.caption, { marginTop: sp.base }]}>
        {target.getDate()} {target.toLocaleString('en', { month: 'long' })} {target.getFullYear()}
        {yearsNext > 0 ? ` · ${yearsNext} ${yearsNext === 1 ? 'year' : 'years'}` : ''}
      </Text>
    </Card>
  );
}

function CountUnit({ n, label }: { n: number; label: string }) {
  return (
    <View>
      <Text style={styles.unitNumber}>{n.toLocaleString()}</Text>
      <Text style={text.caption}>{label}</Text>
    </View>
  );
}

function MilestoneComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (m: Milestone) => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<Milestone['kind']>('anniversary');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError('Date should look like 2024-06-14 (YYYY-MM-DD)');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ milestone: Milestone }>('/api/milestones', {
        method: 'POST',
        body: { title, date: date.trim(), kind },
      });
      successHaptic();
      setTitle('');
      setDate('');
      onCreated(data.milestone);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={open} onClose={onClose} title="A date to hold onto">
      <View style={styles.kindRow}>
        {(['anniversary', 'birthday', 'custom'] as const).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} style={[styles.chip, kind === k && styles.chipActive]}>
            <Text style={[text.caption, kind === k && { color: colors.surfaceSealed, fontWeight: '600' }]}>
              {KIND_LABEL[k]}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextField
        label="What is it?"
        value={title}
        onChangeText={setTitle}
        placeholder={kind === 'anniversary' ? 'The day we met' : kind === 'birthday' ? 'Their birthday' : 'Trip to the coast'}
      />
      <TextField
        label={kind === 'custom' ? 'Date (YYYY-MM-DD)' : 'Original date (YYYY-MM-DD), repeats every year'}
        value={date}
        onChangeText={setDate}
        placeholder="2024-06-14"
        autoCapitalize="none"
      />
      <FormError message={error} />
      <PrimaryButton title="Add to our calendar" onPress={save} loading={busy} disabled={!title.trim() || !date.trim()} />
      <SecondaryButton title="Not now" onPress={onClose} style={{ marginTop: sp.md }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  milestone: { marginBottom: sp.lg },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countRow: { flexDirection: 'row', gap: sp.lg },
  unitNumber: {
    ...text.title,
    fontSize: 28,
    lineHeight: 34,
    color: colors.surfaceSealed,
    fontVariant: ['tabular-nums'],
  },
  countPast: { ...text.title, fontSize: 28, lineHeight: 34, color: colors.surfaceSealed },
  kindRow: { flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg },
  chip: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 999,
    paddingVertical: sp.sm,
    paddingHorizontal: sp.base,
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: { borderColor: colors.surfaceSealed },
});
