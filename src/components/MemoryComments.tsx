import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pencil, Send, Trash2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic } from '@/lib/haptics';
import { colors, radius, sp, text } from '@/theme';

interface Comment {
  id: string;
  memory_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

// Light palette for the dark memory viewer. Kept bright: the backdrop behind
// this thread is near-black, anything under ~0.7 alpha gets hard to read.
const CREAM = '#F9EFDC';
const FAINT = 'rgba(249, 239, 220, 0.72)';
const HAIR = 'rgba(249, 239, 220, 0.22)';
const FIELD = 'rgba(249, 239, 220, 0.08)';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Comment thread under a memory in its detail viewer. Both partners read and
 * write; the body is encrypted at rest server-side. Realtime events carry only
 * ids, so we refetch when the partner comments. You can edit or delete your own
 * comments, never the other's.
 */
export function MemoryComments({ memoryId, myId }: { memoryId: string; myId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ comments: Comment[] }>(`/api/comments?memoryId=${encodeURIComponent(memoryId)}`);
      setComments(data.comments);
    } catch {
      setComments((prev) => prev ?? []);
    }
  }, [memoryId]);

  useEffect(() => {
    setComments(null);
    setDraft('');
    setEditingId(null);
    setConfirmId(null);
    load();
  }, [memoryId, load]);

  useCoupleEvent('memory.commented', (data) => {
    if (data?.memory_id === memoryId) load().catch(() => {});
  });

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (editingId) {
        await api(`/api/comments/${editingId}`, { method: 'PATCH', body: { body } });
      } else {
        await api('/api/comments', { method: 'POST', body: { memoryId, body } });
      }
      setDraft('');
      setEditingId(null);
      successHaptic();
      await load();
    } catch {
      // leave the draft in place so nothing is lost
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/comments/${id}`, { method: 'DELETE' });
      setConfirmId(null);
      setComments((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
    } catch {
      setConfirmId(null);
    }
  };

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setDraft(c.body);
    setConfirmId(null);
  };

  return (
    // Stop taps here from bubbling to the viewer backdrop (which would close it).
    <Pressable style={styles.wrap} onPress={(e) => e.stopPropagation()}>
      <Text style={styles.heading}>
        {comments && comments.length > 0 ? `Comments (${comments.length})` : 'Comments'}
      </Text>

      {comments === null ? (
        <ActivityIndicator size="small" color={CREAM} style={{ marginVertical: sp.base }} />
      ) : comments.length === 0 ? (
        <Text style={styles.empty}>Be the first to say something.</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ gap: sp.base }} keyboardShouldPersistTaps="handled">
          {comments.map((c) => {
            const mine = c.author_id === myId;
            return (
              <View key={c.id} style={styles.comment}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(c.author_name || '?').slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.metaRow}>
                    <Text style={styles.author}>{c.author_name}</Text>
                    <Text style={styles.time}>
                      {relativeTime(c.created_at)}
                      {c.edited_at ? ' · edited' : ''}
                    </Text>
                  </View>
                  <Text style={styles.body}>{c.body}</Text>
                  {mine && (
                    <View style={styles.actions}>
                      {confirmId === c.id ? (
                        <>
                          <Pressable onPress={() => remove(c.id)} hitSlop={6}>
                            <Text style={styles.confirmDelete}>Delete</Text>
                          </Pressable>
                          <Pressable onPress={() => setConfirmId(null)} hitSlop={6}>
                            <Text style={styles.actionText}>Cancel</Text>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable onPress={() => startEdit(c)} hitSlop={6} style={styles.actionBtn}>
                            <Pencil size={13} color={FAINT} strokeWidth={1.75} />
                            <Text style={styles.actionText}>Edit</Text>
                          </Pressable>
                          <Pressable onPress={() => setConfirmId(c.id)} hitSlop={6} style={styles.actionBtn}>
                            <Trash2 size={13} color={FAINT} strokeWidth={1.75} />
                            <Text style={styles.actionText}>Delete</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={editingId ? 'Edit your comment...' : 'Add a comment...'}
          placeholderTextColor={FAINT}
          multiline
          style={styles.input}
        />
        {editingId && (
          <Pressable
            onPress={() => {
              setEditingId(null);
              setDraft('');
            }}
            hitSlop={6}
            style={styles.cancelEdit}
          >
            <Text style={styles.actionText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable onPress={submit} disabled={!draft.trim() || busy} style={[styles.send, (!draft.trim() || busy) && { opacity: 0.4 }]}>
          {busy ? <ActivityIndicator size="small" color={CREAM} /> : <Send size={18} color={CREAM} strokeWidth={1.75} />}
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginTop: sp.lg,
    paddingTop: sp.base,
    borderTopWidth: 1,
    borderTopColor: HAIR,
  },
  heading: { ...text.micro, color: FAINT, textTransform: 'none', letterSpacing: 0.4, marginBottom: sp.sm },
  empty: { ...text.caption, color: FAINT, fontStyle: 'italic', marginVertical: sp.sm },
  list: { maxHeight: 220 },
  comment: { flexDirection: 'row', gap: sp.sm },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...text.caption, color: CREAM, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: sp.sm },
  author: { ...text.caption, color: CREAM, fontWeight: '600' },
  time: { ...text.micro, color: FAINT, textTransform: 'none', letterSpacing: 0.2 },
  body: { ...text.bodySerif, color: CREAM, marginTop: 2 },
  actions: { flexDirection: 'row', gap: sp.base, marginTop: sp.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: sp.xs },
  actionText: { ...text.micro, color: FAINT, textTransform: 'none', letterSpacing: 0.2 },
  confirmDelete: { ...text.micro, color: '#E8A99B', textTransform: 'none', letterSpacing: 0.2, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: sp.sm,
    marginTop: sp.base,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    ...text.body,
    color: CREAM,
    backgroundColor: FIELD,
    paddingVertical: sp.sm,
    paddingHorizontal: sp.md,
    borderWidth: 1,
    borderColor: HAIR,
    borderRadius: radius.md,
  },
  cancelEdit: { paddingBottom: sp.md },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HAIR,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
