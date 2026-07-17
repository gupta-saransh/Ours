import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Plus, Trash2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { AppPressable, Card, ErrorState, Screen, Section, Skeleton } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';
import { useComposeParam } from '@/lib/useComposeParam';

interface Item {
  id: string;
  author_id: string;
  title: string;
  done: boolean;
  created_at: string;
}

/**
 * "Our list" as its own screen: everything you two want to do together. Done
 * items are signed off with a line through them and kept, so the list reads as
 * a growing record of what you have already crossed off, not just a to-do.
 * Any item can be renamed or removed; either partner may edit (shared list).
 */
export default function ListScreen() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  useComposeParam(() => setAdding(true));

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ items: Item[] }>('/api/bucket');
    setItems(data.items);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  const add = async () => {
    const title = newItem.trim();
    if (!title) return;
    setNewItem('');
    try {
      const res = await api<{ item: Item }>('/api/bucket', { method: 'POST', body: { title } });
      setItems((prev) => [res.item, ...(prev ?? [])]);
      successHaptic();
    } catch {
      setNewItem(title);
    }
  };

  const toggle = async (item: Item) => {
    tapHaptic();
    const next = !item.done;
    setItems((prev) => (prev ? prev.map((i) => (i.id === item.id ? { ...i, done: next } : i)) : prev));
    if (next) successHaptic();
    try {
      await api(`/api/bucket/${item.id}`, { method: 'PATCH', body: { done: next } });
    } catch {
      load().catch(() => {});
    }
  };

  const saveEdit = async (item: Item) => {
    const title = draft.trim();
    setEditingId(null);
    if (!title || title === item.title) return;
    setItems((prev) => (prev ? prev.map((i) => (i.id === item.id ? { ...i, title } : i)) : prev));
    try {
      await api(`/api/bucket/${item.id}`, { method: 'PATCH', body: { title } });
    } catch {
      load().catch(() => {});
    }
  };

  const remove = async (item: Item) => {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    try {
      await api(`/api/bucket/${item.id}`, { method: 'DELETE' });
    } catch {
      load().catch(() => {});
    }
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setDraft(item.title);
  };

  const { active, done } = useMemo(() => {
    const list = items ?? [];
    return {
      active: list.filter((i) => !i.done),
      done: list.filter((i) => i.done),
    };
  }, [items]);

  if (failed && !items) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!items) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={56} style={{ marginBottom: sp.lg }} />
          <Skeleton height={140} />
        </View>
      </Screen>
    );
  }

  const row = (item: Item) => (
    <View key={item.id} style={styles.row}>
      <Pressable onPress={() => toggle(item)} hitSlop={8} style={[styles.check, item.done && styles.checkDone]}>
        {item.done && <Check size={14} color={colors.onSealed} strokeWidth={2.5} />}
      </Pressable>
      {editingId === item.id ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => saveEdit(item)}
          onSubmitEditing={() => saveEdit(item)}
          autoFocus
          style={[styles.title, styles.titleInput]}
          returnKeyType="done"
        />
      ) : (
        <Pressable style={{ flex: 1 }} onPress={() => startEdit(item)}>
          <Text style={[styles.title, item.done && styles.titleDone]}>{item.title}</Text>
        </Pressable>
      )}
      <Pressable onPress={() => remove(item)} hitSlop={8} style={styles.trash}>
        <Trash2 size={16} color={colors.inkFaint} strokeWidth={1.75} />
      </Pressable>
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.composer}>
          <TextInput
            value={newItem}
            onChangeText={setNewItem}
            placeholder="Someday, together we will..."
            placeholderTextColor={colors.inkFaint}
            style={styles.composerInput}
            autoFocus={adding}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <AppPressable onPress={add} disabled={!newItem.trim()} style={[styles.addBtn, !newItem.trim() && { opacity: 0.4 }]}>
            <Plus size={20} color={colors.onSealed} strokeWidth={2} />
          </AppPressable>
        </View>

        {active.length === 0 && done.length === 0 ? (
          <Text style={[text.bodySerif, { fontStyle: 'italic', color: colors.inkMuted, textAlign: 'center', marginTop: sp.xxl }]}>
            Your list is empty. What is the first thing you want to do together?
          </Text>
        ) : (
          <>
            <Section label={active.length ? 'To do together' : 'Nothing left, for now'}>
              <Card>
                {active.length === 0 ? (
                  <Text style={text.caption}>Everything here is done. Add the next thing above.</Text>
                ) : (
                  active.map(row)
                )}
              </Card>
            </Section>

            {done.length > 0 && (
              <Section label={`Done together · ${done.length}`}>
                <Card>{done.map(row)}</Card>
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.xl,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    marginBottom: sp.xl,
  },
  composerInput: {
    flex: 1,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    fontFamily: 'Fraunces_400Regular',
    fontSize: 16,
    color: colors.ink,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: {
    backgroundColor: colors.positive,
    borderColor: colors.positive,
  },
  title: {
    ...text.body,
    flex: 1,
  },
  titleInput: {
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  titleDone: {
    color: colors.inkFaint,
    textDecorationLine: 'line-through',
  },
  trash: {
    padding: sp.xs,
  },
});
