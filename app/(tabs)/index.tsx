import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { Button, Card, EmptyState, FormError } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';
import { formatDay } from '@/lib/format';

interface Memory {
  id: string;
  author_id: string;
  author_name: string;
  photo_data: string | null;
  note: string;
  created_at: string;
}

export default function Memories() {
  const { user } = useAuth();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ memories: Memory[] }>('/api/memories');
    setMemories(data.memories);
  }, []);

  useEffect(() => {
    load().catch(() => setMemories([]));
  }, [load]);

  // Partner added a memory on their device → pull the fresh list (photo isn't sent over the wire).
  useCoupleEvent('memory.created', (data) => {
    if (data?.author_id !== user?.id) load().catch(() => {});
  });

  if (memories === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={memories}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="Your story starts here"
            line="Add the first memory — a photo, a moment, a line you don’t want to forget."
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.memory}>
            {item.photo_data ? (
              <Image source={{ uri: item.photo_data }} style={styles.photo} contentFit="cover" transition={200} />
            ) : null}
            <Text style={styles.note}>{item.note}</Text>
            <Text style={styles.meta}>
              {item.author_id === user?.id ? 'You' : item.author_name} · {formatDay(item.created_at)}
            </Text>
          </Card>
        )}
      />
      <Pressable style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.rosePressed }]} onPress={() => setComposerOpen(true)}>
        <Text style={styles.fabText}>＋ Add a memory</Text>
      </Pressable>
      <MemoryComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(m) => {
          setMemories((prev) => [m, ...(prev ?? [])]);
          setComposerOpen(false);
        }}
      />
    </View>
  );
}

function MemoryComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (m: Memory) => void;
}) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickPhoto = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    try {
      // Compress client-side so uploads stay small and fast.
      const resized = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setPhoto(`data:image/jpeg;base64,${resized.base64}`);
    } catch {
      setError('Couldn’t read that photo — try another one.');
    }
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await api<{ memory: Memory }>('/api/memories', {
        method: 'POST',
        body: { note, photoData: photo ?? undefined },
      });
      setNote('');
      setPhoto(null);
      onCreated(data.memory);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>A moment worth keeping</Text>
        <Pressable onPress={pickPhoto} style={styles.photoPick}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photoPreview} contentFit="cover" />
          ) : (
            <Text style={styles.photoPickText}>✧ Add a photo</Text>
          )}
        </Pressable>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What happened? How did it feel?"
          placeholderTextColor={colors.inkSoft}
          multiline
          style={styles.noteInput}
        />
        <FormError message={error} />
        <Button title="Keep this memory" onPress={save} loading={busy} disabled={note.trim().length === 0} />
        <Button title="Not now" variant="ghost" onPress={onClose} style={{ marginTop: space(2) }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  list: {
    padding: space(5),
    paddingBottom: space(28),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  memory: { marginBottom: space(4), padding: space(3) },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    backgroundColor: colors.blushSoft,
  },
  note: {
    fontFamily: font.serif,
    fontSize: type.heading,
    lineHeight: 28,
    color: colors.ink,
    paddingHorizontal: space(1),
    paddingTop: space(3),
  },
  meta: {
    fontSize: type.small,
    color: colors.inkSoft,
    paddingHorizontal: space(1),
    paddingTop: space(2),
    paddingBottom: space(1),
  },
  fab: {
    position: 'absolute',
    bottom: space(6),
    alignSelf: 'center',
    backgroundColor: colors.rose,
    borderRadius: radius.full,
    paddingVertical: space(3.5),
    paddingHorizontal: space(6),
  },
  fabText: { color: '#FFF9F2', fontSize: type.body, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(59, 46, 42, 0.35)' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space(6),
    paddingBottom: space(10),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sheetTitle: {
    fontFamily: font.display,
    fontSize: type.title,
    color: colors.ink,
    marginBottom: space(4),
  },
  photoPick: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(4),
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  photoPickText: { color: colors.inkSoft, fontSize: type.body },
  photoPreview: { width: '100%', aspectRatio: 4 / 3 },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: space(3.5),
    minHeight: 96,
    fontSize: type.body,
    color: colors.ink,
    textAlignVertical: 'top',
    marginBottom: space(4),
  },
});
