import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ChevronLeft, ChevronRight, Lock, Trash2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import {
  AppPressable,
  Card,
  Empty,
  ErrorState,
  FormError,
  IconButton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Skeleton,
  TextField,
} from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, radius, sp, text } from '@/theme';
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
  sealed_until: string | null;
  sealed: boolean;
  opened: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function Memories() {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'calendar' | 'timeline'>('timeline');
  const [composerDate, setComposerDate] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Memory | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ memories: Memory[] }>('/api/memories');
    setMemories(data.memories);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('memory.created', (data) => {
    if (data?.author_id !== user?.id) load().catch(() => {});
  });
  useCoupleEvent('memory.deleted', (data) => {
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== data?.id) : prev));
  });
  useCoupleEvent('capsule.opened', () => load().catch(() => {}));
  useCoupleEvent('memory.hearted', (data) => {
    if (data?.by === user?.id) return;
    setMemories((prev) => (prev ? prev.map((m) => (m.id === data?.id ? { ...m, hearts: data.hearts } : m)) : prev));
  });

  const datesWithMemories = useMemo(() => {
    const set = new Set<string>();
    memories?.forEach((m) => set.add(m.memory_date.slice(0, 10)));
    return set;
  }, [memories]);

  const toggleHeart = async (memory: Memory) => {
    const next = !memory.hearted_by_me;
    if (next) successHaptic();
    const apply = (list: Memory[] | null, hearted: boolean, hearts: number) =>
      list ? list.map((m) => (m.id === memory.id ? { ...m, hearted_by_me: hearted, hearts } : m)) : list;
    setMemories((prev) => apply(prev, next, memory.hearts + (next ? 1 : -1)));
    await api(`/api/memories/${memory.id}`, { method: 'PATCH', body: { hearted: next } }).catch(() => {
      setMemories((prev) => apply(prev, memory.hearted_by_me, memory.hearts));
    });
  };

  const onCreated = (m: Memory) => {
    setMemories((prev) => {
      const next = [m, ...(prev ?? [])];
      next.sort((a, b) => b.memory_date.localeCompare(a.memory_date) || b.created_at.localeCompare(a.created_at));
      return next;
    });
    setComposerDate(null);
  };

  const openMemory = (m: Memory) => {
    if (m.sealed && m.author_id !== user?.id) return; // still sealed for you
    setViewer(m);
    if (m.sealed_until && !m.sealed && !m.opened && m.author_id !== user?.id) {
      setMemories((prev) => (prev ? prev.map((x) => (x.id === m.id ? { ...x, opened: true } : x)) : prev));
    }
  };

  if (failed && !memories) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!memories) {
    return (
      <Screen>
        <View style={styles.list}>
          <Skeleton height={320} style={{ marginBottom: sp.lg }} />
          <Skeleton height={220} style={{ marginBottom: sp.lg }} />
          <Skeleton height={220} />
        </View>
      </Screen>
    );
  }

  const renderCard = ({ item }: { item: Memory }) => (
    <MemoryCard memory={item} mine={item.author_id === user?.id} onOpen={() => openMemory(item)} onHeart={() => toggleHeart(item)} />
  );

  const onDeleted = (id: string) => {
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    setViewer(null);
  };

  const overlays = (
    <>
      <MemoryComposer date={composerDate} onClose={() => setComposerDate(null)} onCreated={onCreated} />
      <RevealViewer memory={viewer} myId={user?.id ?? ''} onClose={() => setViewer(null)} onDeleted={onDeleted} />
    </>
  );

  if (wide) {
    return (
      <Screen>
        <View style={styles.wideRow}>
          <ScrollView style={styles.wideLeft} contentContainerStyle={{ padding: sp.xl }}>
            <Text style={[text.title, { marginBottom: sp.md }]}>Memories</Text>
            <MemoryCalendar datesWithMemories={datesWithMemories} onPickDate={setComposerDate} />
          </ScrollView>
          <View style={styles.wideRight}>
            <FlatList
              data={memories}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.wideList}
              ListHeaderComponent={<Text style={[text.title, { marginBottom: sp.md }]}>Your story so far</Text>}
              ListEmptyComponent={<Empty line="No memories from any day yet." />}
              renderItem={renderCard}
            />
          </View>
          {overlays}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.segmentWrap}>
        {(['calendar', 'timeline'] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => {
              tapHaptic();
              setView(v);
            }}
            style={[styles.segment, view === v && styles.segmentActive]}
          >
            <Text style={[text.caption, view === v && { color: colors.surfaceSealed, fontWeight: '600' }]}>
              {v === 'calendar' ? 'Calendar' : 'Timeline'}
            </Text>
          </Pressable>
        ))}
      </View>
      {view === 'calendar' ? (
        <ScrollView contentContainerStyle={styles.list}>
          <MemoryCalendar datesWithMemories={datesWithMemories} onPickDate={setComposerDate} />
        </ScrollView>
      ) : (
        <FlatList
          data={memories}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Empty
              line="No memories from any day yet."
              actionTitle="Add one for today"
              onAction={() => setComposerDate(new Date().toISOString().slice(0, 10))}
            />
          }
          renderItem={renderCard}
        />
      )}
      {overlays}
    </Screen>
  );
}

function MemoryCard({
  memory,
  mine,
  onOpen,
  onHeart,
}: {
  memory: Memory;
  mine: boolean;
  onOpen: () => void;
  onHeart: () => void;
}) {
  // Sealed by your partner, date not reached: a wax-sealed card, not tappable.
  if (memory.sealed && !mine) {
    return (
      <Card sealed style={styles.memory}>
        <Text style={styles.sealMark}>✦</Text>
        <Text style={[text.subtitle, { color: colors.onSealed, textAlign: 'center' }]}>
          Sealed until {formatDay(memory.sealed_until!)}
        </Text>
        <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.xs }]}>
          Written by {memory.author_name}, {formatDay(memory.created_at)}
        </Text>
      </Card>
    );
  }

  // A capsule whose day has come and you have not opened it yet.
  const readyToOpen = !!memory.sealed_until && !memory.sealed && !memory.opened && !mine;
  if (readyToOpen) {
    return (
      <AppPressable onPress={onOpen}>
        <Card sealed style={styles.memory}>
          <Text style={styles.sealMark}>✦</Text>
          <Text style={[text.subtitle, { color: colors.onSealed, textAlign: 'center' }]}>A time capsule is ready</Text>
          <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.xs }]}>
            Tap to open it.
          </Text>
        </Card>
      </AppPressable>
    );
  }

  return (
    <Card style={styles.memory}>
      {memory.sealed && mine && (
        <View style={styles.sealedTag}>
          <Lock size={12} color={colors.accent} strokeWidth={1.75} />
          <Text style={[text.micro, { color: colors.accent }]}>Sealed until {formatDay(memory.sealed_until!)}</Text>
        </View>
      )}
      <MemoryImage memory={memory} onPress={onOpen} />
      <Text style={styles.note}>{memory.note}</Text>
      <View style={styles.memoryFooter}>
        <Text style={text.caption}>
          {mine ? 'You' : memory.author_name} · {formatDay(memory.memory_date)}
        </Text>
        <Pressable onPress={onHeart} hitSlop={8} style={styles.heartButton}>
          <Text style={[styles.heartGlyph, memory.hearted_by_me && { color: colors.surfaceSealed }]}>
            {memory.hearted_by_me ? '♥' : '♡'}
          </Text>
          {memory.hearts > 0 && <Text style={[text.caption, { fontWeight: '600' }]}>{memory.hearts}</Text>}
        </Pressable>
      </View>
    </Card>
  );
}

/**
 * Shows the thumbnail. Memories saved before thumbnails existed have only the
 * full photo, so those fetch it on demand instead of rendering blank.
 */
function MemoryImage({ memory, onPress }: { memory: Memory; onPress: () => void }) {
  const [src, setSrc] = useState<string | null>(memory.thumb_data);

  useEffect(() => {
    setSrc(memory.thumb_data);
    if (!memory.thumb_data && memory.has_photo && !memory.sealed) {
      api<{ photo_data: string | null }>(`/api/memories/${memory.id}`)
        .then((d) => d.photo_data && setSrc(d.photo_data))
        .catch(() => {});
    }
  }, [memory.id, memory.thumb_data, memory.sealed, memory.has_photo]);

  if (!memory.has_photo && !memory.thumb_data) return null;
  return (
    <Pressable onPress={onPress}>
      {src ? (
        <Image source={{ uri: src }} style={styles.photo} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.photo, styles.photoLoading]}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      )}
    </Pressable>
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
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const monthName = new Date(year, month, 1).toLocaleString('en', { month: 'long' });

  return (
    <Card>
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
              style={({ pressed }) => [styles.cell, isToday && styles.cellToday, pressed && { backgroundColor: colors.blushSoft }]}
            >
              {has ? (
                <Text style={styles.cellHeart}>♥</Text>
              ) : (
                <Text style={[text.caption, { color: colors.ink }, future && { opacity: 0.3 }]}>{day}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={[text.caption, { textAlign: 'center', marginTop: sp.sm }]}>
        Tap a day to keep a memory of it. ♥ marks the days you already have.
      </Text>
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
  const [sealOpen, setSealOpen] = useState(false);
  const [sealDate, setSealDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickPhoto = async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (result.canceled || !result.assets?.[0]) return;
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
    if (sealOpen && sealDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(sealDate.trim())) {
      setError('Seal date should look like 2027-02-14 (YYYY-MM-DD)');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ memory: Memory }>('/api/memories', {
        method: 'POST',
        body: {
          note,
          photoData: photo ?? undefined,
          thumbData: thumb ?? undefined,
          memoryDate: date ?? undefined,
          sealedUntil: sealOpen && sealDate.trim() ? sealDate.trim() : undefined,
        },
      });
      successHaptic();
      setNote('');
      setPhoto(null);
      setThumb(null);
      setSealDate('');
      setSealOpen(false);
      onCreated(data.memory);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={!!date} onClose={onClose} title="A moment worth keeping">
      {date && <Text style={[text.caption, { color: colors.accent, marginBottom: sp.base }]}>{formatDay(date)}</Text>}
      <Pressable onPress={pickPhoto} style={styles.photoPick}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.photoPreview} contentFit="cover" />
        ) : (
          <Text style={[text.body, { color: colors.inkMuted }]}>✧ Add a photo</Text>
        )}
      </Pressable>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="What happened? How did it feel?"
        placeholderTextColor={colors.inkFaint}
        multiline
        style={styles.noteInput}
      />
      <Pressable onPress={() => setSealOpen((o) => !o)} style={styles.sealToggle} hitSlop={6}>
        <Lock size={14} color={sealOpen ? colors.accent : colors.inkFaint} strokeWidth={1.75} />
        <Text style={[text.caption, sealOpen && { color: colors.accent }]}>Seal until a future date</Text>
      </Pressable>
      {sealOpen && (
        <TextField
          label="Reveal date (YYYY-MM-DD)"
          value={sealDate}
          onChangeText={setSealDate}
          placeholder="2027-02-14"
          autoCapitalize="none"
        />
      )}
      <FormError message={error} />
      <PrimaryButton
        title={sealOpen && sealDate.trim() ? 'Seal this memory' : 'Keep this memory'}
        onPress={save}
        loading={busy}
        disabled={note.trim().length === 0}
      />
      <SecondaryButton title="Not now" onPress={onClose} style={{ marginTop: sp.md }} />
    </Sheet>
  );
}

/**
 * Full memory viewer. Also the capsule reveal: opening a ready capsule marks
 * it opened server-side (the GET does that) and tells the author. Either partner
 * can delete the memory here via a two-step inline confirm.
 */
function RevealViewer({
  memory,
  myId,
  onClose,
  onDeleted,
}: {
  memory: Memory | null;
  myId: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const isReveal = !!memory && !!memory.sealed_until && !memory.sealed && memory.author_id !== myId;

  useEffect(() => {
    setPhoto(null);
    setConfirming(false);
    setDeleting(false);
    if (!memory) return;
    // Fetch even without a photo when it is a capsule: the GET records the open.
    if (memory.has_photo || isReveal) {
      api<{ photo_data: string | null }>(`/api/memories/${memory.id}`)
        .then((d) => setPhoto(d.photo_data))
        .catch(() => {});
    }
  }, [memory?.id]);

  if (!memory) return null;

  // Tapping outside the buttons cancels a pending confirm, else closes.
  const onBackdrop = () => {
    if (confirming) setConfirming(false);
    else onClose();
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api(`/api/memories/${memory.id}`, { method: 'DELETE' });
      successHaptic();
      onDeleted(memory.id); // optimistic; the server also publishes memory.deleted
    } catch {
      toast.show('Could not delete. Try again.');
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onBackdrop}>
        <View style={styles.viewerBody}>
          {/* Keep taps on the delete controls from bubbling to the backdrop
              (which would close/cancel on web where clicks propagate). */}
          <Pressable style={styles.viewerBar} onPress={(e) => e.stopPropagation()}>
            {deleting ? (
              <ActivityIndicator size="small" color={colors.onSealed} />
            ) : confirming ? (
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Delete?</Text>
                <SecondaryButton
                  title="Yes, delete"
                  destructive
                  onPress={doDelete}
                  style={styles.confirmButton}
                />
              </View>
            ) : (
              <IconButton onPress={() => setConfirming(true)}>
                <Trash2 size={20} color={colors.onSealed} strokeWidth={1.75} />
              </IconButton>
            )}
          </Pressable>
          {isReveal && <Text style={styles.viewerSeal}>✦ ✦</Text>}
          {memory.has_photo ? (
            photo ? (
              <Image source={{ uri: photo }} style={styles.viewerPhoto} contentFit="contain" transition={150} />
            ) : memory.thumb_data ? (
              <Image source={{ uri: memory.thumb_data }} style={styles.viewerPhoto} contentFit="contain" />
            ) : (
              <ActivityIndicator size="small" color={colors.onSealed} />
            )
          ) : null}
          <Text style={styles.viewerNote}>{memory.note}</Text>
          <Text style={styles.viewerMeta}>
            {memory.author_name} · {formatDay(memory.memory_date)}
            {memory.sealed_until ? ` · sealed ${formatDay(memory.created_at)}` : ''}
          </Text>
        </View>
      </Pressable>
    </Modal>
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
  wideRow: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
  },
  wideLeft: { width: 420, flexGrow: 0 },
  wideRight: { flex: 1 },
  wideList: { padding: sp.xl, paddingBottom: sp.huge },
  segmentWrap: {
    flexDirection: 'row',
    gap: sp.sm,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  segment: {
    paddingVertical: sp.sm,
    paddingHorizontal: sp.base,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  segmentActive: { borderColor: colors.surfaceSealed },
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
  weekRow: { flexDirection: 'row', marginBottom: sp.xs },
  weekday: {
    flex: 1,
    textAlign: 'center',
    ...text.micro,
    color: colors.inkMuted,
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
  cellHeart: { fontSize: 15, color: colors.surfaceSealed },
  memory: { marginBottom: sp.lg },
  sealMark: {
    fontSize: 22,
    color: colors.accent,
    textAlign: 'center',
    marginBottom: sp.sm,
  },
  sealedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.xs,
    marginBottom: sp.sm,
  },
  photo: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  photoLoading: { alignItems: 'center', justifyContent: 'center' },
  note: {
    ...text.bodySerif,
    fontSize: 17,
    lineHeight: 26,
    paddingTop: sp.md,
  },
  memoryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: sp.sm,
  },
  heartButton: { flexDirection: 'row', alignItems: 'center', gap: sp.xs },
  heartGlyph: { fontSize: 19, color: colors.inkMuted },
  photoPick: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sp.base,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  photoPreview: { width: '100%', aspectRatio: 16 / 10 },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    padding: sp.md,
    minHeight: 96,
    ...text.body,
    textAlignVertical: 'top',
    marginBottom: sp.md,
  },
  sealToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    marginBottom: sp.base,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 18, 12, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp.xl,
  },
  viewerBody: { width: '100%', maxWidth: 720, alignItems: 'center' },
  viewerBar: {
    width: '100%',
    minHeight: 40,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: sp.sm,
  },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  confirmLabel: { ...text.caption, color: colors.onSealed },
  confirmButton: {
    height: 40,
    paddingHorizontal: sp.base,
    borderColor: 'rgba(249, 239, 220, 0.5)',
  },
  viewerSeal: {
    fontSize: 24,
    color: colors.accent,
    marginBottom: sp.lg,
    letterSpacing: 12,
  },
  viewerPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md },
  viewerNote: {
    ...text.bodySerif,
    fontSize: 18,
    lineHeight: 28,
    color: colors.onSealed,
    textAlign: 'center',
    marginTop: sp.lg,
  },
  viewerMeta: {
    ...text.caption,
    color: 'rgba(249, 239, 220, 0.65)',
    marginTop: sp.sm,
  },
});
