import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pencil, Send, Trash2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic } from '@/lib/haptics';
import { Avatar } from '@/components/Avatar';
import { colors, radius, sp, text } from '@/theme';

interface Comment {
  id: string;
  memory_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  hearts: number;
  hearted_by_me: boolean;
}

// The thread renders in two places: the near-black memory viewer ('dark') and
// inline under a parchment card in the timeline ('light'). Same layout, two
// ink palettes.
const DARK = {
  strong: '#F9EFDC',
  faint: 'rgba(249, 239, 220, 0.72)',
  hair: 'rgba(249, 239, 220, 0.22)',
  field: 'rgba(249, 239, 220, 0.08)',
  danger: '#E8A99B',
};
const LIGHT = {
  strong: colors.ink,
  faint: colors.inkMuted,
  hair: colors.hairline,
  field: colors.surface,
  danger: colors.danger,
};

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
 * Comment thread under a memory. Both partners read and write; the body is
 * encrypted at rest server-side. Realtime events carry only ids, so we refetch
 * when the partner comments. You can edit or delete your own comments, never
 * the other's.
 */
export function MemoryComments({
  memoryId,
  myId,
  variant = 'dark',
  onCountChange,
}: {
  memoryId: string;
  myId: string;
  variant?: 'dark' | 'light';
  onCountChange?: (count: number) => void;
}) {
  const { user, partner } = useAuth();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const pal = variant === 'light' ? LIGHT : DARK;

  const load = useCallback(async () => {
    try {
      const data = await api<{ comments: Comment[] }>(`/api/comments?memoryId=${encodeURIComponent(memoryId)}`);
      setComments(data.comments);
      onCountChange?.(data.comments.length);
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

  // The partner hearting one of these comments, live. The event carries the
  // settled count, so update in place instead of refetching the thread.
  useCoupleEvent('comment.hearted', (data) => {
    if (data?.memory_id !== memoryId || data?.by === myId) return;
    setComments((prev) =>
      prev ? prev.map((c) => (c.id === data.id ? { ...c, hearts: data.hearts ?? c.hearts } : c)) : prev
    );
  });

  // Heart your partner's comment; settle on the server's response like the
  // note and memory hearts do.
  const toggleHeart = async (c: Comment) => {
    const next = !c.hearted_by_me;
    setComments((prev) =>
      prev
        ? prev.map((x) =>
            x.id === c.id ? { ...x, hearted_by_me: next, hearts: Math.max(0, x.hearts + (next ? 1 : -1)) } : x
          )
        : prev
    );
    if (next) successHaptic();
    try {
      const settled = await api<{ id: string; hearts: number; hearted_by_me: boolean }>(`/api/comments/${c.id}`, {
        method: 'PATCH',
        body: { hearted: next },
      });
      setComments((prev) =>
        prev
          ? prev.map((x) =>
              x.id === c.id ? { ...x, hearts: settled.hearts, hearted_by_me: settled.hearted_by_me } : x
            )
          : prev
      );
    } catch {
      await load();
    }
  };

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
      setComments((prev) => {
        const next = prev ? prev.filter((c) => c.id !== id) : prev;
        if (next) onCountChange?.(next.length);
        return next;
      });
    } catch {
      setConfirmId(null);
    }
  };

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setDraft(c.body);
    setConfirmId(null);
  };

  const avatarFor = (authorId: string) => (authorId === user?.id ? user?.avatar : partner?.avatar);
  // Show the pet name for the partner's comments (partner.display_name already
  // resolves to the nickname); your own comments keep your real name.
  const nameFor = (c: Comment) =>
    c.author_id === partner?.id ? partner?.display_name ?? c.author_name : c.author_name;

  return (
    // Stop taps here from bubbling to the viewer backdrop (which would close it).
    <Pressable style={[styles.wrap, { borderTopColor: pal.hair }]} onPress={(e) => e.stopPropagation()}>
      <Text style={[styles.heading, { color: pal.faint }]}>
        {comments && comments.length > 0 ? `Comments (${comments.length})` : 'Comments'}
      </Text>

      {comments === null ? (
        <ActivityIndicator size="small" color={pal.strong} style={{ marginVertical: sp.base }} />
      ) : comments.length === 0 ? (
        <Text style={[styles.empty, { color: pal.faint }]}>Be the first to say something.</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ gap: sp.base }} keyboardShouldPersistTaps="handled">
          {comments.map((c) => {
            const mine = c.author_id === myId;
            return (
              <View key={c.id} style={styles.comment}>
                <Avatar id={avatarFor(c.author_id)} name={c.author_name} size={28} />
                <View style={{ flex: 1 }}>
                  <View style={styles.metaRow}>
                    <Text style={[styles.author, { color: pal.strong }]}>{nameFor(c)}</Text>
                    <Text style={[styles.time, { color: pal.faint }]}>
                      {relativeTime(c.created_at)}
                      {c.edited_at ? ' · edited' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.body, { color: pal.strong }]}>{c.body}</Text>
                  {!mine && (
                    <View style={styles.actions}>
                      <Pressable onPress={() => toggleHeart(c)} hitSlop={8} style={styles.actionBtn}>
                        <Text
                          style={[
                            styles.heart,
                            { color: c.hearted_by_me ? colors.surfaceSealed : pal.faint },
                            variant === 'dark' && c.hearted_by_me && { color: DARK.danger },
                          ]}
                        >
                          {c.hearted_by_me ? '♥' : '♡'}
                          {c.hearts > 0 ? ` ${c.hearts}` : ''}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  {mine && c.hearts > 0 && confirmId !== c.id && (
                    <Text style={[styles.loved, { color: pal.faint }]}>♥ Loved</Text>
                  )}
                  {mine && (
                    <View style={styles.actions}>
                      {confirmId === c.id ? (
                        <>
                          <Pressable onPress={() => remove(c.id)} hitSlop={6}>
                            <Text style={[styles.confirmDelete, { color: pal.danger }]}>Delete</Text>
                          </Pressable>
                          <Pressable onPress={() => setConfirmId(null)} hitSlop={6}>
                            <Text style={[styles.actionText, { color: pal.faint }]}>Cancel</Text>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable onPress={() => startEdit(c)} hitSlop={6} style={styles.actionBtn}>
                            <Pencil size={13} color={pal.faint} strokeWidth={1.75} />
                            <Text style={[styles.actionText, { color: pal.faint }]}>Edit</Text>
                          </Pressable>
                          <Pressable onPress={() => setConfirmId(c.id)} hitSlop={6} style={styles.actionBtn}>
                            <Trash2 size={13} color={pal.faint} strokeWidth={1.75} />
                            <Text style={[styles.actionText, { color: pal.faint }]}>Delete</Text>
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
          placeholderTextColor={pal.faint}
          multiline
          style={[styles.input, { color: pal.strong, backgroundColor: pal.field, borderColor: pal.hair }]}
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
            <Text style={[styles.actionText, { color: pal.faint }]}>Cancel</Text>
          </Pressable>
        )}
        <Pressable
          onPress={submit}
          disabled={!draft.trim() || busy}
          style={[styles.send, { borderColor: pal.hair }, (!draft.trim() || busy) && { opacity: 0.4 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={pal.strong} />
          ) : (
            <Send size={18} color={variant === 'light' ? colors.surfaceSealed : pal.strong} strokeWidth={1.75} />
          )}
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
  },
  heading: { ...text.micro, textTransform: 'none', letterSpacing: 0.4, marginBottom: sp.sm },
  empty: { ...text.caption, fontStyle: 'italic', marginVertical: sp.sm },
  list: { maxHeight: 220 },
  comment: { flexDirection: 'row', gap: sp.sm },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: sp.sm },
  author: { ...text.caption, fontWeight: '600' },
  time: { ...text.micro, textTransform: 'none', letterSpacing: 0.2 },
  body: { ...text.bodySerif, marginTop: 2 },
  actions: { flexDirection: 'row', gap: sp.base, marginTop: sp.xs },
  heart: { fontSize: 14, lineHeight: 18 },
  loved: { ...text.micro, textTransform: 'none', letterSpacing: 0.2, marginTop: sp.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: sp.xs },
  actionText: { ...text.micro, textTransform: 'none', letterSpacing: 0.2 },
  confirmDelete: { ...text.micro, textTransform: 'none', letterSpacing: 0.2, fontWeight: '600' },
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
    paddingVertical: sp.sm,
    paddingHorizontal: sp.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  cancelEdit: { paddingBottom: sp.md },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
