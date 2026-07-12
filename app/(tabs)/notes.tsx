import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { Card, EmptyState } from '@/components/ui';
import { EmojiPicker } from '@/components/EmojiPicker';
import { colors, font, radius, space, type } from '@/theme';
import { formatDay, formatTime } from '@/lib/format';

interface Note {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  pinned: boolean;
  created_at: string;
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export default function LoveNotes() {
  const { user, partner } = useAuth();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ notes: Note[] }>('/api/notes');
    setNotes(sortNotes(data.notes));
  }, []);

  useEffect(() => {
    load().catch(() => setNotes([]));
  }, [load]);

  // The wall is live: partner's notes and pins land without a refresh.
  useCoupleEvent('note.created', (note: Note) => {
    if (note?.author_id === user?.id) return;
    setNotes((prev) => sortNotes([note, ...(prev ?? []).filter((n) => n.id !== note.id)]));
  });
  useCoupleEvent('note.pinned', (updated: Note) => {
    setNotes((prev) =>
      prev ? sortNotes(prev.map((n) => (n.id === updated.id ? { ...n, pinned: updated.pinned } : n))) : prev
    );
  });
  useCoupleEvent('note.deleted', (data) => {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== data?.id) : prev));
  });

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const data = await api<{ note: Note }>('/api/notes', { method: 'POST', body: { body } });
      setDraft('');
      setNotes((prev) => sortNotes([data.note, ...(prev ?? [])]));
    } catch {
      // keep the draft so nothing is lost
    } finally {
      setSending(false);
    }
  };

  const togglePin = async (note: Note) => {
    // Optimistic — the Ably echo confirms it.
    setNotes((prev) =>
      prev ? sortNotes(prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n))) : prev
    );
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { pinned: !note.pinned } });
    } catch {
      setNotes((prev) =>
        prev ? sortNotes(prev.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n))) : prev
      );
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

  if (notes === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="No notes yet"
            line={`Leave the first one. It will be waiting${partner ? ` for ${partner.display_name}` : ''} the next time they open the app.`}
          />
        }
        renderItem={({ item }) => {
          const mine = item.author_id === user?.id;
          return (
            <Card style={[styles.note, item.pinned && styles.notePinned]}>
              {item.pinned ? <Text style={styles.pinMark}>✦ pinned</Text> : null}
              <Text style={styles.noteBody}>{item.body}</Text>
              <View style={styles.noteFooter}>
                <Text style={styles.meta}>
                  {mine ? 'You' : item.author_name} · {formatDay(item.created_at)}, {formatTime(item.created_at)}
                </Text>
                <View style={styles.noteActions}>
                  <Pressable onPress={() => togglePin(item)} hitSlop={8}>
                    <Text style={styles.action}>{item.pinned ? 'Unpin' : 'Pin'}</Text>
                  </Pressable>
                  {mine && (
                    <Pressable onPress={() => remove(item)} hitSlop={8} style={{ marginLeft: space(4) }}>
                      <Text style={[styles.action, { color: colors.inkSoft }]}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </Card>
          );
        }}
      />
      <View style={styles.composer}>
        <Pressable
          onPress={() => setEmojiOpen((o) => !o)}
          style={({ pressed }) => [styles.emojiToggle, (pressed || emojiOpen) && { backgroundColor: colors.blushSoft }]}
          hitSlop={4}
        >
          <Text style={{ fontSize: 22 }}>{emojiOpen ? '⌨' : '😊'}</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={partner ? `Leave a note for ${partner.display_name}…` : 'Leave a note for them…'}
          placeholderTextColor={colors.inkSoft}
          multiline
          style={styles.input}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={({ pressed }) => [
            styles.send,
            (!draft.trim() || sending) && { opacity: 0.5 },
            pressed && { backgroundColor: colors.rosePressed },
          ]}
        >
          <Text style={styles.sendText}>♥</Text>
        </Pressable>
      </View>
      {emojiOpen && <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  list: {
    padding: space(5),
    paddingBottom: space(6),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  note: { marginBottom: space(3.5) },
  notePinned: { backgroundColor: colors.blushSoft, borderColor: colors.blush },
  pinMark: {
    color: colors.rose,
    fontSize: type.tiny,
    letterSpacing: 0.6,
    marginBottom: space(2),
    textTransform: 'uppercase',
  },
  noteBody: {
    fontFamily: font.serif,
    fontSize: type.heading,
    lineHeight: 28,
    color: colors.ink,
  },
  noteFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space(3),
  },
  meta: { fontSize: type.small, color: colors.inkSoft, flexShrink: 1 },
  noteActions: { flexDirection: 'row', alignItems: 'center' },
  action: { fontSize: type.small, color: colors.rose, fontWeight: '600' },
  emojiToggle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space(2),
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: space(4),
    paddingTop: space(2.5),
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.cream,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    fontSize: type.body,
    color: colors.ink,
    maxHeight: 120,
  },
  send: {
    marginLeft: space(3),
    backgroundColor: colors.rose,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: colors.onRose, fontSize: 20 },
});
