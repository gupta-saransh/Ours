import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ChevronLeft, ImagePlus, ImageDown, Send, X } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { successHaptic } from '@/lib/haptics';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';
import { formatTime } from '@/lib/format';

interface Message {
  id: string;
  sender_id: string;
  body: string;
  image_thumb?: string | null;
  has_image?: boolean;
  created_at: string;
  pending?: boolean;
}

export default function Chat() {
  const { status, user, partner } = useAuth();
  const router = useRouter();
  const toast = useToast();
  // `msgs` is newest-first to feed an inverted list (newest at the bottom).
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [partnerSeen, setPartnerSeen] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ id: string; thumb: string | null } | null>(null);

  const markSeen = useCallback(() => {
    api('/api/messages/seen', { method: 'POST' }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const data = await api<{ messages: Message[]; hasMore: boolean; partnerSeenAt: string | null }>('/api/messages');
    setMsgs(data.messages.slice().reverse());
    setHasMore(data.hasMore);
    setPartnerSeen(data.partnerSeenAt);
    setLoaded(true);
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    if (status === 'signedIn' && partner) load().catch(() => setLoaded(true));
  }, [status, partner, load]);

  // Live delivery. Ignore our own echo (we add ours optimistically) and dedupe
  // by id defensively.
  useCoupleEvent('message.created', (m: Message) => {
    if (!m?.id || m.sender_id === user?.id) return;
    setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
    markSeen();
  });
  // The partner opened the thread: light up our "Seen" receipt.
  useCoupleEvent('chat.seen', (d: { by?: string; at?: string }) => {
    if (d?.by && d.by === partner?.id && d.at) setPartnerSeen(d.at);
  });

  const loadMore = async () => {
    if (loadingMore || !hasMore || msgs.length === 0) return;
    setLoadingMore(true);
    const oldest = msgs[msgs.length - 1].created_at;
    try {
      const data = await api<{ messages: Message[]; hasMore: boolean }>(
        `/api/messages?before=${encodeURIComponent(oldest)}`
      );
      setMsgs((prev) => [...prev, ...data.messages.slice().reverse()]);
      setHasMore(data.hasMore);
    } catch {
      // leave the list as-is
    } finally {
      setLoadingMore(false);
    }
  };

  const sendMessage = async (opts: { body?: string; imageData?: string; imageThumb?: string }) => {
    const bodyText = (opts.body ?? '').trim();
    if (!bodyText && !opts.imageData) return;
    setInput('');
    const temp: Message = {
      id: `temp-${Date.now()}`,
      sender_id: user!.id,
      body: bodyText,
      image_thumb: opts.imageThumb ?? null,
      has_image: !!opts.imageData,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMsgs((prev) => [temp, ...prev]);
    try {
      const { message } = await api<{ message: Message }>('/api/messages', {
        method: 'POST',
        body: { body: bodyText || undefined, imageData: opts.imageData, imageThumb: opts.imageThumb },
      });
      successHaptic();
      setMsgs((prev) => prev.map((x) => (x.id === temp.id ? message : x)));
    } catch {
      setMsgs((prev) => prev.filter((x) => x.id !== temp.id));
      if (bodyText) setInput(bodyText);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      const [full, small] = await Promise.all([
        ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1200 } }], {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }),
        ImageManipulator.manipulateAsync(uri, [{ resize: { width: 640 } }], {
          compress: 0.6,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }),
      ]);
      sendMessage({
        body: input,
        imageData: `data:image/jpeg;base64,${full.base64}`,
        imageThumb: `data:image/jpeg;base64,${small.base64}`,
      });
    } catch {
      toast.show('Could not read that photo, try another one.');
    }
  };

  const addToTimeline = async (m: Message) => {
    if (m.pending || m.id.startsWith('temp-') || addedIds.has(m.id)) return;
    setAddedIds((s) => new Set(s).add(m.id));
    try {
      await api(`/api/messages/${m.id}`, { method: 'POST', body: { action: 'to-timeline' } });
      successHaptic();
      toast.show('Saved to your timeline ♥');
    } catch {
      setAddedIds((s) => {
        const next = new Set(s);
        next.delete(m.id);
        return next;
      });
      toast.show('Could not save it. Try again.');
    }
  };

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

  // The newest of my messages that the partner has seen gets a "Seen" receipt.
  const newestMine = msgs.find((m) => m.sender_id === user?.id && !m.pending);
  const seenReceiptId =
    newestMine && partnerSeen && new Date(partnerSeen) >= new Date(newestMine.created_at) ? newestMine.id : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={24} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        {partner ? (
          <View style={styles.headerWho}>
            <Avatar id={partner.avatar} name={partner.display_name} size={30} />
            <Text style={text.subtitle}>{partner.display_name}</Text>
          </View>
        ) : (
          <Text style={text.subtitle}>Chat</Text>
        )}
        <View style={styles.back} />
      </View>

      {!partner ? (
        <Empty line="Pair with your person to start chatting." />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            data={msgs}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              loaded ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyLine}>Say the first thing. A hello, a heart, a photo, anything.</Text>
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === user?.id;
              const prev = msgs[index + 1];
              const grouped = prev && prev.sender_id === item.sender_id;
              return (
                <Bubble
                  message={item}
                  mine={mine}
                  grouped={!!grouped}
                  seen={item.id === seenReceiptId}
                  added={addedIds.has(item.id)}
                  onOpenImage={() => item.image_thumb && setViewer({ id: item.id, thumb: item.image_thumb })}
                  onAddToTimeline={() => addToTimeline(item)}
                />
              );
            }}
          />
          <View style={styles.composer}>
            <Pressable onPress={pickImage} hitSlop={8} style={styles.imageBtn}>
              <ImagePlus size={22} color={colors.accent} strokeWidth={1.75} />
            </Pressable>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Message"
              placeholderTextColor={colors.inkFaint}
              style={styles.input}
              multiline
              onSubmitEditing={() => sendMessage({ body: input })}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => sendMessage({ body: input })}
              disabled={!input.trim()}
              style={[styles.sendBtn, !input.trim() && { opacity: 0.4 }]}
            >
              <Send size={18} color={colors.onSealed} strokeWidth={2} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      <ImageViewer viewer={viewer} onClose={() => setViewer(null)} />
    </SafeAreaView>
  );
}

function Bubble({
  message,
  mine,
  grouped,
  seen,
  added,
  onOpenImage,
  onAddToTimeline,
}: {
  message: Message;
  mine: boolean;
  grouped: boolean;
  seen: boolean;
  added: boolean;
  onOpenImage: () => void;
  onAddToTimeline: () => void;
}) {
  const hasImage = !!message.image_thumb;
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, { marginTop: grouped ? 2 : sp.md }]}>
      <View style={{ maxWidth: '80%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, hasImage && styles.bubbleWithImage]}>
          {hasImage && (
            <Pressable onPress={onOpenImage}>
              <Image source={{ uri: message.image_thumb! }} style={styles.bubbleImage} contentFit="cover" transition={120} />
            </Pressable>
          )}
          {message.body ? (
            <Text style={[styles.bubbleText, hasImage && { marginTop: sp.sm }, mine && { color: colors.onSealed }]}>
              {message.body}
            </Text>
          ) : null}
          <Text style={[styles.time, mine ? { color: colors.onSealed } : { color: colors.inkFaint }]}>
            {message.pending ? 'Sending…' : formatTime(message.created_at)}
          </Text>
        </View>
        {hasImage && !message.pending && (
          <Pressable onPress={onAddToTimeline} hitSlop={6} style={styles.addRow} disabled={added}>
            <ImageDown size={13} color={added ? colors.positive : colors.inkMuted} strokeWidth={1.75} />
            <Text style={[styles.addText, added && { color: colors.positive }]}>
              {added ? 'In your timeline' : 'Add to timeline'}
            </Text>
          </Pressable>
        )}
        {seen && <Text style={styles.seen}>Seen</Text>}
      </View>
    </View>
  );
}

/** Full-screen image viewer: fetches the full-resolution image for real messages. */
function ImageViewer({ viewer, onClose }: { viewer: { id: string; thumb: string | null } | null; onClose: () => void }) {
  const [full, setFull] = useState<string | null>(null);

  useEffect(() => {
    setFull(null);
    if (!viewer || viewer.id.startsWith('temp-')) return;
    api<{ image_data: string | null }>(`/api/messages/${viewer.id}`)
      .then((d) => setFull(d.image_data))
      .catch(() => {});
  }, [viewer?.id]);

  if (!viewer) return null;
  const uri = full ?? viewer.thumb;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.viewerClose}>
          <X size={24} color={colors.onSealed} strokeWidth={1.75} />
        </Pressable>
        {uri ? (
          <Image source={{ uri }} style={styles.viewerImage} contentFit="contain" transition={150} />
        ) : (
          <ActivityIndicator size="small" color={colors.onSealed} />
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.base,
    paddingBottom: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerWho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
  },
  list: {
    padding: sp.base,
    paddingBottom: sp.lg,
    flexGrow: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  emptyWrap: {
    flex: 1,
    transform: [{ scaleY: -1 }],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: sp.huge,
  },
  emptyLine: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.inkMuted,
    textAlign: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  rowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    paddingVertical: sp.sm,
    paddingHorizontal: sp.md,
    borderRadius: radius.md,
  },
  bubbleWithImage: {
    padding: sp.xs,
  },
  bubbleMine: {
    backgroundColor: colors.surfaceSealed,
    borderBottomRightRadius: radius.hairline,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderBottomLeftRadius: radius.hairline,
  },
  bubbleImage: {
    width: 220,
    height: 220,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  bubbleText: {
    ...text.body,
    fontFamily: font.serif,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: sp.xs,
  },
  time: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    marginTop: 3,
    marginRight: sp.xs,
    alignSelf: 'flex-end',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.xs,
    marginTop: sp.xs,
    paddingHorizontal: sp.xs,
  },
  addText: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.inkMuted,
  },
  seen: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    color: colors.inkFaint,
    marginTop: 2,
    marginRight: sp.xs,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: sp.sm,
    paddingHorizontal: sp.base,
    paddingTop: sp.sm,
    paddingBottom: sp.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  imageBtn: {
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
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: sp.md,
    paddingTop: sp.sm,
    paddingBottom: sp.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    fontSize: 15,
    color: colors.ink,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: '#1C120C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: sp.xl,
    right: sp.xl,
    zIndex: 2,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '92%',
    height: '80%',
  },
});
