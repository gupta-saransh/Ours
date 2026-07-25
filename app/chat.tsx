import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { ChevronLeft, ImagePlus, ImageDown, Mic, Pause, Play, Plus, Reply, Send, Trash2, X } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChatPresence, useCoupleEvent } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { Avatar } from '@/components/Avatar';
import { Empty, PrimaryButton, SecondaryButton } from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { ReactionPicker } from '@/components/ReactionPicker';
import { applyReaction, groupReactions, nextReactionAction, QUICK_REACTIONS, type ReactionRow } from '@/lib/chatReactions';
import { BUBBLE_TEXT_WRAP, bubbleImageSize, bubbleMaxWidth, bubbleQuoteWidth, bubbleVoiceWidth } from '@/lib/bubbleLayout';
import { colors, font, radius, sp, text } from '@/theme';
import { formatChatDay, formatTime, sameLocalDay } from '@/lib/format';
import { formatClipDuration } from '@/lib/audioWaveform';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';

interface Message {
  id: string;
  sender_id: string;
  body: string;
  image_thumb?: string | null;
  has_image?: boolean;
  has_audio?: boolean;
  audio_mime?: string | null;
  audio_duration_ms?: number | null;
  audio_waveform?: number[] | null;
  reply_to_id?: string | null;
  reactions?: ReactionRow[];
  created_at: string;
  pending?: boolean;
}

/** How far a bubble must be dragged right before releasing it triggers a reply. */
const SWIPE_TRIGGER = 44;
const SWIPE_MAX = 64;

/** The thread's centred content column (the list, reply bar, and composer all share it). */
const LIST_MAX_WIDTH = 680;

// Bubbles now open on a plain tap rather than a long-press, but a slightly
// dragged tap or a double-tap can still read as a text-selection gesture on
// iOS/Android Safari & Chrome, triggering the browser's own text-selection UI
// (blue highlight + a native Copy/Look Up/Translate callout) on top of
// everything. That native callout was the original "screen turns blue" bug.
// -webkit-touch-callout suppresses the callout itself; userSelect suppresses
// the highlight. Native (iOS/Android app, not a browser) ignores these.
const noSelect =
  Platform.OS === 'web'
    ? ({ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as any)
    : null;

// Matches http(s) links and bare www. ones; trailing punctuation is not part
// of the link ("check https://a.co/x!" should not include the bang).
const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;

function trimUrl(raw: string): { url: string; trailing: string } {
  const m = raw.match(/[.,;:!?)\]]+$/);
  const trailing = m ? m[0] : '';
  return { url: raw.slice(0, raw.length - trailing.length), trailing };
}

/**
 * Message text with URLs rendered as tappable links. Long tokens still wrap
 * (see bubbleText's web word-break), so a pasted URL flows onto new lines
 * instead of pushing the bubble off screen.
 */
function LinkedText({ body, style, linkColor }: { body: string; style: any; linkColor: string }) {
  const parts = body.split(URL_RE);
  if (parts.length === 1) return <Text style={style}>{body}</Text>;
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        // A fresh non-global test: .test() on a /g/ regex is stateful.
        if (!/^(?:https?:\/\/|www\.)/i.test(part)) return <Text key={i}>{part}</Text>;
        const { url, trailing } = trimUrl(part);
        const href = url.startsWith('www.') ? `https://${url}` : url;
        return (
          <Text key={i}>
            <Text
              style={{ color: linkColor, textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL(href).catch(() => {})}
              suppressHighlighting
            >
              {url}
            </Text>
            {trailing}
          </Text>
        );
      })}
    </Text>
  );
}

/** What a reply-quote or reply-bar preview shows when there is no caption text. */
function previewText(m: Pick<Message, 'body' | 'has_image' | 'has_audio'>): string {
  if (m.body) return m.body;
  if (m.has_audio) return 'Voice note';
  if (m.has_image) return 'Photo';
  return '';
}

/**
 * A recorded clip's `uri` is a local file:// (native) or blob: (web) URI;
 * the server wants base64, the same shape as a memory photo. Native reads the
 * file directly; web re-fetches the blob URL and lets FileReader do the
 * base64 encoding (it already produces a ready-to-use `data:mime;base64,...`
 * string, so no manual prefixing is needed there).
 */
async function readAsDataUri(uri: string, mime: string): Promise<string> {
  if (Platform.OS === 'web') {
    const blob = await fetch(uri).then((r) => r.blob());
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as FileSystem.EncodingType });
  return `data:${mime};base64,${base64}`;
}

export default function Chat() {
  const { status, user, partner } = useAuth();
  const router = useRouter();
  const toast = useToast();
  // ONE width budget for the whole thread. Every bubble caps at the same pixel
  // width and every photo fills exactly that width, so the column has a single
  // straight edge instead of sizing itself per message.
  const { width } = useWindowDimensions();
  const maxBubble = bubbleMaxWidth(Math.min(width, LIST_MAX_WIDTH) - sp.base * 2);
  const imageSize = bubbleImageSize(maxBubble);
  // `msgs` is newest-first to feed an inverted list (newest at the bottom).
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [partnerSeen, setPartnerSeen] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ id: string; thumb: string | null } | null>(null);
  // The message being quoted by the next send (long-press a bubble to set it).
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Long-press opens this: React / Reply / Delete for one message.
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  // React (from the menu, or tapping an existing pill someone else started) opens this.
  const [reactFor, setReactFor] = useState<Message | null>(null);
  // Tapping a quoted reply scrolls to the original and briefly highlights it.
  const listRef = useRef<FlatList<Message>>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const jumpToMessage = useCallback(
    (id: string) => {
      const idx = msgs.findIndex((m) => m.id === id);
      // Not loaded (paginated out of the window): no jump rather than a wrong one.
      if (idx < 0) return;
      listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.35, animated: true });
      setHighlightId(id);
      setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
    },
    [msgs]
  );

  // Am I actually looking at this screen right now? Combines "this route is
  // mounted" with "the tab/app is foregrounded", so backgrounding the app
  // while on /chat correctly leaves presence (and re-entering foregrounds it
  // again) instead of pinning "in chat" for as long as the screen stays
  // mounted in the background.
  const [foregrounded, setForegrounded] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVis = () => setForegrounded(document.visibilityState === 'visible');
      onVis();
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }
    const sub = AppState.addEventListener('change', (state) => setForegrounded(state === 'active'));
    return () => sub.remove();
  }, []);
  useChatPresence(foregrounded, { screen: 'chat' });

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
  // A reaction was set or cleared, by either of us (own echo just re-applies
  // the same state, which is harmless). id-only over the wire, settled here.
  useCoupleEvent('message.reacted', (d: { message_id?: string; user_id?: string; emoji?: string | null }) => {
    if (!d?.message_id || !d.user_id) return;
    setMsgs((prev) => prev.map((m) => (m.id === d.message_id ? applyReaction(m, d.user_id!, d.emoji ?? null) : m)));
  });
  useCoupleEvent('message.deleted', (d: { id?: string }) => {
    if (!d?.id) return;
    setMsgs((prev) => prev.filter((m) => m.id !== d.id));
    setActionsFor((cur) => (cur?.id === d.id ? null : cur));
    setReplyTo((cur) => (cur?.id === d.id ? null : cur));
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

  const sendMessage = async (opts: {
    body?: string;
    imageData?: string;
    imageThumb?: string;
    audio?: { data: string; mime: string; durationMs: number; waveform: number[] };
  }) => {
    const bodyText = (opts.body ?? '').trim();
    if (!bodyText && !opts.imageData && !opts.audio) return;
    const quoted = replyTo;
    setInput('');
    setReplyTo(null);
    const temp: Message = {
      id: `temp-${Date.now()}`,
      sender_id: user!.id,
      body: bodyText,
      image_thumb: opts.imageThumb ?? null,
      has_image: !!opts.imageData,
      has_audio: !!opts.audio,
      audio_mime: opts.audio?.mime ?? null,
      audio_duration_ms: opts.audio?.durationMs ?? null,
      audio_waveform: opts.audio?.waveform ?? null,
      reply_to_id: quoted?.id ?? null,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMsgs((prev) => [temp, ...prev]);
    try {
      const { message } = await api<{ message: Message }>('/api/messages', {
        method: 'POST',
        body: {
          body: bodyText || undefined,
          imageData: opts.imageData,
          imageThumb: opts.imageThumb,
          audio: opts.audio,
          replyToId: quoted && !quoted.id.startsWith('temp-') ? quoted.id : undefined,
        },
      });
      successHaptic();
      setMsgs((prev) => prev.map((x) => (x.id === temp.id ? message : x)));
    } catch {
      setMsgs((prev) => prev.filter((x) => x.id !== temp.id));
      if (bodyText) setInput(bodyText);
      if (quoted) setReplyTo(quoted);
      if (opts.audio) toast.show('Could not send that voice note. Try again.');
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

  const voice = useVoiceRecorder();
  const [sendingVoice, setSendingVoice] = useState(false);

  const startRecording = async () => {
    const started = await voice.start();
    if (!started) toast.show('Ours needs microphone access to record a voice note.');
  };

  const cancelRecording = async () => {
    await voice.cancel();
  };

  const sendRecording = async () => {
    setSendingVoice(true);
    try {
      const clip = await voice.finish();
      if (!clip) return; // too short to bother with; recorder already stopped
      const data = await readAsDataUri(clip.uri, clip.mime);
      await sendMessage({
        audio: { data, mime: clip.mime, durationMs: clip.durationMs, waveform: clip.waveform },
      });
    } catch {
      toast.show('Could not save that recording. Try again.');
    } finally {
      setSendingVoice(false);
    }
  };

  const toggleReaction = async (message: Message, emoji: string) => {
    const mine = message.reactions?.find((r) => r.user_id === user?.id)?.emoji ?? null;
    const decision = nextReactionAction(mine, emoji);
    const nextEmoji = decision.action === 'react' ? decision.emoji : null;
    setMsgs((prev) => prev.map((m) => (m.id === message.id ? applyReaction(m, user!.id, nextEmoji) : m)));
    try {
      await api(`/api/messages/${message.id}`, {
        method: 'POST',
        body: decision.action === 'react' ? { action: 'react', emoji: decision.emoji } : { action: 'unreact' },
      });
    } catch {
      // reconcile with the server rather than leave a reaction that never saved
      load().catch(() => {});
    }
  };

  const deleteMessage = async (message: Message) => {
    setActionsFor(null);
    setMsgs((prev) => prev.filter((m) => m.id !== message.id));
    try {
      await api(`/api/messages/${message.id}`, { method: 'DELETE' });
    } catch {
      toast.show('Could not delete that. Try again.');
      load().catch(() => {});
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
            ref={listRef}
            data={msgs}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            // Inverted lists can fail a jump when the target row is not measured
            // yet; nudge toward it, then land on it once it has rendered.
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => {
                if (info.index < msgs.length) {
                  listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.35, animated: true });
                }
              }, 80);
            }}
            ListEmptyComponent={
              loaded ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyLine}>Say the first thing. A hello, a heart, a photo, anything.</Text>
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === user?.id;
              const prev = msgs[index + 1]; // the OLDER neighbour (inverted list)
              const grouped = prev && prev.sender_id === item.sender_id;
              // A day divider sits at the visual top of each day's block: show it
              // above the OLDEST message of a day (the one whose older neighbour
              // is a different day, or which has none).
              const showDay = !prev || !sameLocalDay(item.created_at, prev.created_at);
              return (
                <View>
                  {showDay && (
                    <View style={styles.dayDivider}>
                      <Text style={styles.dayDividerText}>{formatChatDay(item.created_at)}</Text>
                    </View>
                  )}
                  <SwipeToReply onReply={() => setReplyTo(item)} disabled={item.pending} mine={mine}>
                    <Bubble
                      message={item}
                      mine={mine}
                      grouped={!!grouped}
                      highlighted={highlightId === item.id}
                      seen={item.id === seenReceiptId}
                      added={addedIds.has(item.id)}
                      quoted={item.reply_to_id ? msgs.find((x) => x.id === item.reply_to_id) ?? null : null}
                      quotedName={(sid) => (sid === user?.id ? 'You' : partner?.display_name ?? 'Them')}
                      reactions={groupReactions(item.reactions ?? [], user?.id)}
                      maxWidth={maxBubble}
                      imageSize={imageSize}
                      onOpenImage={() => item.image_thumb && setViewer({ id: item.id, thumb: item.image_thumb })}
                      onAddToTimeline={() => addToTimeline(item)}
                      onOpenActions={() => !item.pending && setActionsFor(item)}
                      onToggleReaction={(emoji) => toggleReaction(item, emoji)}
                      onJumpToQuote={item.reply_to_id ? () => jumpToMessage(item.reply_to_id!) : undefined}
                    />
                  </SwipeToReply>
                </View>
              );
            }}
          />
          {replyTo && (
            <View style={styles.replyBar}>
              <Reply size={15} color={colors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarName}>
                  Replying to {replyTo.sender_id === user?.id ? 'yourself' : partner?.display_name ?? 'them'}
                </Text>
                <Text style={styles.replyBarBody} numberOfLines={1}>
                  {previewText(replyTo)}
                </Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <X size={16} color={colors.inkFaint} strokeWidth={1.75} />
              </Pressable>
            </View>
          )}
          {voice.isRecording ? (
            <RecordingBar
              elapsedMs={voice.elapsedMs}
              level={voice.level}
              sending={sendingVoice}
              onCancel={cancelRecording}
              onSend={sendRecording}
            />
          ) : (
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
              {input.trim() ? (
                <Pressable onPress={() => sendMessage({ body: input })} style={styles.sendBtn}>
                  <Send size={18} color={colors.onSealed} strokeWidth={2} />
                </Pressable>
              ) : (
                <Pressable onPress={startRecording} hitSlop={8} style={styles.sendBtn}>
                  <Mic size={18} color={colors.onSealed} strokeWidth={1.75} />
                </Pressable>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      <ImageViewer viewer={viewer} onClose={() => setViewer(null)} />

      <MessageActionsSheet
        visible={!!actionsFor}
        message={actionsFor}
        mine={actionsFor?.sender_id === user?.id}
        onClose={() => setActionsFor(null)}
        onReply={() => {
          if (actionsFor) setReplyTo(actionsFor);
          setActionsFor(null);
        }}
        onQuickReact={(emoji) => {
          if (actionsFor) toggleReaction(actionsFor, emoji);
          setActionsFor(null);
        }}
        onOpenFullPicker={() => {
          setReactFor(actionsFor);
          setActionsFor(null);
        }}
        onDelete={() => actionsFor && deleteMessage(actionsFor)}
      />
      <ReactionPicker
        visible={!!reactFor}
        onClose={() => setReactFor(null)}
        onSelect={(emoji) => {
          if (reactFor) toggleReaction(reactFor, emoji);
          setReactFor(null);
        }}
      />
    </SafeAreaView>
  );
}

/**
 * The composer swaps to this while recording: a pulsing dot (scaled by the
 * real mic level, not decorative) plus an elapsed timer, a trash button to
 * discard, and a wax-seal send. Tap-to-start/tap-to-stop rather than
 * WhatsApp's hold-with-slide-to-cancel: getting a drag-to-cancel gesture
 * right on both touch and mouse, on top of everything else a voice note
 * already touches, was more risk than a moderate-lift feature should take on
 * for a gesture that a plain cancel button already covers.
 */
function RecordingBar({
  elapsedMs,
  level,
  sending,
  onCancel,
  onSend,
}: {
  elapsedMs: number;
  level: number;
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1 + level * 0.6, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
  }, [level, scale]);

  return (
    <View style={styles.composer}>
      <Pressable onPress={onCancel} hitSlop={8} disabled={sending} style={styles.imageBtn}>
        <Trash2 size={19} color={colors.danger} strokeWidth={1.75} />
      </Pressable>
      <View style={styles.recordingRow}>
        <Animated.View style={[styles.recordingDot, { transform: [{ scale }] }]} />
        <Text style={styles.recordingTimer}>{formatClipDuration(elapsedMs)}</Text>
        <Text style={styles.recordingHint}>Recording a voice note…</Text>
      </View>
      <Pressable onPress={onSend} disabled={sending} hitSlop={8} style={[styles.sendBtn, sending && { opacity: 0.5 }]}>
        {sending ? <ActivityIndicator size="small" color={colors.onSealed} /> : <Send size={18} color={colors.onSealed} strokeWidth={2} />}
      </Pressable>
    </View>
  );
}

/**
 * Tapping a bubble (the small ✦ mark next to its timestamp is the hint) opens
 * this: a quick-reaction bar (the six common emoji, tap one to react
 * immediately, tap + for the full keyboard) up top, then Reply, and (own
 * messages only) Delete. Delete flips the same sheet into an inline two-step
 * confirm rather than Alert.alert, which does not work on web (see CLAUDE.md's
 * Gotchas).
 */
function MessageActionsSheet({
  visible,
  message,
  mine,
  onClose,
  onReply,
  onQuickReact,
  onOpenFullPicker,
  onDelete,
}: {
  visible: boolean;
  message: Message | null;
  mine: boolean;
  onClose: () => void;
  onReply: () => void;
  onQuickReact: (emoji: string) => void;
  onOpenFullPicker: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (visible) setConfirming(false);
  }, [visible, message?.id]);

  const { user } = useAuth();
  const myReaction = message?.reactions?.find((r) => r.user_id === user?.id)?.emoji ?? null;

  return (
    <Sheet visible={visible} onClose={onClose} title={confirming ? 'Delete this message?' : 'Message'}>
      {confirming ? (
        <View>
          <Text style={[text.body, { color: colors.inkMuted, marginBottom: sp.lg }]}>
            This removes it for both of you. It can't be undone.
          </Text>
          <SecondaryButton title="Cancel" onPress={() => setConfirming(false)} style={{ marginBottom: sp.sm }} />
          <PrimaryButton title="Delete" onPress={onDelete} style={{ backgroundColor: colors.danger }} />
        </View>
      ) : (
        <View>
          <View style={styles.quickReactRow}>
            {QUICK_REACTIONS.map((e) => (
              <Pressable
                key={e}
                onPress={() => onQuickReact(e)}
                hitSlop={4}
                style={[styles.quickReactCell, e === myReaction && styles.quickReactCellActive]}
              >
                <Text style={styles.quickReactEmoji}>{e}</Text>
              </Pressable>
            ))}
            <Pressable onPress={onOpenFullPicker} hitSlop={4} style={styles.quickReactPlus}>
              <Plus size={18} color={colors.ink} strokeWidth={1.75} />
            </Pressable>
          </View>
          <Pressable style={[styles.actionRow, !mine && { borderBottomWidth: 0 }]} onPress={onReply}>
            <Reply size={19} color={colors.ink} strokeWidth={1.75} />
            <Text style={text.body}>Reply</Text>
          </Pressable>
          {mine && (
            <Pressable style={[styles.actionRow, { borderBottomWidth: 0 }]} onPress={() => setConfirming(true)}>
              <Trash2 size={19} color={colors.danger} strokeWidth={1.75} />
              <Text style={[text.body, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          )}
        </View>
      )}
    </Sheet>
  );
}

/**
 * Swipe a bubble right to reply, WhatsApp-style. Built on PanResponder (the
 * same core RN gesture API AddMenu already uses for its scrim swipe-down),
 * not a new gesture-handler dependency. Only claims the responder once a drag
 * reads as clearly horizontal, so the surrounding FlatList keeps its vertical
 * scroll.
 */
function SwipeToReply({
  onReply,
  disabled,
  mine,
  children,
}: {
  onReply: () => void;
  disabled?: boolean;
  /** Which edge the bubble hugs, so the hidden-behind-it icon anchors to its LEADING (left) edge either way. */
  mine: boolean;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, g) => !disabled && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        armed.current = false;
      },
      onPanResponderMove: (_evt, g) => {
        const dx = Math.max(0, Math.min(g.dx, SWIPE_MAX));
        translateX.setValue(dx);
        if (dx >= SWIPE_TRIGGER && !armed.current) {
          armed.current = true;
          tapHaptic();
        } else if (dx < SWIPE_TRIGGER) {
          armed.current = false;
        }
      },
      onPanResponderRelease: (_evt, g) => {
        const triggered = g.dx >= SWIPE_TRIGGER;
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, stiffness: 260, damping: 22 }).start();
        if (triggered) onReply();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, stiffness: 260, damping: 22 }).start();
      },
    })
  ).current;

  const iconOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_TRIGGER],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    // The icon anchor is a ZERO-WIDTH box placed right before the bubble in
    // flex order. justifyContent packs [anchor, bubble] together to whichever
    // edge "mine" points at, so the anchor always lands exactly at the
    // bubble's own leading edge, regardless of the bubble's rendered width
    // (no onLayout measurement needed). The icon itself is absolutely
    // positioned inside that zero-width anchor, so it takes no row space and
    // starts out hidden BEHIND the bubble (a later sibling paints on top);
    // sliding the bubble away by translateX reveals it.
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 0 }}>
        <Animated.View style={[styles.swipeIcon, { opacity: iconOpacity }]}>
          <Reply size={16} color={colors.accent} strokeWidth={1.75} />
        </Animated.View>
      </View>
      <Animated.View style={{ transform: [{ translateX }], maxWidth: '100%' }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

function Bubble({
  message,
  mine,
  grouped,
  highlighted,
  seen,
  added,
  quoted,
  quotedName,
  reactions,
  maxWidth,
  imageSize,
  onOpenImage,
  onAddToTimeline,
  onOpenActions,
  onToggleReaction,
  onJumpToQuote,
}: {
  message: Message;
  mine: boolean;
  grouped: boolean;
  /** Briefly true after someone taps a reply pointing here, to draw the eye. */
  highlighted: boolean;
  seen: boolean;
  added: boolean;
  /** The message this one replies to, if it is loaded in the thread. */
  quoted: Message | null;
  quotedName: (senderId: string) => string;
  reactions: { emoji: string; count: number; mine: boolean }[];
  /** Shared by every bubble in the thread, so the column has one straight edge. */
  maxWidth: number;
  /** The image frame, sized from maxWidth so photos end where text does. */
  imageSize: { width: number; height: number };
  onOpenImage: () => void;
  onAddToTimeline: () => void;
  /** A tap on the bubble opens the React / Reply / Delete sheet (the small ✦ mark is the hint). */
  onOpenActions: () => void;
  onToggleReaction: (emoji: string) => void;
  /** Tapping the quoted preview scrolls to the original message. */
  onJumpToQuote?: () => void;
}) {
  const hasImage = !!message.image_thumb;
  const hasAudio = !!message.has_audio;
  const voiceWidth = bubbleVoiceWidth(maxWidth);
  return (
    <View
      style={[
        styles.bubbleRow,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: grouped ? 2 : sp.md },
        highlighted && styles.bubbleRowHighlighted,
      ]}
    >
      {/* One shared pixel cap for the whole thread (not a percentage of the
          screen, which made every bubble a different width). flexShrink +
          minWidth 0 let a bubble holding one long unbroken token shrink below
          its min-content width instead of pushing past that cap. */}
      <View style={{ maxWidth, flexShrink: 1, minWidth: 0, alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <Pressable
          onPress={onOpenActions}
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            hasImage && styles.bubbleWithImage,
            noSelect,
          ]}
        >
          {message.reply_to_id ? (
            // Fixed to a bounded quote width (bubbleLayout owns it), so the
            // quoted name/body truncate inside the column instead of laying out
            // nowrap and dragging the bubble edge out to the cap for a short
            // reply. Sized to never push a text bubble past the cap. Tapping it
            // scrolls to the original (a nested Pressable, so it wins the tap
            // over the bubble's own actions-sheet press).
            <Pressable
              onPress={onJumpToQuote}
              disabled={!onJumpToQuote}
              style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs, { width: bubbleQuoteWidth(maxWidth) }]}
            >
              <Text style={[styles.quoteName, mine && { color: colors.onSealed }, noSelect]} numberOfLines={1}>
                {quoted ? quotedName(quoted.sender_id) : 'Earlier'}
              </Text>
              <Text style={[styles.quoteBody, mine && { color: colors.onSealed, opacity: 0.75 }, noSelect]} numberOfLines={1}>
                {quoted ? previewText(quoted) : 'An earlier message'}
              </Text>
            </Pressable>
          ) : null}
          {hasImage && (
            <Pressable onPress={onOpenImage}>
              <Image
                source={{ uri: message.image_thumb! }}
                style={[styles.bubbleImage, imageSize]}
                contentFit="cover"
                transition={120}
              />
            </Pressable>
          )}
          {hasAudio && (
            <VoiceBubble
              messageId={message.id}
              mine={mine}
              pending={!!message.pending}
              waveform={message.audio_waveform ?? []}
              durationMs={message.audio_duration_ms ?? 0}
              width={voiceWidth}
            />
          )}
          {message.body ? (
            <LinkedText
              body={message.body}
              style={[
                styles.bubbleText,
                // A captioned photo/voice note already sets the bubble's width, so
                // the caption gets that width to wrap inside rather than widening it.
                hasImage && { marginTop: sp.sm, width: imageSize.width },
                hasAudio && { marginTop: sp.sm, width: voiceWidth },
                mine && { color: colors.onSealed },
                noSelect,
              ]}
              linkColor={mine ? colors.onSealed : colors.accent}
            />
          ) : null}
          <View style={styles.bubbleFooter}>
            {/* The hint that tapping this bubble opens the actions sheet, in
                the app's own decorative mark rather than a floating UI icon. */}
            <Text style={[styles.tapHint, mine ? { color: 'rgba(249, 239, 220, 0.55)' } : { color: colors.accent }]}>
              ✦
            </Text>
            <Text style={[styles.time, mine ? { color: colors.onSealed } : { color: colors.inkFaint }, noSelect]}>
              {message.pending ? 'Sending…' : formatTime(message.created_at)}
            </Text>
          </View>
        </Pressable>
        {reactions.length > 0 && (
          <View style={[styles.reactionsRow, mine && { justifyContent: 'flex-end' }]}>
            {reactions.map((r) => (
              <Pressable
                key={r.emoji}
                onPress={() => onToggleReaction(r.emoji)}
                style={[styles.reactionPill, r.mine && styles.reactionPillMine]}
              >
                <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                {r.count > 1 && <Text style={styles.reactionCount}>{r.count}</Text>}
              </Pressable>
            ))}
          </View>
        )}
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

/**
 * A voice note bubble: waveform bars + a play/pause button + its duration.
 * The bars are REAL amplitude data captured while recording, not decorative.
 * The full clip is fetched lazily on first tap, exactly like a photo's full
 * resolution is fetched only when the viewer opens (never eagerly on render,
 * per the app's list-weight-only performance contract).
 */
function VoiceBubble({
  messageId,
  mine,
  pending,
  waveform,
  durationMs,
  width,
}: {
  messageId: string;
  mine: boolean;
  pending: boolean;
  waveform: number[];
  durationMs: number;
  width: number;
}) {
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const player = useAudioPlayer(audioUri);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    // Once the full clip lands, start it. Only true right after we set it.
    if (audioUri) player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUri]);

  const onToggle = async () => {
    if (pending || messageId.startsWith('temp-') || loading) return;
    if (audioUri) {
      status.playing ? player.pause() : player.play();
      return;
    }
    setLoading(true);
    try {
      const data = await api<{ audio_data: string | null }>(`/api/messages/${messageId}`);
      if (data.audio_data) setAudioUri(data.audio_data);
    } catch {
      // no toast here: the play button just stays tappable to retry
    } finally {
      setLoading(false);
    }
  };

  // Progress falls back to the stored duration until the player itself has
  // loaded one (native/web both report 0 before the clip is actually fetched).
  const totalSeconds = status.duration > 0 ? status.duration : durationMs / 1000;
  const playedRatio = totalSeconds > 0 ? Math.min(1, status.currentTime / totalSeconds) : 0;
  const playedBars = Math.round(playedRatio * waveform.length);
  const barColor = mine ? 'rgba(249, 239, 220, 0.9)' : colors.accent;
  const barColorFaint = mine ? 'rgba(249, 239, 220, 0.35)' : colors.hairline;

  return (
    <View style={[styles.voiceRow, { width }]}>
      <Pressable onPress={onToggle} hitSlop={8} style={[styles.voicePlayBtn, mine && styles.voicePlayBtnMine]}>
        {loading ? (
          <ActivityIndicator size="small" color={mine ? colors.onSealed : colors.accent} />
        ) : status.playing ? (
          <Pause size={15} color={mine ? colors.onSealed : colors.accent} strokeWidth={1.75} />
        ) : (
          <Play size={15} color={mine ? colors.onSealed : colors.accent} strokeWidth={1.75} />
        )}
      </Pressable>
      <View style={styles.voiceBars}>
        {(waveform.length ? waveform : new Array(24).fill(0.15)).map((v, i) => (
          <View
            key={i}
            style={[
              styles.voiceBar,
              {
                height: Math.max(3, Math.round(v * 22)),
                backgroundColor: i < playedBars ? barColor : barColorFaint,
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.voiceDuration, mine && { color: colors.onSealed }]}>{formatClipDuration(durationMs)}</Text>
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
    maxWidth: LIST_MAX_WIDTH,
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
  // A soft parchment wash behind the row when a reply jumps here, so the eye
  // finds the message without a jarring flash. Fades on its own after a beat.
  bubbleRowHighlighted: {
    backgroundColor: colors.blushSoft,
    borderRadius: radius.md,
    marginHorizontal: -sp.xs,
    paddingHorizontal: sp.xs,
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  rowTheirs: {
    justifyContent: 'flex-start',
  },
  // WhatsApp-style day separator: a small centred chip between message groups.
  dayDivider: {
    alignItems: 'center',
    marginTop: sp.md,
    marginBottom: sp.sm,
  },
  dayDividerText: {
    ...text.micro,
    color: colors.inkMuted,
    textTransform: 'none',
    letterSpacing: 0.3,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    overflow: 'hidden',
    paddingHorizontal: sp.md,
    paddingVertical: 3,
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
    // width/height come from bubbleImageSize(), so a photo is exactly as wide
    // as the widest line of text can be. Do not hardcode a size here.
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingVertical: sp.xs,
  },
  voicePlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blushSoft,
  },
  voicePlayBtnMine: {
    backgroundColor: 'rgba(249, 239, 220, 0.18)',
  },
  voiceBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 22,
  },
  voiceBar: {
    flex: 1,
    minWidth: 2,
    borderRadius: 1,
  },
  voiceDuration: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.inkMuted,
  },
  bubbleText: {
    ...text.body,
    fontFamily: font.serif,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: sp.xs,
    // Ordinary words flow WHOLE onto the next line; only a token too long to
    // fit a line by itself is ever split. See BUBBLE_TEXT_WRAP for why this is
    // no longer 'anywhere', which split words mid-word.
    ...(Platform.OS === 'web' ? (BUBBLE_TEXT_WRAP as any) : null),
  },
  quote: {
    borderLeftWidth: 2,
    paddingLeft: sp.sm,
    paddingVertical: 2,
    marginBottom: sp.xs,
    marginHorizontal: sp.xs,
    opacity: 0.92,
  },
  quoteMine: { borderLeftColor: 'rgba(249, 239, 220, 0.55)' },
  quoteTheirs: { borderLeftColor: colors.accent },
  quoteName: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    fontWeight: '600',
    color: colors.inkMuted,
  },
  quoteBody: {
    ...text.caption,
    color: colors.inkMuted,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingHorizontal: sp.base,
    paddingVertical: sp.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    width: '100%',
    maxWidth: LIST_MAX_WIDTH,
    alignSelf: 'center',
  },
  replyBarName: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0.2,
    fontWeight: '600',
    color: colors.ink,
  },
  replyBarBody: {
    ...text.caption,
    color: colors.inkMuted,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-end',
    marginTop: 3,
    marginRight: sp.xs,
  },
  tapHint: {
    fontSize: 9,
  },
  time: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.xs,
    marginTop: sp.xs,
    paddingHorizontal: sp.xs,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sp.xs,
    marginTop: sp.xs,
    paddingHorizontal: sp.xs,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: sp.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  reactionPillMine: {
    borderColor: colors.accent,
    backgroundColor: colors.blushSoft,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.inkMuted,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  quickReactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: sp.sm,
    marginBottom: sp.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  quickReactCell: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickReactCellActive: {
    backgroundColor: colors.blushSoft,
  },
  quickReactEmoji: {
    fontSize: 24,
  },
  quickReactPlus: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeIcon: {
    position: 'absolute',
    width: SWIPE_TRIGGER,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
    maxWidth: LIST_MAX_WIDTH,
    alignSelf: 'center',
  },
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    height: 40,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.danger,
  },
  recordingTimer: {
    ...text.body,
    fontVariant: ['tabular-nums'],
    color: colors.ink,
  },
  recordingHint: {
    ...text.caption,
    color: colors.inkMuted,
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
