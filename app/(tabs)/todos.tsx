import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { AppPressable, Card, Empty, ErrorState, Screen, Skeleton } from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, radius, sp, text } from '@/theme';
import { useComposeParam } from '@/lib/useComposeParam';

/**
 * The shared to-do list: one day at a time, arrows to step, the date itself
 * opens a calendar to jump anywhere (today included, both directions, since
 * this is a planner, not a log). Either partner ticks anything off or moves it
 * to another day or another person; only whoever added an item can reword or
 * delete it (see api/_routes/todo-item.ts).
 *
 * An unfinished item STAYS on the day it was due. Nothing rolls forward on its
 * own; the "N unfinished from earlier" banner is the nudge, and moving one
 * forward is a deliberate tap.
 */

interface Todo {
  id: string;
  author_id: string;
  assignee_id: string | null;
  title: string;
  due_date: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayUTC = () => new Date().toISOString().slice(0, 10);

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = dt.toLocaleDateString('en', { weekday: 'long' });
  const month = dt.toLocaleDateString('en', { month: 'long' });
  const year = dt.getFullYear() !== new Date().getFullYear() ? `, ${dt.getFullYear()}` : '';
  return `${weekday}, ${d} ${month}${year}`;
}

function sortTodos(items: Todo[]): Todo[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

type Assignee = 'both' | 'me' | 'partner';

export default function Todos() {
  const { user, partner } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayUTC());
  const [items, setItems] = useState<Todo[] | null>(null);
  const [overdue, setOverdue] = useState(0);
  const [earliestOverdue, setEarliestOverdue] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // 'jump' = the date header opened the calendar to navigate. 'move' = the
  // "Move this to..." action sheet opened it to reassign an item's day. One
  // flag rather than two booleans so the two flows can never both be visible.
  const [pickerMode, setPickerMode] = useState<'jump' | 'move' | null>(null);
  const [mover, setMover] = useState<Todo | null>(null);
  const inputRef = useRef<TextInput>(null);

  useComposeParam(() => inputRef.current?.focus());

  const load = useCallback(async (d: string) => {
    setFailed(false);
    const data = await api<{ date: string; items: Todo[]; overdue: number; earliestOverdue: string | null }>(
      `/api/todos?date=${d}`
    );
    setDate(data.date);
    setItems(data.items);
    setOverdue(data.overdue);
    setEarliestOverdue(data.earliestOverdue);
  }, []);

  useEffect(() => {
    load(todayUTC()).catch(() => setFailed(true));
  }, [load]);

  const goto = (d: string) => {
    tapHaptic();
    load(d).catch(() => setFailed(true));
  };

  // A partner-authored change matters to my view when it touches the day I am
  // looking at, either where the item now lives or where it moved FROM (so an
  // item that left today disappears from today's list without a stale reload).
  useCoupleEvent('todo.updated', (data) => {
    if (data?.by === user?.id) return;
    if (data?.due_date === date || data?.previous_due_date === date) load(date).catch(() => {});
  });

  const applyUpdate = (updated: Todo) => {
    setItems((prev) => {
      if (!prev) return prev;
      if (updated.due_date !== date) return prev.filter((i) => i.id !== updated.id);
      const exists = prev.some((i) => i.id === updated.id);
      return sortTodos(exists ? prev.map((i) => (i.id === updated.id ? updated : i)) : [...prev, updated]);
    });
  };

  const toggleDone = async (item: Todo) => {
    const next = !item.done;
    if (next) successHaptic();
    const optimistic: Todo = {
      ...item,
      done: next,
      done_by: next ? (user?.id ?? null) : null,
      done_at: next ? new Date().toISOString() : null,
    };
    applyUpdate(optimistic);
    try {
      const saved = await api<{ item: Todo }>(`/api/todos/${item.id}`, { method: 'PATCH', body: { done: next } });
      applyUpdate(saved.item);
    } catch {
      applyUpdate(item);
      toast.show('Could not save that. Try again.');
    }
  };

  const reassign = async (item: Todo) => {
    if (item.done) return;
    const order = [null, user?.id ?? null, partner?.id ?? null];
    const idx = order.findIndex((v) => v === item.assignee_id);
    const nextId = order[(idx + 1) % order.length];
    const optimistic = { ...item, assignee_id: nextId };
    applyUpdate(optimistic);
    try {
      const saved = await api<{ item: Todo }>(`/api/todos/${item.id}`, {
        method: 'PATCH',
        body: { assigneeId: nextId },
      });
      applyUpdate(saved.item);
    } catch {
      applyUpdate(item);
      toast.show('Could not save that. Try again.');
    }
  };

  const moveTo = async (item: Todo, newDate: string) => {
    setMover(null);
    tapHaptic();
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    try {
      await api(`/api/todos/${item.id}`, { method: 'PATCH', body: { dueDate: newDate } });
      toast.show(newDate === date ? 'Kept on this day.' : `Moved to ${dayLabel(newDate)}.`);
    } catch {
      load(date).catch(() => {});
      toast.show('Could not move that. Try again.');
    }
  };

  const remove = async (item: Todo) => {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    try {
      await api(`/api/todos/${item.id}`, { method: 'DELETE' });
    } catch {
      load(date).catch(() => {});
    }
  };

  const onCreated = (item: Todo) => {
    setItems((prev) => sortTodos([...(prev ?? []), item]));
  };

  if (failed && !items) {
    return (
      <Screen>
        <ErrorState onRetry={() => load(date).catch(() => setFailed(true))} />
      </Screen>
    );
  }

  const label = (id: string | null) => (id === null ? 'both' : id === user?.id ? 'you' : partner?.display_name ?? 'them');

  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.dayNav}>
          <Pressable onPress={() => goto(addDays(date, -1))} hitSlop={10} style={styles.navArrow}>
            <ChevronLeft size={20} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={() => setPickerMode('jump')} style={styles.dayLabelWrap}>
            <Text style={[text.title, { textAlign: 'center' }]} numberOfLines={1}>
              {dayLabel(date)}
            </Text>
            {date === todayUTC() && <Text style={styles.todayTag}>Today</Text>}
          </Pressable>
          <Pressable onPress={() => goto(addDays(date, 1))} hitSlop={10} style={styles.navArrow}>
            <ChevronRight size={20} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
        </View>

        {date === todayUTC() && overdue > 0 && (
          <Pressable
            onPress={() => earliestOverdue && goto(earliestOverdue)}
            style={styles.overdueBanner}
          >
            <Text style={styles.overdueText}>
              {overdue} unfinished from earlier · tap to catch up
            </Text>
          </Pressable>
        )}

        <Composer inputRef={inputRef} date={date} onCreated={onCreated} />

        {!items ? (
          <View>
            <Skeleton height={56} style={{ marginBottom: sp.md }} />
            <Skeleton height={56} style={{ marginBottom: sp.md }} />
            <Skeleton height={56} />
          </View>
        ) : items.length === 0 ? (
          <Empty line="Nothing on this day. Add something for either of you." />
        ) : (
          items.map((item) => (
            <TodoRow
              key={item.id}
              item={item}
              mine={item.author_id === user?.id}
              assigneeLabel={label(item.assignee_id)}
              onToggle={() => toggleDone(item)}
              onReassign={() => reassign(item)}
              onMove={() => setMover(item)}
              onDelete={() => remove(item)}
            />
          ))
        )}
      </View>

      {/* The action sheet hides itself once "Pick a day" hands off to the
          calendar below, so the two can never be visible at once. */}
      <Sheet
        visible={!!mover && pickerMode !== 'move'}
        onClose={() => setMover(null)}
        title="Move this to..."
      >
        {mover && (
          <>
            <Pressable style={styles.moveOption} onPress={() => moveTo(mover, addDays(date, 1))}>
              <Text style={text.body}>Tomorrow</Text>
            </Pressable>
            <Pressable style={styles.moveOption} onPress={() => setPickerMode('move')}>
              <Text style={text.body}>Pick a day</Text>
            </Pressable>
          </>
        )}
      </Sheet>

      <DayPickerSheet
        visible={pickerMode !== null}
        initial={date}
        onClose={() => {
          setPickerMode(null);
          setMover(null);
        }}
        onPick={(d) => {
          const mode = pickerMode;
          const item = mover;
          setPickerMode(null);
          setMover(null);
          if (mode === 'move' && item) moveTo(item, d);
          else goto(d);
        }}
      />
    </Screen>
  );
}

function TodoRow({
  item,
  mine,
  assigneeLabel,
  onToggle,
  onReassign,
  onMove,
  onDelete,
}: {
  item: Todo;
  mine: boolean;
  assigneeLabel: string;
  onToggle: () => void;
  onReassign: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <Card style={styles.row}>
      <Pressable onPress={onToggle} hitSlop={8} style={[styles.checkbox, item.done && styles.checkboxDone]}>
        {item.done && <Text style={styles.checkMark}>✓</Text>}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[text.body, item.done && styles.doneText]}>{item.title}</Text>
        <View style={styles.rowMeta}>
          {item.done ? (
            <Text style={text.caption}>done</Text>
          ) : (
            <Pressable onPress={onReassign} hitSlop={6}>
              <Text style={[text.caption, styles.assigneeTag]}>· {assigneeLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>
      {!item.done && (
        <Pressable onPress={onMove} hitSlop={8} style={styles.rowIcon}>
          <ChevronRight size={16} color={colors.inkFaint} strokeWidth={1.75} />
        </Pressable>
      )}
      {mine && (
        <Pressable onPress={onDelete} hitSlop={8} style={styles.rowIcon}>
          <Trash2 size={15} color={colors.inkFaint} strokeWidth={1.75} />
        </Pressable>
      )}
    </Card>
  );
}

function Composer({
  inputRef,
  date,
  onCreated,
}: {
  inputRef: React.RefObject<TextInput | null>;
  date: string;
  onCreated: (item: Todo) => void;
}) {
  const { user, partner } = useAuth();
  const [draft, setDraft] = useState('');
  const [assignee, setAssignee] = useState<Assignee>('both');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const assigneeId = assignee === 'me' ? user?.id : assignee === 'partner' ? partner?.id : null;
      const data = await api<{ item: Todo }>('/api/todos', {
        method: 'POST',
        body: { title, dueDate: date, assigneeId },
      });
      successHaptic();
      setDraft('');
      onCreated(data.item);
    } catch {
      // keep the draft so nothing is lost
    } finally {
      setBusy(false);
    }
  };

  const pill = (value: Assignee, label: string) => (
    <Pressable
      onPress={() => {
        tapHaptic();
        setAssignee(value);
      }}
      style={[styles.pill, assignee === value && styles.pillActive]}
    >
      <Text style={[text.micro, assignee === value && { color: colors.surfaceSealed, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={styles.composer}>
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        placeholder={`Add something for ${dayLabel(date).split(',')[0]}...`}
        placeholderTextColor={colors.inkFaint}
        style={styles.composerInput}
        onSubmitEditing={send}
        returnKeyType="done"
      />
      <View style={styles.composerRow}>
        <View style={styles.pillRow}>
          {pill('both', 'Both')}
          {pill('me', 'You')}
          {partner && pill('partner', partner.display_name)}
        </View>
        <AppPressable onPress={send} disabled={!draft.trim() || busy} style={[styles.send, (!draft.trim() || busy) && { opacity: 0.5 }]}>
          <Text style={{ color: colors.onSealed, fontSize: 16, fontWeight: '600' }}>Add</Text>
        </AppPressable>
      </View>
    </Card>
  );
}

/** Month grid for jumping to any day, past or future. Dots show what's pending. */
function DayPickerSheet({
  visible,
  initial,
  onClose,
  onPick,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onPick: (date: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [days, setDays] = useState<Record<string, { total: number; done: number }>>({});

  useEffect(() => {
    if (!visible) return;
    const [y, m] = initial.split('-').map(Number);
    setYear(y);
    setMonth(m - 1);
  }, [visible, initial]);

  useEffect(() => {
    if (!visible) return;
    const anchor = `${year}-${pad(month + 1)}-01`;
    api<{ days: { date: string; total: number; done: number }[] }>(`/api/todos?date=${anchor}`)
      .then((d) => {
        const map: Record<string, { total: number; done: number }> = {};
        d.days.forEach((x) => (map[x.date] = { total: x.total, done: x.done }));
        setDays(map);
      })
      .catch(() => {});
  }, [visible, year, month]);

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
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const monthName = new Date(year, month, 1).toLocaleString('en', { month: 'long' });
  const today = todayUTC();

  return (
    <Sheet visible={visible} onClose={onClose} title="Jump to a day">
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
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`b${i}`} style={styles.cell} />;
          const key = `${year}-${pad(month + 1)}-${pad(day)}`;
          const info = days[key];
          const isToday = isCurrentMonth && day === now.getDate();
          const pastPending = key < today && info && info.total > info.done;
          const dotColor = pastPending
            ? colors.danger
            : info && info.total > info.done
              ? colors.accent
              : info
                ? colors.positive
                : null;
          return (
            <Pressable
              key={key}
              onPress={() => onPick(key)}
              style={({ pressed }) => [styles.cell, isToday && styles.cellToday, pressed && { backgroundColor: colors.blushSoft }]}
            >
              <Text style={[text.caption, { color: colors.ink }]}>{day}</Text>
              {dotColor && <View style={[styles.dot, { backgroundColor: dotColor }]} />}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.md,
  },
  navArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  dayLabelWrap: { flex: 1, alignItems: 'center' },
  todayTag: { ...text.micro, color: colors.accent, marginTop: sp.xs },
  overdueBanner: {
    backgroundColor: 'rgba(190, 70, 60, 0.08)',
    borderRadius: radius.sm,
    padding: sp.md,
    marginBottom: sp.md,
  },
  overdueText: { ...text.caption, color: colors.danger, textAlign: 'center', fontWeight: '600' },
  composer: { marginBottom: sp.lg },
  composerInput: {
    ...text.body,
    minHeight: 40,
    paddingVertical: sp.sm,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: sp.sm,
  },
  pillRow: { flexDirection: 'row', gap: sp.xs, flexShrink: 1, flexWrap: 'wrap' },
  pill: {
    paddingVertical: sp.xs,
    paddingHorizontal: sp.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pillActive: { backgroundColor: colors.surfaceSealed, borderColor: colors.surfaceSealed },
  send: {
    height: 36,
    paddingHorizontal: sp.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    marginBottom: sp.sm,
    paddingVertical: sp.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: colors.positive, borderColor: colors.positive },
  checkMark: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  doneText: { textDecorationLine: 'line-through', color: colors.inkFaint },
  rowMeta: { flexDirection: 'row', alignItems: 'center', marginTop: sp.xs / 2 },
  assigneeTag: { color: colors.inkMuted },
  rowIcon: { padding: sp.xs },
  moveOption: {
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.md,
  },
  calendarArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1.1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  cellToday: { borderWidth: 1, borderColor: colors.accent },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
});
