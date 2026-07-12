import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '@/lib/api';
import { Button, Card, EmptyState, Field, FormError } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';
import { countdownTo, milestoneDate, nextOccurrence } from '@/lib/format';

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
  const [composerOpen, setComposerOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const data = await api<{ milestones: Milestone[] }>('/api/milestones');
    setMilestones(data.milestones);
  }, []);

  useEffect(() => {
    load().catch(() => setMilestones([]));
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
  }, [milestones, now.getDate()]); // re-sort at most daily

  const remove = async (id: string) => {
    setMilestones((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    try {
      await api(`/api/milestones/${id}`, { method: 'DELETE' });
    } catch {
      load().catch(() => {});
    }
  };

  if (sorted === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={sorted}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="Mark what matters"
            line="Your anniversary, their birthday, the trip you’re counting down to."
          />
        }
        renderItem={({ item }) => <MilestoneCard milestone={item} now={now} onRemove={() => remove(item.id)} />}
      />
      <Pressable style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.rosePressed }]} onPress={() => setComposerOpen(true)}>
        <Text style={styles.fabText}>＋ Add a date</Text>
      </Pressable>
      <MilestoneComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(m) => {
          setMilestones((prev) => [...(prev ?? []), m]);
          setComposerOpen(false);
        }}
      />
    </View>
  );
}

function MilestoneCard({ milestone, now, onRemove }: { milestone: Milestone; now: Date; onRemove: () => void }) {
  const target = nextOccurrence(milestone.date, milestone.kind, now);
  const c = countdownTo(target, now);
  const original = milestoneDate(milestone.date);
  const yearsNext = milestone.kind !== 'custom' ? target.getFullYear() - original.getFullYear() : 0;

  return (
    <Card style={styles.milestone}>
      <View style={styles.milestoneTop}>
        <Text style={styles.kind}>{KIND_LABEL[milestone.kind]}</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{milestone.title}</Text>
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
      <Text style={styles.dateLine}>
        {target.getDate()} {target.toLocaleString('en', { month: 'long' })} {target.getFullYear()}
        {yearsNext > 0 ? ` · ${yearsNext} ${yearsNext === 1 ? 'year' : 'years'}` : ''}
      </Text>
    </Card>
  );
}

function CountUnit({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.unit}>
      <Text style={styles.unitNumber}>{n.toLocaleString()}</Text>
      <Text style={styles.unitLabel}>{label}</Text>
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
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>A date to hold onto</Text>
        <View style={styles.kindRow}>
          {(['anniversary', 'birthday', 'custom'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[styles.chip, kind === k && styles.chipActive]}
            >
              <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{KIND_LABEL[k]}</Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="What is it?"
          value={title}
          onChangeText={setTitle}
          placeholder={kind === 'anniversary' ? 'The day we met' : kind === 'birthday' ? 'Their birthday' : 'Trip to the coast'}
        />
        <Field
          label={kind === 'custom' ? 'Date (YYYY-MM-DD)' : 'Original date (YYYY-MM-DD) — repeats every year'}
          value={date}
          onChangeText={setDate}
          placeholder="2024-06-14"
          autoCapitalize="none"
        />
        <FormError message={error} />
        <Button title="Add to our calendar" onPress={save} loading={busy} disabled={!title.trim() || !date.trim()} />
        <Button title="Not now" variant="ghost" onPress={onClose} style={{ marginTop: space(2) }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  list: {
    padding: space(5),
    paddingBottom: space(28),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  milestone: { marginBottom: space(4) },
  milestoneTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kind: {
    fontSize: type.tiny,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.sage,
    fontWeight: '700',
  },
  remove: { fontSize: type.small, color: colors.inkSoft },
  title: {
    fontFamily: font.displayMedium,
    fontSize: type.title,
    color: colors.ink,
    marginTop: space(2),
    marginBottom: space(4),
  },
  countRow: { flexDirection: 'row', gap: space(5) },
  unit: { alignItems: 'flex-start' },
  unitNumber: {
    fontFamily: font.display,
    fontSize: 28,
    color: colors.rose,
    fontVariant: ['tabular-nums'],
  },
  unitLabel: { fontSize: type.tiny, color: colors.inkSoft, marginTop: 2 },
  countPast: { fontFamily: font.display, fontSize: 28, color: colors.rose },
  dateLine: { marginTop: space(4), fontSize: type.small, color: colors.inkSoft },
  fab: {
    position: 'absolute',
    bottom: space(6),
    alignSelf: 'center',
    backgroundColor: colors.rose,
    borderRadius: radius.full,
    paddingVertical: space(3.5),
    paddingHorizontal: space(6),
  },
  fabText: { color: '#FFF9F2', fontSize: type.body, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(59, 46, 42, 0.35)' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space(6),
    paddingBottom: space(10),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sheetTitle: {
    fontFamily: font.display,
    fontSize: type.title,
    color: colors.ink,
    marginBottom: space(4),
  },
  kindRow: { flexDirection: 'row', gap: space(2), marginBottom: space(5) },
  chip: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.full,
    paddingVertical: space(2),
    paddingHorizontal: space(4),
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  chipText: { fontSize: type.small, color: colors.inkSoft, fontWeight: '600' },
  chipTextActive: { color: colors.rose },
});
