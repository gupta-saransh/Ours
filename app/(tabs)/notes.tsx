import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Lock, Smile, Sparkles, Keyboard as KeyboardIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { AppPressable, Card, Empty, ErrorState, Screen, Skeleton, TextField } from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { Avatar } from '@/components/Avatar';
import { EmojiPicker } from '@/components/EmojiPicker';
import { LockBadge } from '@/components/LockBadge';
import { colors, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';

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

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

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

/** Deterministic tiny tilt per note, so the wall reads as pinned paper, not a feed. */
function tiltFor(id: string): string {
  const n = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 5;
  return `${(n - 2) * 0.4}deg`;
}

export default function LoveNotes() {
  const { user, partner } = useAuth();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reveal, setReveal] = useState<Note | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Opened from the universal add button: focus the note composer.
  useComposeParam(() => inputRef.current?.focus());

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ notes: Note[] }>('/api/notes');
    setNotes(sortNotes(data.notes));
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('note.created', (note: Note) => {
    if (note?.author_id === user?.id) return;
    // Ably payloads predate hearts; default them so the card renders.
    const withHearts = { ...note, hearts: note.hearts ?? 0, hearted_by_me: note.hearted_by_me ?? false };
    setNotes((prev) => sortNotes([withHearts, ...(prev ?? []).filter((n) => n.id !== note.id)]));
  });
  useCoupleEvent('note.pinned', (updated: Note) => {
    setNotes((prev) => (prev ? sortNotes(prev.map((n) => (n.id === updated.id ? { ...n, pinned: updated.pinned } : n))) : prev));
  });
  useCoupleEvent('note.deleted', (data) => {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== data?.id) : prev));
  });
  useCoupleEvent('note.hearted', (data) => {
    if (data?.by === user?.id) return;
    setNotes((prev) => (prev ? prev.map((n) => (n.id === data?.id ? { ...n, hearts: data.hearts } : n)) : prev));
  });
  useCoupleEvent('capsule.opened', () => load().catch(() => {}));

  const onCreated = (note: Note) => {
    setNotes((prev) => sortNotes([note, ...(prev ?? [])]));
  };

  const togglePin = async (note: Note) => {
    setNotes((prev) => (prev ? sortNotes(prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n))) : prev));
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { pinned: !note.pinned } });
    } catch {
      setNotes((prev) => (prev ? sortNotes(prev.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n))) : prev));
    }
  };

  const toggleHeart = async (note: Note) => {
    const next = !note.hearted_by_me;
    if (next) successHaptic();
    const apply = (list: Note[] | null, hearted: boolean, hearts: number) =>
      list ? list.map((n) => (n.id === note.id ? { ...n, hearted_by_me: hearted, hearts } : n)) : list;
    setNotes((prev) => apply(prev, next, Math.max(0, note.hearts + (next ? 1 : -1))));
    try {
      // Settle on the server's counts so the UI never drifts (same rule as
      // memory hearts).
      const saved = await api<{ hearts: number; hearted_by_me: boolean }>(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: { hearted: next },
      });
      setNotes((prev) => apply(prev, saved.hearted_by_me, saved.hearts));
    } catch {
      setNotes((prev) => apply(prev, note.hearted_by_me, note.hearts));
    }
  };

  const remove = async (note: Note) => {
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

  if (failed && !notes) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!notes) {
    return (
      <Screen>
        <View style={styles.list}>
          <Skeleton height={140} style={{ marginBottom: sp.lg }} />
          <Skeleton height={110} style={{ marginBottom: sp.lg }} />
          <Skeleton height={110} />
        </View>
      </Screen>
    );
  }

  const renderNote = (item: Note) => {
    const mine = item.author_id === user?.id;

    if (item.sealed && !mine) {
      return (
        <Card key={item.id} sealed style={styles.note}>
          <Text style={styles.sealMark}>✦</Text>
          <Text style={[text.subtitle, { color: colors.onSealed, textAlign: 'center' }]}>
            Sealed until {formatDay(item.sealed_until!)}
          </Text>
          <Text style={[text.caption, { color: colors.onSealed, textAlign: 'center', marginTop: sp.xs }]}>
            Written by {item.author_name}, {formatDay(item.created_at)}
          </Text>
        </Card>
      );
    }

    const readyToOpen = !!item.sealed_until && !item.sealed && !item.opened && !mine;
    if (readyToOpen) {
      return (
        <AppPressable key={item.id} onPress={() => openCapsule(item)}>
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
        key={item.id}
        style={[
          styles.note,
          item.pinned ? styles.notePinned : { transform: [{ rotate: tiltFor(item.id) }] },
        ]}
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
            <Avatar
              id={mine ? user?.avatar : partner?.avatar}
              name={item.author_name}
              size={22}
            />
            <Text style={text.caption}>
              {mine ? 'You' : item.author_name} · {relativeTime(item.created_at)}
            </Text>
          </View>
          {mine ? (
            lovedByPartner ? (
              <Text style={[text.caption, { color: colors.surfaceSealed, fontWeight: '600' }]}>
                ♥ {partner?.display_name ?? 'They'} loved this
              </Text>
            ) : null
          ) : (
            <Pressable onPress={() => toggleHeart(item)} hitSlop={8} style={styles.heartButton}>
              <Text style={[styles.heartGlyph, item.hearted_by_me && { color: colors.surfaceSealed }]}>
                {item.hearted_by_me ? '♥' : '♡'}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.noteActions}>
          <Pressable onPress={() => togglePin(item)} hitSlop={8}>
            <Text style={[text.micro, { color: colors.accent, textTransform: 'none', letterSpacing: 0.2 }]}>
              {item.pinned ? 'Unpin' : '✦ Keep on top'}
            </Text>
          </Pressable>
          {mine && (
            <Pressable onPress={() => remove(item)} hitSlop={8}>
              <Text style={[text.micro, { color: colors.inkFaint, textTransform: 'none', letterSpacing: 0.2 }]}>
                Remove
              </Text>
            </Pressable>
          )}
        </View>
      </Card>
    );
  };

  // Web wide: two-column masonry wall. Native: single stack.
  const left = wide ? notes.filter((_, i) => i % 2 === 0) : notes;
  const right = wide ? notes.filter((_, i) => i % 2 === 1) : [];

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={[styles.list, wide && { maxWidth: 900 }]} keyboardShouldPersistTaps="handled">
          <Composer
            inputRef={inputRef}
            partnerName={partner?.display_name ?? null}
            onCreated={onCreated}
          />

          {notes.length === 0 ? (
            <Empty line={`The wall is empty. The first note will be waiting${partner ? ` for ${partner.display_name}` : ''}.`} />
          ) : wide ? (
            <View style={{ flexDirection: 'row', gap: sp.lg }}>
              <View style={{ flex: 1 }}>{left.map(renderNote)}</View>
              <View style={{ flex: 1 }}>{right.map(renderNote)}</View>
            </View>
          ) : (
            left.map(renderNote)
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={!!reveal} onClose={() => setReveal(null)} title="From a while ago" sealed>
        {reveal && (
          <>
            <Text style={styles.revealSeal}>✦ ✦</Text>
            <Text style={[text.bodySerif, { fontSize: 18, lineHeight: 28, color: colors.onSealed, textAlign: 'center' }]}>
              {reveal.body}
            </Text>
            <Text style={[text.caption, { color: 'rgba(249, 239, 220, 0.65)', textAlign: 'center', marginTop: sp.lg }]}>
              {reveal.author_name} sealed this on {formatDay(reveal.created_at)}
            </Text>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/**
 * The writing desk at the top of the wall. Serif input with a rotating spark
 * placeholder, emoji palette, and the time-capsule seal, ending in a wax-seal
 * send disc.
 */
function Composer({
  inputRef,
  partnerName,
  onCreated,
}: {
  inputRef: React.RefObject<TextInput | null>;
  partnerName: string | null;
  onCreated: (note: Note) => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealDate, setSealDate] = useState('');
  const [sparkIndex, setSparkIndex] = useState(new Date().getDate() % SPARKS.length);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (sealOpen && sealDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(sealDate.trim())) return;
    setSending(true);
    try {
      const data = await api<{ note: Note }>('/api/notes', {
        method: 'POST',
        body: { body, sealedUntil: sealOpen && sealDate.trim() ? sealDate.trim() : undefined },
      });
      successHaptic();
      setDraft('');
      setSealDate('');
      setSealOpen(false);
      setEmojiOpen(false);
      onCreated({ ...data.note, hearts: data.note.hearts ?? 0, hearted_by_me: data.note.hearted_by_me ?? false });
    } catch {
      // keep the draft so nothing is lost
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.composerBlock}>
      <Card style={styles.composerCard}>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          placeholder={SPARKS[sparkIndex]}
          placeholderTextColor={colors.inkFaint}
          multiline
          style={styles.composerInput}
        />
        {sealOpen && (
          <TextField
            label="Seal until (YYYY-MM-DD)"
            value={sealDate}
            onChangeText={setSealDate}
            placeholder="2027-02-14"
            autoCapitalize="none"
            style={{ height: 40 }}
          />
        )}
        <View style={styles.composerRow}>
          <View style={styles.composerTools}>
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
              style={[styles.composerIcon, emojiOpen && { backgroundColor: colors.blushSoft }]}
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
              style={[styles.composerIcon, sealOpen && { backgroundColor: colors.blushSoft }]}
              hitSlop={4}
            >
              <Lock size={16} color={sealOpen ? colors.accent : colors.ink} strokeWidth={1.75} />
            </Pressable>
          </View>
          <AppPressable
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.send, (!draft.trim() || sending) && { opacity: 0.5 }]}
          >
            <Text style={{ color: colors.onSealed, fontSize: 18 }}>♥</Text>
          </AppPressable>
        </View>
        {emojiOpen && <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />}
      </Card>
      <Text style={[text.caption, { textAlign: 'center', marginTop: sp.sm }]}>
        {partnerName ? `It will be waiting on ${partnerName}'s wall.` : 'It will be waiting on your shared wall.'}
      </Text>
      <LockBadge style={{ marginTop: sp.xs, alignSelf: 'center' }} />
    </View>
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
  composerBlock: { marginBottom: sp.xl },
  composerCard: { paddingBottom: sp.md },
  composerInput: {
    ...text.bodySerif,
    fontSize: 17,
    lineHeight: 26,
    minHeight: 64,
    maxHeight: 160,
    textAlignVertical: 'top',
    paddingTop: 0,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: sp.md,
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
  note: { marginBottom: sp.lg },
  notePinned: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  pinMark: {
    position: 'absolute',
    top: sp.md,
    right: sp.md,
    color: colors.accent,
    fontSize: 14,
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
  heartButton: { paddingHorizontal: sp.xs },
  heartGlyph: { fontSize: 19, color: colors.inkMuted },
  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: sp.base,
    marginTop: sp.sm,
  },
  revealSeal: {
    fontSize: 22,
    color: colors.accent,
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: sp.lg,
  },
});
