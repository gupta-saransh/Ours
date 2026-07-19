import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Keyboard as KeyboardIcon,
  Lock,
  MessageCircle,
  Pin,
  Smile,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
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
import { Avatar } from '@/components/Avatar';
import { EmojiPicker } from '@/components/EmojiPicker';
import { LockBadge } from '@/components/LockBadge';
import { MemoryComments } from '@/components/MemoryComments';
import { colors, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';
import { momentTarget } from '@/lib/momentTarget';

/**
 * The Timeline: photos and notes in ONE feed, the merge of what used to be the
 * Memories tab and the Notes wall.
 *
 * ORDER. Everything sorts by the day it is ABOUT, not the moment it was typed:
 * a memory uses its `memory_date` (which the calendar lets you backdate), a note
 * uses the day it was written. So a photo you add today of last summer drops
 * into last summer, where the calendar already says it belongs. The two halves
 * of the screen agree with each other, which is the entire reason for the rule.
 *
 * PINNED notes are the exception and float above the flow in their own block:
 * pinning something means you want it in front of you, not filed by date.
 *
 * ONE COMPOSER. Since the two tabs merged, "add a note" and "add a memory" are
 * no longer separate acts: `MomentComposer` takes words, a photo, or both, the
 * way a LinkedIn post does. Two tables still back it (see momentTarget.ts for
 * the routing rule and why the date matters), but that is storage detail the
 * writer never sees. The feed's top row is a slim TRIGGER, not a live input,
 * so the composer markup exists exactly once and the feed keeps its space.
 */

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
  comments: number;
  sealed_until: string | null;
  sealed: boolean;
  opened: boolean;
}

interface Note {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  pinned: boolean;
  created_at: string;
  sealed_until: string | null;
  sealed: boolean;
  opened: boolean;
  hearts: number;
  hearted_by_me: boolean;
}

type Entry =
  | { type: 'header'; key: string; day: string }
  | { type: 'memory'; key: string; day: string; at: string; memory: Memory }
  | { type: 'note'; key: string; day: string; at: string; note: Note };

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const today = () => new Date().toISOString().slice(0, 10);

// Gentle starters for the blank-input moment; the day picks one and the ✦
// button deals another. They are placeholders only, never inserted text.
const SPARKS = [
  'Tell them something you noticed today...',
  'What made you smile about them this week?',
  'Finish this: I love the way you...',
  'Say thank you for one small thing...',
  'Leave a line from a song that is theirs...',
  'What are you looking forward to, together?',
  'Remind them of a moment only you two know...',
  'What do they do better than anyone?',
];

function relativeTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDay(iso);
}

/** Deterministic tiny tilt per note, so notes still read as pinned paper. */
function tiltFor(id: string): string {
  const n = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 5;
  return `${(n - 2) * 0.4}deg`;
}

export default function Timeline() {
  const { user, partner } = useAuth();
  // Any author who is not you is your partner, so their nickname (already baked
  // into partner.display_name at /api/auth/me) is the name to show on their rows.
  const partnerName = partner?.display_name ?? null;
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;

  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'calendar' | 'timeline'>('timeline');
  // The one composer. `date` pins it to a calendar day (null = today, and a
  // wordless entry then stays a note); `withPhoto` opens the picker straight
  // away, for the trigger row's photo shortcut.
  const [composer, setComposer] = useState<{ date: string | null; withPhoto?: boolean } | null>(null);
  // The calendar is a BROWSER: tapping a day selects it and lists that day
  // below, rather than jumping straight into the composer. Starts on today so
  // the space under the calendar is never empty.
  const [selectedDay, setSelectedDay] = useState<string>(today());
  const [viewer, setViewer] = useState<Memory | null>(null);
  const [reveal, setReveal] = useState<Note | null>(null);
  // Cards with their comment thread expanded inline (Facebook-style, below the
  // card). Tapping the photo still opens the full viewer.
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());

  // The universal add button now has a single Timeline action, so there is no
  // `kind` to disambiguate any more: any compose request opens the one
  // composer, undated (today).
  useComposeParam(() => setComposer({ date: null }));

  const load = useCallback(async () => {
    setFailed(false);
    const [m, n] = await Promise.all([
      api<{ memories: Memory[] }>('/api/memories'),
      api<{ notes: Note[] }>('/api/notes'),
    ]);
    setMemories(m.memories);
    setNotes(n.notes);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  const loadMemories = useCallback(async () => {
    const d = await api<{ memories: Memory[] }>('/api/memories');
    setMemories(d.memories);
  }, []);

  useCoupleEvent('memory.created', (data) => {
    if (data?.author_id !== user?.id) loadMemories().catch(() => {});
  });
  useCoupleEvent('memory.deleted', (data) => {
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== data?.id) : prev));
  });
  useCoupleEvent('memory.hearted', (data) => {
    if (data?.by === user?.id) return;
    setMemories((prev) => (prev ? prev.map((m) => (m.id === data?.id ? { ...m, hearts: data.hearts } : m)) : prev));
  });
  // Keep card comment counts fresh. Own events count too: the server echoes
  // them back on the couple channel, which is what updates the list while the
  // viewer is open.
  useCoupleEvent('memory.commented', (data) => {
    const delta = data?.created ? 1 : data?.deleted ? -1 : 0;
    if (!delta) return;
    setMemories((prev) =>
      prev ? prev.map((m) => (m.id === data?.memory_id ? { ...m, comments: Math.max(0, m.comments + delta) } : m)) : prev
    );
  });
  useCoupleEvent('note.created', (note: Note) => {
    if (note?.author_id === user?.id) return;
    // Ably payloads predate hearts; default them so the card renders.
    const withHearts = { ...note, hearts: note.hearts ?? 0, hearted_by_me: note.hearted_by_me ?? false };
    setNotes((prev) => [withHearts, ...(prev ?? []).filter((n) => n.id !== note.id)]);
  });
  useCoupleEvent('note.pinned', (updated: Note) => {
    setNotes((prev) => (prev ? prev.map((n) => (n.id === updated.id ? { ...n, pinned: updated.pinned } : n)) : prev));
  });
  useCoupleEvent('note.deleted', (data) => {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== data?.id) : prev));
  });
  useCoupleEvent('note.hearted', (data) => {
    if (data?.by === user?.id) return;
    setNotes((prev) => (prev ? prev.map((n) => (n.id === data?.id ? { ...n, hearts: data.hearts } : n)) : prev));
  });
  useCoupleEvent('capsule.opened', () => load().catch(() => {}));

  const pinned = useMemo(() => (notes ?? []).filter((n) => n.pinned), [notes]);

  /** The merged feed: one day at a time, newest day first, headers injected. */
  const feed = useMemo<Entry[]>(() => {
    if (!memories || !notes) return [];
    const items: Exclude<Entry, { type: 'header' }>[] = [
      ...memories.map((m) => ({
        type: 'memory' as const,
        key: `m${m.id}`,
        day: m.memory_date.slice(0, 10),
        at: m.created_at,
        memory: m,
      })),
      ...notes
        .filter((n) => !n.pinned)
        .map((n) => ({
          type: 'note' as const,
          key: `n${n.id}`,
          day: n.created_at.slice(0, 10),
          at: n.created_at,
          note: n,
        })),
    ];
    // The day decides the position; within a day, most recently added first.
    items.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at));

    const out: Entry[] = [];
    let lastDay = '';
    for (const item of items) {
      if (item.day !== lastDay) {
        out.push({ type: 'header', key: `h${item.day}`, day: item.day });
        lastDay = item.day;
      }
      out.push(item);
    }
    return out;
  }, [memories, notes]);

  /**
   * Everything that belongs to the selected calendar day, newest first. Uses
   * the same "day it is about" rule as the feed (memory_date for photos,
   * created_at for notes) so the list under the calendar always agrees with
   * the ♥ on the cell above it. Pinned notes are INCLUDED here, unlike in the
   * feed: the question this panel answers is "what is from this day", and a
   * pinned note is still from its day.
   */
  const dayEntries = useMemo<Entry[]>(() => {
    if (!memories || !notes) return [];
    const items: Exclude<Entry, { type: 'header' }>[] = [
      ...memories
        .filter((m) => m.memory_date.slice(0, 10) === selectedDay)
        .map((m) => ({ type: 'memory' as const, key: `dm${m.id}`, day: selectedDay, at: m.created_at, memory: m })),
      ...notes
        .filter((n) => n.created_at.slice(0, 10) === selectedDay)
        .map((n) => ({ type: 'note' as const, key: `dn${n.id}`, day: selectedDay, at: n.created_at, note: n })),
    ];
    items.sort((a, b) => b.at.localeCompare(a.at));
    return items;
  }, [selectedDay, memories, notes]);

  /** A day lights up on the calendar when it holds a memory OR a note. */
  const daysWithSomething = useMemo(() => {
    const set = new Set<string>();
    memories?.forEach((m) => set.add(m.memory_date.slice(0, 10)));
    notes?.forEach((n) => set.add(n.created_at.slice(0, 10)));
    return set;
  }, [memories, notes]);

  const toggleMemoryHeart = async (memory: Memory) => {
    const next = !memory.hearted_by_me;
    if (next) successHaptic();
    const apply = (list: Memory[] | null, hearted: boolean, hearts: number) =>
      list ? list.map((m) => (m.id === memory.id ? { ...m, hearted_by_me: hearted, hearts } : m)) : list;
    setMemories((prev) => apply(prev, next, Math.max(0, memory.hearts + (next ? 1 : -1))));
    try {
      // The response carries the authoritative count and my own heart state;
      // settling on it means the UI can never drift from the database.
      const saved = await api<{ hearts: number; hearted_by_me: boolean }>(`/api/memories/${memory.id}`, {
        method: 'PATCH',
        body: { hearted: next },
      });
      setMemories((prev) => apply(prev, saved.hearted_by_me, saved.hearts));
    } catch {
      setMemories((prev) => apply(prev, memory.hearted_by_me, memory.hearts));
    }
  };

  const toggleNoteHeart = async (note: Note) => {
    const next = !note.hearted_by_me;
    if (next) successHaptic();
    const apply = (list: Note[] | null, hearted: boolean, hearts: number) =>
      list ? list.map((n) => (n.id === note.id ? { ...n, hearted_by_me: hearted, hearts } : n)) : list;
    setNotes((prev) => apply(prev, next, Math.max(0, note.hearts + (next ? 1 : -1))));
    try {
      const saved = await api<{ hearts: number; hearted_by_me: boolean }>(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: { hearted: next },
      });
      setNotes((prev) => apply(prev, saved.hearted_by_me, saved.hearts));
    } catch {
      setNotes((prev) => apply(prev, note.hearted_by_me, note.hearts));
    }
  };

  const togglePin = async (note: Note) => {
    setNotes((prev) => (prev ? prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) : prev));
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { pinned: !note.pinned } });
    } catch {
      setNotes((prev) => (prev ? prev.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n)) : prev));
    }
  };

  const removeNote = async (note: Note) => {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
    } catch {
      load().catch(() => {});
    }
  };

  const openCapsule = async (note: Note) => {
    setReveal(note);
    if (!note.opened && note.author_id !== user?.id) {
      successHaptic();
      setNotes((prev) => (prev ? prev.map((n) => (n.id === note.id ? { ...n, opened: true } : n)) : prev));
      api(`/api/notes/${note.id}`, { method: 'PATCH', body: { open: true } }).catch(() => {});
    }
  };

  /** One callback for both shapes; the composer decides which table it used. */
  const onMomentCreated = (created: { type: 'memory'; memory: Memory } | { type: 'note'; note: Note }) => {
    if (created.type === 'memory') setMemories((prev) => [created.memory, ...(prev ?? [])]);
    else setNotes((prev) => [created.note, ...(prev ?? [])]);
    setComposer(null);
  };

  const openMemory = (m: Memory) => {
    if (m.sealed && m.author_id !== user?.id) return; // still sealed for you
    setViewer(m);
    if (m.sealed_until && !m.sealed && !m.opened && m.author_id !== user?.id) {
      setMemories((prev) => (prev ? prev.map((x) => (x.id === m.id ? { ...x, opened: true } : x)) : prev));
    }
  };

  const toggleThread = (id: string) => {
    tapHaptic();
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const syncCount = (id: string, count: number) => {
    setMemories((prev) => (prev ? prev.map((m) => (m.id === id ? { ...m, comments: count } : m)) : prev));
  };

  if (failed && !memories) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!memories || !notes) {
    return (
      <Screen>
        <View style={styles.list}>
          <Skeleton height={140} style={{ marginBottom: sp.lg }} />
          <Skeleton height={320} style={{ marginBottom: sp.lg }} />
          <Skeleton height={220} />
        </View>
      </Screen>
    );
  }

  const renderNoteCard = (item: Note, keyed = true) => {
    const mine = item.author_id === user?.id;

    if (item.sealed && !mine) {
      return (
        <Card key={keyed ? item.id : undefined} sealed style={styles.note}>
          <Text style={styles.sealMark}>✦</Text>
          <Text style={[text.subtitle, { color: colors.onSealed, textAlign: 'center' }]}>
            Sealed until {formatDay(item.sealed_until!)}
          </Text>
          <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.xs }]}>
            Written by {partnerName ?? item.author_name}, {formatDay(item.created_at)}
          </Text>
        </Card>
      );
    }

    const readyToOpen = !!item.sealed_until && !item.sealed && !item.opened && !mine;
    if (readyToOpen) {
      return (
        <AppPressable key={keyed ? item.id : undefined} onPress={() => openCapsule(item)}>
          <Card sealed style={styles.note}>
            <Text style={styles.sealMark}>✦</Text>
            <Text style={[text.subtitle, { color: colors.onSealed, textAlign: 'center' }]}>A time capsule is ready</Text>
            <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.xs }]}>
              Tap to open it.
            </Text>
          </Card>
        </AppPressable>
      );
    }

    const lovedByPartner = item.hearts > (item.hearted_by_me ? 1 : 0);
    return (
      <Card
        key={keyed ? item.id : undefined}
        style={[styles.note, item.pinned ? styles.notePinned : { transform: [{ rotate: tiltFor(item.id) }] }]}
      >
        {item.pinned ? <Text style={styles.pinMark}>✦</Text> : null}
        {item.sealed && mine ? (
          <View style={styles.sealedTag}>
            <Lock size={12} color={colors.accent} strokeWidth={1.75} />
            <Text style={[text.micro, { color: colors.accent }]}>Sealed until {formatDay(item.sealed_until!)}</Text>
          </View>
        ) : null}
        <Text style={styles.noteBody}>{item.body}</Text>
        <View style={styles.noteFooter}>
          <View style={styles.noteAuthor}>
            <Avatar id={mine ? user?.avatar : partner?.avatar} name={item.author_name} size={22} />
            <Text style={[text.caption, { flexShrink: 1 }]} numberOfLines={1}>
              {mine ? 'You' : partnerName ?? item.author_name} · {relativeTime(item.created_at)}
            </Text>
          </View>
          <View style={styles.noteTools}>
            <Pressable onPress={() => togglePin(item)} hitSlop={8}>
              <Pin
                size={15}
                color={item.pinned ? colors.accent : colors.inkFaint}
                fill={item.pinned ? colors.accent : 'none'}
                strokeWidth={1.75}
              />
            </Pressable>
            {mine && (
              <Pressable onPress={() => removeNote(item)} hitSlop={8}>
                <Trash2 size={15} color={colors.inkFaint} strokeWidth={1.75} />
              </Pressable>
            )}
            {mine ? (
              lovedByPartner ? (
                <Text style={[text.caption, { color: colors.surfaceSealed, fontWeight: '600' }]}>♥ Loved</Text>
              ) : null
            ) : (
              <Pressable onPress={() => toggleNoteHeart(item)} hitSlop={8} style={styles.heartButton}>
                <Text style={[styles.heartGlyph, item.hearted_by_me && { color: colors.surfaceSealed }]}>
                  {item.hearted_by_me ? '♥' : '♡'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </Card>
    );
  };

  const renderEntry = ({ item }: { item: Entry }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.dayHeader}>
          <Text style={styles.dayHeaderText}>{formatDay(item.day)}</Text>
          <View style={styles.dayRule} />
        </View>
      );
    }
    if (item.type === 'note') return <View>{renderNoteCard(item.note, false)}</View>;
    return (
      <MemoryCard
        memory={item.memory}
        mine={item.memory.author_id === user?.id}
        myId={user?.id ?? ''}
        partnerName={partnerName}
        threadOpen={openThreads.has(item.memory.id)}
        onToggleThread={() => toggleThread(item.memory.id)}
        onCountChange={(n) => syncCount(item.memory.id, n)}
        onOpen={() => openMemory(item.memory)}
        onHeart={() => toggleMemoryHeart(item.memory)}
      />
    );
  };

  const listHeader = (
    <>
      <ComposerTrigger
        name={user?.display_name}
        avatar={user?.avatar}
        onWrite={() => setComposer({ date: null })}
        onPhoto={() => setComposer({ date: null, withPhoto: true })}
      />
      {pinned.length > 0 && (
        <View style={styles.pinnedBlock}>
          <Text style={styles.blockLabel}>Kept close</Text>
          {pinned.map((n) => renderNoteCard(n))}
        </View>
      )}
    </>
  );

  const emptyState = (
    <Empty
      line={`Nothing here yet. A photo or a line to ${partner?.display_name ?? 'them'} starts it.`}
      actionTitle="Add the first"
      onAction={() => setComposer({ date: null })}
    />
  );

  /** What the calendar view shows under the month grid: the selected day. */
  const dayPanel = (
    <View style={styles.dayPanel}>
      <View style={styles.dayPanelHead}>
        <Text style={text.subtitle}>{formatDay(selectedDay)}</Text>
        <Pressable onPress={() => setComposer({ date: selectedDay })} hitSlop={8}>
          <Text style={styles.dayPanelAdd}>+ Add to this day</Text>
        </Pressable>
      </View>
      {dayEntries.length === 0 ? (
        <Card>
          <Text style={[text.caption, { textAlign: 'center' }]}>
            Nothing kept from this day.
          </Text>
        </Card>
      ) : (
        dayEntries.map((e) => <View key={e.key}>{renderEntry({ item: e })}</View>)
      )}
    </View>
  );

  const onDeleted = (id: string) => {
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    setViewer(null);
  };

  const overlays = (
    <>
      <MomentComposer
        open={composer}
        onClose={() => setComposer(null)}
        onCreated={onMomentCreated}
        authorName={user?.display_name ?? ''}
      />
      <RevealViewer
        memory={viewer}
        myId={user?.id ?? ''}
        partnerName={partnerName}
        onClose={() => setViewer(null)}
        onDeleted={onDeleted}
      />
      <Sheet visible={!!reveal} onClose={() => setReveal(null)} title="From a while ago" sealed>
        {reveal && (
          <>
            <Text style={styles.revealSeal}>✦ ✦</Text>
            <Text style={[text.bodySerif, { fontSize: 18, lineHeight: 28, color: colors.onSealed, textAlign: 'center' }]}>
              {reveal.body}
            </Text>
            <Text style={[text.caption, { color: 'rgba(249, 239, 220, 0.65)', textAlign: 'center', marginTop: sp.lg }]}>
              {partnerName ?? reveal.author_name} sealed this on {formatDay(reveal.created_at)}
            </Text>
          </>
        )}
      </Sheet>
    </>
  );

  if (wide) {
    return (
      <Screen>
        <View style={styles.wideRow}>
          <ScrollView style={styles.wideLeft} contentContainerStyle={{ padding: sp.xl }}>
            <Text style={[text.title, { marginBottom: sp.md }]}>Timeline</Text>
            <TimelineCalendar days={daysWithSomething} selected={selectedDay} onPickDate={setSelectedDay} />
            {dayPanel}
          </ScrollView>
          <View style={styles.wideRight}>
            <FlatList
              data={feed}
              keyExtractor={(e) => e.key}
              contentContainerStyle={styles.wideList}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={emptyState}
              renderItem={renderEntry}
              keyboardShouldPersistTaps="handled"
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
          <TimelineCalendar days={daysWithSomething} selected={selectedDay} onPickDate={setSelectedDay} />
          {dayPanel}
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={90}
        >
          <FlatList
            data={feed}
            keyExtractor={(e) => e.key}
            contentContainerStyle={styles.list}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyState}
            renderItem={renderEntry}
            keyboardShouldPersistTaps="handled"
          />
        </KeyboardAvoidingView>
      )}
      {overlays}
    </Screen>
  );
}

/**
 * The slim row at the top of the feed. Deliberately NOT a live input: it is a
 * one-tap doorway into the real composer, the same shape LinkedIn uses. That
 * keeps the composer defined once (no duplicated seal/emoji/photo logic) and
 * gives the feed its vertical space back.
 */
function ComposerTrigger({
  name,
  avatar,
  onWrite,
  onPhoto,
}: {
  name?: string;
  avatar?: string | null;
  onWrite: () => void;
  onPhoto: () => void;
}) {
  return (
    <View style={styles.triggerBlock}>
      <Card style={styles.triggerCard}>
        <Avatar id={avatar} name={name ?? ''} size={34} />
        <Pressable onPress={onWrite} style={styles.triggerField} hitSlop={6}>
          <Text style={styles.triggerText} numberOfLines={1}>
            Share a moment...
          </Text>
        </Pressable>
        <Pressable onPress={onPhoto} style={styles.triggerPhoto} hitSlop={6}>
          <ImagePlus size={19} color={colors.accent} strokeWidth={1.75} />
        </Pressable>
      </Card>
    </View>
  );
}

/**
 * The one composer: words, a photo, or both. Which table it lands in is
 * decided by momentTarget() and never surfaced to the writer.
 *
 * Tools, left to right: photo, a fresh spark (placeholder only, never inserted
 * text), the emoji palette, and the time-capsule seal.
 */
function MomentComposer({
  open,
  onClose,
  onCreated,
  authorName,
}: {
  open: { date: string | null; withPhoto?: boolean } | null;
  onClose: () => void;
  onCreated: (created: { type: 'memory'; memory: Memory } | { type: 'note'; note: Note }) => void;
  authorName: string;
}) {
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealDate, setSealDate] = useState('');
  const [sparkIndex, setSparkIndex] = useState(new Date().getDate() % SPARKS.length);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  // Guards the "open the picker immediately" shortcut so it fires once per
  // opening, not on every re-render while the sheet is up.
  const autoPickedFor = useRef<string | null>(null);

  const date = open?.date ?? null;
  const visible = !!open;

  const reset = useCallback(() => {
    setDraft('');
    setPhoto(null);
    setThumb(null);
    setEmojiOpen(false);
    setSealOpen(false);
    setSealDate('');
    setError(null);
    setBusy(false);
  }, []);

  const pickPhoto = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (!visible) {
      autoPickedFor.current = null;
      reset();
      return;
    }
    const token = `${open?.date ?? 'today'}:${open?.withPhoto ? 'photo' : 'write'}`;
    if (open?.withPhoto && autoPickedFor.current !== token) {
      autoPickedFor.current = token;
      pickPhoto();
    }
  }, [visible, open?.date, open?.withPhoto, pickPhoto, reset]);

  const body = draft.trim();
  const canSend = (body.length > 0 || !!photo) && !busy;

  const send = async () => {
    if (!canSend) return;
    const sealed = sealOpen && sealDate.trim() ? sealDate.trim() : undefined;
    if (sealed && !/^\d{4}-\d{2}-\d{2}$/.test(sealed)) {
      setError('Seal date should look like 2027-02-14 (YYYY-MM-DD)');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const target = momentTarget({ hasPhoto: !!photo, date, today: today() });
      if (target === 'note') {
        const data = await api<{ note: Note }>('/api/notes', {
          method: 'POST',
          body: { body, sealedUntil: sealed },
        });
        successHaptic();
        onCreated({
          type: 'note',
          note: { ...data.note, hearts: data.note.hearts ?? 0, hearted_by_me: data.note.hearted_by_me ?? false },
        });
      } else {
        const data = await api<{ memory: Memory }>('/api/memories', {
          method: 'POST',
          body: {
            note: body,
            photoData: photo ?? undefined,
            thumbData: thumb ?? undefined,
            memoryDate: date ?? undefined,
            sealedUntil: sealed,
          },
        });
        successHaptic();
        onCreated({ type: 'memory', memory: { ...data.memory, author_name: data.memory.author_name ?? authorName } });
      }
      reset();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setBusy(false);
    }
  };

  const backdated = !!date && date !== today();

  return (
    <Sheet visible={visible} onClose={onClose} title="Share a moment">
      {backdated && <Text style={styles.composerDate}>{formatDay(date!)}</Text>}

      {thumb && (
        <View style={styles.photoWrap}>
          <Image source={{ uri: thumb }} style={styles.photoPreview} contentFit="cover" />
          <Pressable
            onPress={() => {
              setPhoto(null);
              setThumb(null);
            }}
            style={styles.photoRemove}
            hitSlop={8}
          >
            <X size={16} color={colors.onSealed} strokeWidth={2} />
          </Pressable>
        </View>
      )}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={photo ? 'Say something about it, or leave it be...' : SPARKS[sparkIndex]}
        placeholderTextColor={colors.inkFaint}
        multiline
        autoFocus={!open?.withPhoto}
        style={[styles.composerInput, focused && styles.composerInputFocused]}
      />

      {sealOpen && (
        <View style={{ marginTop: sp.base }}>
          <TextField
            label="Seal until (YYYY-MM-DD)"
            value={sealDate}
            onChangeText={setSealDate}
            placeholder="2027-02-14"
            autoCapitalize="none"
            style={{ height: 40 }}
          />
        </View>
      )}

      <View style={styles.composerRow}>
        <View style={styles.composerTools}>
          <Pressable onPress={pickPhoto} style={[styles.composerIcon, !!photo && styles.composerIconOn]} hitSlop={4}>
            <ImagePlus size={18} color={photo ? colors.accent : colors.ink} strokeWidth={1.75} />
          </Pressable>
          <Pressable
            onPress={() => {
              tapHaptic();
              setSparkIndex((i) => (i + 1) % SPARKS.length);
            }}
            style={styles.composerIcon}
            hitSlop={4}
          >
            <Sparkles size={18} color={colors.accent} strokeWidth={1.75} />
          </Pressable>
          <Pressable
            onPress={() => setEmojiOpen((o) => !o)}
            style={[styles.composerIcon, emojiOpen && styles.composerIconOn]}
            hitSlop={4}
          >
            {emojiOpen ? (
              <KeyboardIcon size={18} color={colors.ink} strokeWidth={1.75} />
            ) : (
              <Smile size={18} color={colors.ink} strokeWidth={1.75} />
            )}
          </Pressable>
          <Pressable
            onPress={() => setSealOpen((o) => !o)}
            style={[styles.composerIcon, sealOpen && styles.composerIconOn]}
            hitSlop={4}
          >
            <Lock size={16} color={sealOpen ? colors.accent : colors.ink} strokeWidth={1.75} />
          </Pressable>
        </View>
        <AppPressable onPress={send} disabled={!canSend} style={[styles.send, !canSend && { opacity: 0.5 }]}>
          <Text style={{ color: colors.onSealed, fontSize: 18 }}>♥</Text>
        </AppPressable>
      </View>

      {emojiOpen && <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />}
      <FormError message={error} />
      <LockBadge style={{ marginTop: sp.base, alignSelf: 'center' }} />
    </Sheet>
  );
}

function MemoryCard({
  memory,
  mine,
  myId,
  partnerName,
  threadOpen,
  onToggleThread,
  onCountChange,
  onOpen,
  onHeart,
}: {
  memory: Memory;
  mine: boolean;
  myId: string;
  partnerName: string | null;
  threadOpen: boolean;
  onToggleThread: () => void;
  onCountChange: (count: number) => void;
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
          Written by {partnerName ?? memory.author_name}, {formatDay(memory.created_at)}
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
      <Pressable onPress={onOpen}>
        <Text style={styles.note}>{memory.note}</Text>
      </Pressable>
      <View style={styles.memoryFooter}>
        <Text style={text.caption}>{mine ? 'You' : partnerName ?? memory.author_name}</Text>
        <View style={styles.footerActions}>
          <Pressable onPress={onToggleThread} hitSlop={8} style={styles.commentButton}>
            <MessageCircle size={16} color={threadOpen ? colors.surfaceSealed : colors.inkMuted} strokeWidth={1.75} />
            {memory.comments > 0 && (
              <Text style={[text.caption, { fontWeight: '600' }, threadOpen && { color: colors.surfaceSealed }]}>
                {memory.comments}
              </Text>
            )}
          </Pressable>
          <Pressable onPress={onHeart} hitSlop={8} style={styles.heartButton}>
            <Text style={[styles.heartGlyph, memory.hearted_by_me && { color: colors.surfaceSealed }]}>
              {memory.hearted_by_me ? '♥' : '♡'}
            </Text>
            {memory.hearts > 0 && <Text style={[text.caption, { fontWeight: '600' }]}>{memory.hearts}</Text>}
          </Pressable>
        </View>
      </View>
      {threadOpen && <MemoryComments memoryId={memory.id} myId={myId} variant="light" onCountChange={onCountChange} />}
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

/**
 * Month grid. Days holding a memory or a note show a ♥ instead of their
 * number, and tapping one SELECTS it: the day's entries are listed below the
 * calendar rather than the tap opening a composer. Adding to a day is the
 * "+ Add to this day" action in that panel.
 */
function TimelineCalendar({
  days,
  selected,
  onPickDate,
}: {
  days: Set<string>;
  selected: string;
  onPickDate: (date: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

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
          const has = days.has(key);
          const isToday = isCurrentMonth && day === now.getDate();
          const isSelected = key === selected;
          const future = new Date(year, month, day).getTime() > now.getTime();
          return (
            <Pressable
              key={key}
              disabled={future}
              onPress={() => {
                tapHaptic();
                onPickDate(key);
              }}
              style={({ pressed }) => [
                styles.cell,
                isToday && styles.cellToday,
                isSelected && styles.cellSelected,
                pressed && { backgroundColor: colors.blushSoft },
              ]}
            >
              {has ? (
                <Text style={[styles.cellHeart, isSelected && { color: colors.onSealed }]}>♥</Text>
              ) : (
                <Text
                  style={[
                    text.caption,
                    { color: colors.ink },
                    future && { opacity: 0.3 },
                    isSelected && { color: colors.onSealed, fontWeight: '600' },
                  ]}
                >
                  {day}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={[text.caption, { textAlign: 'center', marginTop: sp.sm }]}>
        Tap a day to see what is from it. ♥ marks the days you already have.
      </Text>
    </Card>
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
  partnerName,
  onClose,
  onDeleted,
}: {
  memory: Memory | null;
  myId: string;
  partnerName: string | null;
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
      <View style={styles.viewerBackdrop}>
        {/* Tap the dark area around the content to close (cancels a pending
            confirm first). The content sits above this in the scroll view. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onBackdrop} />
        <ScrollView
          style={styles.viewerScroll}
          contentContainerStyle={styles.viewerScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.viewerBody}>
            <View style={styles.viewerBar}>
              <IconButton onPress={onClose}>
                <X size={20} color={colors.onSealed} strokeWidth={1.75} />
              </IconButton>
              <View style={{ flex: 1 }} />
              {deleting ? (
                <ActivityIndicator size="small" color={colors.onSealed} />
              ) : confirming ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Delete?</Text>
                  <SecondaryButton title="Yes, delete" destructive onPress={doDelete} style={styles.confirmButton} />
                </View>
              ) : (
                <IconButton onPress={() => setConfirming(true)}>
                  <Trash2 size={20} color={colors.onSealed} strokeWidth={1.75} />
                </IconButton>
              )}
            </View>
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
              {memory.author_id === myId ? memory.author_name : partnerName ?? memory.author_name} ·{' '}
              {formatDay(memory.memory_date)}
              {memory.sealed_until ? ` · sealed ${formatDay(memory.created_at)}` : ''}
            </Text>
            <MemoryComments memoryId={memory.id} myId={myId} />
          </View>
        </ScrollView>
      </View>
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
  // The day a group of entries belongs to. Quiet on purpose: it orients you
  // without competing with the photos and the writing.
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.md },
  dayHeaderText: { ...text.caption, color: colors.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  dayRule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  pinnedBlock: { marginBottom: sp.xl },
  blockLabel: {
    ...text.caption,
    color: colors.inkMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: sp.md,
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
  // The selected day is the one whose entries are listed below, so it reads as
  // filled rather than merely outlined like today's ring.
  cellSelected: { backgroundColor: colors.surfaceSealed, borderColor: colors.surfaceSealed },
  cellHeart: { fontSize: 15, color: colors.surfaceSealed },
  dayPanel: { marginTop: sp.xl },
  dayPanelHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: sp.md,
    gap: sp.md,
  },
  dayPanelAdd: { ...text.caption, color: colors.accent, fontWeight: '600' },
  memory: { marginBottom: sp.lg },
  note: {
    ...text.bodySerif,
    fontSize: 17,
    lineHeight: 26,
    paddingTop: sp.md,
  },
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
  memoryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: sp.sm,
  },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: sp.base },
  commentButton: { flexDirection: 'row', alignItems: 'center', gap: sp.xs },
  heartButton: { flexDirection: 'row', alignItems: 'center', gap: sp.xs },
  heartGlyph: { fontSize: 19, color: colors.inkMuted },
  photoPreview: { width: '100%', aspectRatio: 16 / 10 },
  triggerBlock: { marginBottom: sp.xl },
  triggerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.md,
  },
  triggerField: {
    flex: 1,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: sp.base,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  triggerText: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.inkFaint,
  },
  triggerPhoto: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  composerDate: {
    ...text.caption,
    color: colors.accent,
    marginBottom: sp.base,
  },
  photoWrap: {
    marginBottom: sp.base,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  photoRemove: {
    position: 'absolute',
    top: sp.sm,
    right: sp.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 18, 12, 0.6)',
  },
  composerIconOn: { backgroundColor: colors.blushSoft },
  // A real bordered field, not bare text. The old inline composer sat inside a
  // Card that supplied this padding; in the Sheet the input is on its own, and
  // without a container the text ran flush into the edge while the BROWSER's
  // focus ring drew itself tight around the glyphs, which read as a bug.
  // `outlineStyle: none` drops that ring so the gold focus border below is the
  // only focus signal, matching TextField in the kit.
  composerInput: {
    ...text.bodySerif,
    fontSize: 17,
    lineHeight: 26,
    minHeight: 104,
    maxHeight: 180,
    textAlignVertical: 'top',
    paddingHorizontal: sp.base,
    paddingTop: sp.md,
    paddingBottom: sp.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  composerInputFocused: { borderColor: colors.accent },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: sp.base,
  },
  composerTools: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  composerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteBody: {
    ...text.bodySerif,
    fontSize: 17,
    lineHeight: 26,
  },
  noteFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: sp.md,
    gap: sp.md,
  },
  noteAuthor: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, flex: 1 },
  noteTools: { flexDirection: 'row', alignItems: 'center', gap: sp.base },
  notePinned: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  pinMark: {
    position: 'absolute',
    top: sp.md,
    right: sp.md,
    color: colors.accent,
    fontSize: 14,
  },
  revealSeal: {
    fontSize: 22,
    color: colors.accent,
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: sp.lg,
  },
  // Fully opaque: the timeline (and the FAB) must never bleed through the
  // viewer, or its light text becomes unreadable over parchment content.
  viewerBackdrop: {
    flex: 1,
    backgroundColor: '#1C120C',
    alignItems: 'center',
  },
  viewerScroll: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  viewerScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: sp.xl,
    paddingVertical: sp.xl,
  },
  viewerBody: { width: '100%', alignItems: 'center' },
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
