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
import { Lock, Smile, Keyboard as KeyboardIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic } from '@/lib/haptics';
import { AppPressable, Card, Empty, ErrorState, Screen, Skeleton, TextField } from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { EmojiPicker } from '@/components/EmojiPicker';
import { LockBadge } from '@/components/LockBadge';
import { colors, radius, sp, text } from '@/theme';
import { formatDay, formatTime } from '@/lib/format';
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
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export default function LoveNotes() {
  const { user, partner } = useAuth();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealDate, setSealDate] = useState('');
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
    setNotes((prev) => sortNotes([note, ...(prev ?? []).filter((n) => n.id !== note.id)]));
  });
  useCoupleEvent('note.pinned', (updated: Note) => {
    setNotes((prev) => (prev ? sortNotes(prev.map((n) => (n.id === updated.id ? { ...n, pinned: updated.pinned } : n))) : prev));
  });
  useCoupleEvent('note.deleted', (data) => {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== data?.id) : prev));
  });
  useCoupleEvent('capsule.opened', () => load().catch(() => {}));

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
      setNotes((prev) => sortNotes([data.note, ...(prev ?? [])]));
    } catch {
      // keep the draft so nothing is lost
    } finally {
      setSending(false);
    }
  };

  const togglePin = async (note: Note) => {
    setNotes((prev) => (prev ? sortNotes(prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n))) : prev));
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { pinned: !note.pinned } });
    } catch {
      setNotes((prev) => (prev ? sortNotes(prev.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n))) : prev));
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
          <Skeleton height={110} style={{ marginBottom: sp.lg }} />
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

    return (
      <Card key={item.id} style={[styles.note, item.pinned && styles.notePinned]}>
        {item.pinned ? <Text style={styles.pinMark}>✦</Text> : null}
        {item.sealed && mine ? (
          <View style={styles.sealedTag}>
            <Lock size={12} color={colors.accent} strokeWidth={1.75} />
            <Text style={[text.micro, { color: colors.accent }]}>Sealed until {formatDay(item.sealed_until!)}</Text>
          </View>
        ) : null}
        <Text style={styles.noteBody}>{item.body}</Text>
        <View style={styles.noteFooter}>
          <View style={styles.noteActions}>
            <Pressable onPress={() => togglePin(item)} hitSlop={8}>
              <Text style={[text.caption, { color: colors.surfaceSealed, fontWeight: '600' }]}>
                {item.pinned ? 'Unpin' : 'Pin'}
              </Text>
            </Pressable>
            {mine && (
              <Pressable onPress={() => remove(item)} hitSlop={8}>
                <Text style={[text.caption, { color: colors.inkFaint }]}>Remove</Text>
              </Pressable>
            )}
          </View>
          <Text style={text.caption}>
            {formatDay(item.created_at)}, {formatTime(item.created_at)}
          </Text>
        </View>
      </Card>
    );
  };

  // Web wide: two-column masonry. Native: single stack.
  const left = wide ? notes.filter((_, i) => i % 2 === 0) : notes;
  const right = wide ? notes.filter((_, i) => i % 2 === 1) : [];

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={[styles.list, wide && { maxWidth: 900 }]}>
          {notes.length === 0 && (
            <Empty line={`No notes yet. The first one will be waiting${partner ? ` for ${partner.display_name}` : ''}.`} />
          )}
          {wide ? (
            <View style={{ flexDirection: 'row', gap: sp.lg }}>
              <View style={{ flex: 1 }}>{left.map(renderNote)}</View>
              <View style={{ flex: 1 }}>{right.map(renderNote)}</View>
            </View>
          ) : (
            left.map(renderNote)
          )}
        </ScrollView>

        <View style={styles.composerWrap}>
          {sealOpen && (
            <View style={styles.sealRow}>
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
          <View style={styles.composer}>
            <Pressable
              onPress={() => setEmojiOpen((o) => !o)}
              style={[styles.composerIcon, emojiOpen && { backgroundColor: colors.blushSoft }]}
              hitSlop={4}
            >
              {emojiOpen ? (
                <KeyboardIcon size={20} color={colors.ink} strokeWidth={1.75} />
              ) : (
                <Smile size={20} color={colors.ink} strokeWidth={1.75} />
              )}
            </Pressable>
            <Pressable
              onPress={() => setSealOpen((o) => !o)}
              style={[styles.composerIcon, sealOpen && { backgroundColor: colors.blushSoft }]}
              hitSlop={4}
            >
              <Lock size={18} color={sealOpen ? colors.accent : colors.ink} strokeWidth={1.75} />
            </Pressable>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={partner ? `Write a note for ${partner.display_name}...` : 'Write a note...'}
              placeholderTextColor={colors.inkFaint}
              multiline
              style={styles.input}
            />
            <AppPressable
              onPress={send}
              disabled={!draft.trim() || sending}
              style={[styles.send, (!draft.trim() || sending) && { opacity: 0.5 }]}
            >
              <Text style={{ color: colors.onSealed, fontSize: 18 }}>♥</Text>
            </AppPressable>
          </View>
          {emojiOpen && <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />}
          <LockBadge style={{ marginTop: sp.sm, alignSelf: 'center' }} />
        </View>
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

const styles = StyleSheet.create({
  list: {
    padding: sp.lg,
    paddingBottom: sp.xl,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
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
  },
  noteActions: { flexDirection: 'row', alignItems: 'center', gap: sp.base },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  sealRow: {
    paddingHorizontal: sp.lg,
    paddingTop: sp.md,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: sp.base,
    gap: sp.sm,
  },
  composerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: sp.base,
    paddingVertical: sp.sm,
    minHeight: 40,
    maxHeight: 120,
    ...text.body,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealSeal: {
    fontSize: 22,
    color: colors.accent,
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: sp.lg,
  },
});
