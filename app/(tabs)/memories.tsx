import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { Button, Card, EmptyState, FormError } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';
import { formatDay } from '@/lib/format';

interface Memory {
  id: string;
  author_id: string;
  author_name: string;
  thumb_data: string | null;
  has_photo: boolean;
  note: string;
  memory_date: string;
  created_at: string;
  hearts: number;
  hearted_by_me: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function Memories() {
  const { user } = useAuth();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [composerDate, setComposerDate] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Memory | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ memories: Memory[] }>('/api/memories');
    setMemories(data.memories);
  }, []);

  useEffect(() => {
    load().catch(() => setMemories([]));
  }, [load]);

  useCoupleEvent('memory.created', (data) => {
    if (data?.author_id !== user?.id) load().catch(() => {});
  });
  useCoupleEvent('memory.deleted', (data) => {
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== data?.id) : prev));
  });
  useCoupleEvent('memory.hearted', (data) => {
    if (data?.by === user?.id) return;
    setMemories((prev) =>
      prev ? prev.map((m) => (m.id === data?.id ? { ...m, hearts: data.hearts } : m)) : prev
    );
  });

  const datesWithMemories = useMemo(() => {
    const set = new Set<string>();
    memories?.forEach((m) => set.add(m.memory_date.slice(0, 10)));
    return set;
  }, [memories]);

  const toggleHeart = async (memory: Memory) => {
    const next = !memory.hearted_by_me;
    setMemories((prev) =>
      prev
        ? prev.map((m) =>
            m.id === memory.id
              ? { ...m, hearted_by_me: next, hearts: m.hearts + (next ? 1 : -1) }
              : m
          )
        : prev
    );
    await api(`/api/memories/${memory.id}`, { method: 'PATCH', body: { hearted: next } }).catch(() => {
      setMemories((prev) =>
        prev
          ? prev.map((m) =>
              m.id === memory.id
                ? { ...m, hearted_by_me: memory.hearted_by_me, hearts: memory.hearts }
                : m
            )
          : prev
      );
    });
  };

  if (memories === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={memories}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <MemoryCalendar datesWithMemories={datesWithMemories} onPickDate={(d) => setComposerDate(d)} />
            <Text style={styles.timelineTitle}>Your story so far</Text>
            {memories.length === 0 && (
              <EmptyState
                title="Your story starts here"
                line="Tap any day on the calendar and keep a photo, a moment, a line worth remembering."
              />
            )}
          </>
        }
        renderItem={({ item }) => (
          <Card style={styles.memory}>
            {item.thumb_data ? (
              <Pressable onPress={() => setViewer(item)}>
                <Image source={{ uri: item.thumb_data }} style={styles.photo} contentFit="cover" transition={150} />
              </Pressable>
            ) : null}
            <Text style={styles.note}>{item.note}</Text>
            <View style={styles.memoryFooter}>
              <Text style={styles.meta}>
                {item.author_id === user?.id ? 'You' : item.author_name} · {formatDay(item.memory_date)}
              </Text>
              <Pressable onPress={() => toggleHeart(item)} hitSlop={8} style={styles.heartButton}>
                <Text style={[styles.heartGlyph, item.hearted_by_me && { color: colors.rose }]}>
                  {item.hearted_by_me ? '♥' : '♡'}
                </Text>
                {item.hearts > 0 && <Text style={styles.heartCount}>{item.hearts}</Text>}
              </Pressable>
            </View>
          </Card>
        )}
      />
      <MemoryComposer
        date={composerDate}
        onClose={() => setComposerDate(null)}
        onCreated={(m) => {
          setMemories((prev) => {
            const next = [m, ...(prev ?? [])];
            next.sort((a, b) => b.memory_date.localeCompare(a.memory_date) || b.created_at.localeCompare(a.created_at));
            return next;
          });
          setComposerDate(null);
        }}
      />
      <PhotoViewer memory={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

/** Month grid. Days that hold a memory show a ♥ instead of their number. */
function MemoryCalendar({
  datesWithMemories,
  onPickDate,
}: {
  datesWithMemories: Set<string>;
  onPickDate: (date: string) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const shift = (delta: number) => {
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
    <Card style={styles.calendar}>
      <View style={styles.calendarHeader}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.calendarArrow}>
          <Text style={styles.calendarArrowText}>‹</Text>
        </Pressable>
        <Text style={styles.calendarMonth}>
          {monthName} {year}
        </Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.calendarArrow}>
          <Text style={styles.calendarArrowText}>›</Text>
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
          const has = datesWithMemories.has(key);
          const isToday = isCurrentMonth && day === today.getDate();
          const future = new Date(year, month, day).getTime() > today.getTime();
          return (
            <Pressable
              key={key}
              disabled={future}
              onPress={() => onPickDate(key)}
              style={({ pressed }) => [
                styles.cell,
                isToday && styles.cellToday,
                pressed && { backgroundColor: colors.blushSoft },
              ]}
            >
              {has ? (
                <Text style={styles.cellHeart}>♥</Text>
              ) : (
                <Text style={[styles.cellDay, future && { opacity: 0.3 }]}>{day}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.calendarHint}>Tap a day to keep a memory of it. ♥ marks the days you already have.</Text>
    </Card>
  );
}

function MemoryComposer({
  date,
  onClose,
  onCreated,
}: {
  date: string | null;
  onClose: () => void;
  onCreated: (m: Memory) => void;
}) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickPhoto = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets?.[0]) return;
    try {
      const uri = result.assets[0].uri;
      // Two sizes: full for the viewer, small thumb for lists. Keeps every
      // list request tiny, which is most of what makes the app feel fast.
      const [full, small] = await Promise.all([
        ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1200 } }], {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }),
        ImageManipulator.manipulateAsync(uri, [{ resize: { width: 360 } }], {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }),
      ]);
      setPhoto(`data:image/jpeg;base64,${full.base64}`);
      setThumb(`data:image/jpeg;base64,${small.base64}`);
    } catch {
      setError('Could not read that photo, try another one.');
    }
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await api<{ memory: Memory }>('/api/memories', {
        method: 'POST',
        body: { note, photoData: photo ?? undefined, thumbData: thumb ?? undefined, memoryDate: date ?? undefined },
      });
      setNote('');
      setPhoto(null);
      setThumb(null);
      onCreated(data.memory);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!date} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>A moment worth keeping</Text>
        {date && <Text style={styles.sheetDate}>{formatDay(date)}</Text>}
        <Pressable onPress={pickPhoto} style={styles.photoPick}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.photoPreview} contentFit="cover" />
          ) : (
            <Text style={styles.photoPickText}>✧ Add a photo</Text>
          )}
        </Pressable>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What happened? How did it feel?"
          placeholderTextColor={colors.inkSoft}
          multiline
          style={styles.noteInput}
        />
        <FormError message={error} />
        <Button title="Keep this memory" onPress={save} loading={busy} disabled={note.trim().length === 0} />
        <Button title="Not now" variant="ghost" onPress={onClose} style={{ marginTop: space(2) }} />
      </View>
    </Modal>
  );
}

/** Full-resolution photo, fetched only when a memory is opened. */
function PhotoViewer({ memory, onClose }: { memory: Memory | null; onClose: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    setPhoto(null);
    if (!memory?.has_photo) return;
    api<{ photo_data: string | null }>(`/api/memories/${memory.id}`)
      .then((d) => setPhoto(d.photo_data))
      .catch(() => {});
  }, [memory?.id]);

  if (!memory) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <View style={styles.viewerBody}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.viewerPhoto} contentFit="contain" transition={150} />
          ) : memory.thumb_data ? (
            <Image source={{ uri: memory.thumb_data }} style={styles.viewerPhoto} contentFit="contain" />
          ) : (
            <ActivityIndicator color={colors.onRose} />
          )}
          <Text style={styles.viewerNote}>{memory.note}</Text>
          <Text style={styles.viewerMeta}>
            {memory.author_name} · {formatDay(memory.memory_date)}
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  list: {
    padding: space(5),
    paddingBottom: space(16),
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  calendar: { marginBottom: space(6) },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space(3),
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
  calendarArrowText: { fontSize: 20, color: colors.ink, lineHeight: 22 },
  calendarMonth: { fontFamily: font.display, fontSize: type.heading, color: colors.ink },
  weekRow: { flexDirection: 'row', marginBottom: space(1) },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: type.tiny,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1.15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  cellToday: { borderWidth: 1, borderColor: colors.blush },
  cellDay: { fontSize: type.small, color: colors.ink },
  cellHeart: { fontSize: 17, color: colors.rose },
  calendarHint: {
    marginTop: space(2),
    fontSize: type.tiny,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  timelineTitle: {
    fontFamily: font.display,
    fontSize: type.title,
    color: colors.ink,
    marginBottom: space(4),
  },
  memory: { marginBottom: space(4), padding: space(3) },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  note: {
    fontFamily: font.serif,
    fontSize: type.heading,
    lineHeight: 28,
    color: colors.ink,
    paddingHorizontal: space(1),
    paddingTop: space(3),
  },
  memoryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space(1),
    paddingTop: space(2),
    paddingBottom: space(1),
  },
  meta: { fontSize: type.small, color: colors.inkSoft, flexShrink: 1 },
  heartButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heartGlyph: { fontSize: 19, color: colors.inkSoft },
  heartCount: { fontSize: type.small, color: colors.inkSoft, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(51, 36, 28, 0.4)' },
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
  sheetTitle: { fontFamily: font.display, fontSize: type.title, color: colors.ink },
  sheetDate: { fontSize: type.small, color: colors.rose, marginTop: 2, marginBottom: space(4), fontWeight: '600' },
  photoPick: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(4),
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  photoPickText: { color: colors.inkSoft, fontSize: type.body },
  photoPreview: { width: '100%', aspectRatio: 4 / 3 },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: space(3.5),
    minHeight: 96,
    fontSize: type.body,
    color: colors.ink,
    textAlignVertical: 'top',
    marginBottom: space(4),
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 18, 12, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(6),
  },
  viewerBody: { width: '100%', maxWidth: 720, alignItems: 'center' },
  viewerPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md },
  viewerNote: {
    fontFamily: font.serif,
    fontSize: type.heading,
    lineHeight: 27,
    color: colors.onRose,
    textAlign: 'center',
    marginTop: space(5),
  },
  viewerMeta: { fontSize: type.small, color: 'rgba(249, 239, 220, 0.65)', marginTop: space(2) },
});
