import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Send } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic } from '@/lib/haptics';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';
import { formatTime } from '@/lib/format';

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  pending?: boolean;
}

export default function Chat() {
  const { status, user, partner } = useAuth();
  const router = useRouter();
  // `msgs` is newest-first to feed an inverted list (newest at the bottom).
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seenRef = useRef(false);

  const markSeen = useCallback(() => {
    api('/api/messages/seen', { method: 'POST' }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const data = await api<{ messages: Message[]; hasMore: boolean }>('/api/messages');
    setMsgs(data.messages.slice().reverse());
    setHasMore(data.hasMore);
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

  const send = async () => {
    const bodyText = input.trim();
    if (!bodyText) return;
    setInput('');
    const temp: Message = {
      id: `temp-${Date.now()}`,
      sender_id: user!.id,
      body: bodyText,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMsgs((prev) => [temp, ...prev]);
    try {
      const { message } = await api<{ message: Message }>('/api/messages', {
        method: 'POST',
        body: { body: bodyText },
      });
      successHaptic();
      setMsgs((prev) => prev.map((x) => (x.id === temp.id ? message : x)));
    } catch {
      setMsgs((prev) => prev.filter((x) => x.id !== temp.id));
      setInput(bodyText);
    }
  };

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
                  <Text style={styles.emptyLine}>Say the first thing. A hello, a heart, anything.</Text>
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === user?.id;
              // In an inverted list the visually-previous bubble is index+1.
              const prev = msgs[index + 1];
              const grouped = prev && prev.sender_id === item.sender_id;
              return <Bubble message={item} mine={mine} grouped={!!grouped} />;
            }}
          />
          <View style={styles.composer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Message"
              placeholderTextColor={colors.inkFaint}
              style={styles.input}
              multiline
              onSubmitEditing={send}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={send}
              disabled={!input.trim()}
              style={[styles.sendBtn, !input.trim() && { opacity: 0.4 }]}
            >
              <Send size={18} color={colors.onSealed} strokeWidth={2} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Bubble({ message, mine, grouped }: { message: Message; mine: boolean; grouped: boolean }) {
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, { marginTop: grouped ? 2 : sp.md }]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, mine && { color: colors.onSealed }]}>{message.body}</Text>
        <Text style={[styles.time, mine ? { color: colors.onSealed } : { color: colors.inkFaint }]}>
          {message.pending ? 'Sending…' : formatTime(message.created_at)}
        </Text>
      </View>
    </View>
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
    transform: [{ scaleY: -1 }], // counter the inverted list so text reads upright
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
    maxWidth: '80%',
    paddingVertical: sp.sm,
    paddingHorizontal: sp.md,
    borderRadius: radius.md,
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
  bubbleText: {
    ...text.body,
    fontFamily: font.serif,
    fontSize: 16,
    lineHeight: 22,
  },
  time: {
    ...text.micro,
    textTransform: 'none',
    letterSpacing: 0,
    marginTop: 3,
    alignSelf: 'flex-end',
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
});
