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
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ChevronLeft, ImagePlus, ImageDown, Plus, Reply, Send, Trash2, X } from 'lucide-react-native';
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
import { colors, font, radius, sp, text } from '@/theme';
import { formatTime } from '@/lib/format';

interface Message {
  id: string;
  sender_id: string;
  body: string;
  image_thumb?: string | null;
  has_image?: boolean;
  reply_to_id?: string | null;
  reactions?: ReactionRow[];
  created_at: string;
  pending?: boolean;
}

/** How far a bubble must be dragged right before releasing it triggers a reply. */
const SWIPE_TRIGGER = 44;
const SWIPE_MAX = 64;

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
  // The message being quoted by the next send (long-press a bubble to set it).
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Long-press opens this: React / Reply / Delete for one message.
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  // React (from the menu, or tapping an existing pill someone else started) opens this.
  const [reactFor, setReactFor] = useState<Message | null>(null);

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

  const sendMessage = async (opts: { body?: string; imageData?: string; imageThumb?: string }) => {
    const bodyText = (opts.body ?? '').trim();
    if (!bodyText && !opts.imageData) return;
    const quoted = replyTo;
    setInput('');
    setReplyTo(null);
    const temp: Message = {
      id: `temp-${Date.now()}`,
      sender_id: user!.id,
      body: bodyText,
      image_thumb: opts.imageThumb ?? null,
      has_image: !!opts.imageData,
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
          replyToId: quoted && !quoted.id.startsWith('temp-') ? quoted.id : undefined,
        },
      });
      successHaptic();
      setMsgs((prev) => prev.map((x) => (x.id === temp.id ? message : x)));
    } catch {
      setMsgs((prev) => prev.filter((x) => x.id !== temp.id));
      if (bodyText) setInput(bodyText);
      if (quoted) setReplyTo(quoted);
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
                <SwipeToReply onReply={() => setReplyTo(item)} disabled={item.pending} mine={mine}>
                  <Bubble
                    message={item}
                    mine={mine}
                    grouped={!!grouped}
                    seen={item.id === seenReceiptId}
                    added={addedIds.has(item.id)}
                    quoted={item.reply_to_id ? msgs.find((x) => x.id === item.reply_to_id) ?? null : null}
                    quotedName={(sid) => (sid === user?.id ? 'You' : partner?.display_name ?? 'Them')}
                    reactions={groupReactions(item.reactions ?? [], user?.id)}
                    onOpenImage={() => item.image_thumb && setViewer({ id: item.id, thumb: item.image_thumb })}
                    onAddToTimeline={() => addToTimeline(item)}
                    onOpenActions={() => !item.pending && setActionsFor(item)}
                    onToggleReaction={(emoji) => toggleReaction(item, emoji)}
                  />
                </SwipeToReply>
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
                  {replyTo.body || 'Photo'}
                </Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <X size={16} color={colors.inkFaint} strokeWidth={1.75} />
              </Pressable>
            </View>
          )}
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
  seen,
  added,
  quoted,
  quotedName,
  reactions,
  onOpenImage,
  onAddToTimeline,
  onOpenActions,
  onToggleReaction,
}: {
  message: Message;
  mine: boolean;
  grouped: boolean;
  seen: boolean;
  added: boolean;
  /** The message this one replies to, if it is loaded in the thread. */
  quoted: Message | null;
  quotedName: (senderId: string) => string;
  reactions: { emoji: string; count: number; mine: boolean }[];
  onOpenImage: () => void;
  onAddToTimeline: () => void;
  /** A tap on the bubble opens the React / Reply / Delete sheet (the small ✦ mark is the hint). */
  onOpenActions: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const hasImage = !!message.image_thumb;
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, { marginTop: grouped ? 2 : sp.md }]}>
      {/* flexShrink keeps the bubble inside its 80% cap even when a long
          unbroken token (a URL) would otherwise push it off screen. */}
      <View style={{ maxWidth: '80%', flexShrink: 1, alignItems: mine ? 'flex-end' : 'flex-start' }}>
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
            <View style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}>
              <Text style={[styles.quoteName, mine && { color: colors.onSealed }, noSelect]} numberOfLines={1}>
                {quoted ? quotedName(quoted.sender_id) : 'Earlier'}
              </Text>
              <Text style={[styles.quoteBody, mine && { color: colors.onSealed, opacity: 0.75 }, noSelect]} numberOfLines={1}>
                {quoted ? quoted.body || 'Photo' : 'An earlier message'}
              </Text>
            </View>
          ) : null}
          {hasImage && (
            <Pressable onPress={onOpenImage}>
              <Image source={{ uri: message.image_thumb! }} style={styles.bubbleImage} contentFit="cover" transition={120} />
            </Pressable>
          )}
          {message.body ? (
            <LinkedText
              body={message.body}
              style={[styles.bubbleText, hasImage && { marginTop: sp.sm }, mine && { color: colors.onSealed }, noSelect]}
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
    // Long unbroken tokens (URLs) must wrap inside the bubble. 'anywhere'
    // affects min-content sizing, which plain break-word does not, so without
    // it a pasted URL stretches the bubble past the screen edge.
    ...(Platform.OS === 'web' ? ({ wordBreak: 'break-word', overflowWrap: 'anywhere' } as any) : null),
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
    maxWidth: 680,
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
