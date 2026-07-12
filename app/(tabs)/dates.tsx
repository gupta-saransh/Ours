import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic } from '@/lib/haptics';
import {
  Card,
  Empty,
  ErrorState,
  FormError,
  ListRow,
  Pill,
  PrimaryButton,
  Screen,
  Section,
  SecondaryButton,
  Skeleton,
  TextField,
} from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';

interface Proposal {
  id: string;
  proposer_id: string;
  title: string;
  location: string | null;
  proposed_for: string | null;
  status: 'open' | 'accepted' | 'declined' | 'countered';
  counter_of: string | null;
}

const STATUS_TONE: Record<Proposal['status'], 'accent' | 'positive' | 'neutral' | 'danger'> = {
  open: 'accent',
  accepted: 'positive',
  declined: 'neutral',
  countered: 'neutral',
};

export default function Dates() {
  const { user, partner } = useAuth();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [countering, setCountering] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ proposals: Proposal[] }>('/api/dates');
    setProposals(data.proposals);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  useCoupleEvent('date.proposed', () => load().catch(() => {}));
  useCoupleEvent('date.updated', () => load().catch(() => {}));

  const act = async (id: string, action: 'accept' | 'decline') => {
    setSelected(null);
    if (action === 'accept') successHaptic();
    try {
      await api(`/api/dates/${id}`, { method: 'PATCH', body: { action } });
    } finally {
      load().catch(() => {});
    }
  };

  if (failed && !proposals) {
    return (
      <Screen>
        <ErrorState onRetry={() => load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!proposals) {
    return (
      <Screen>
        <View style={styles.body}>
          <Skeleton height={72} style={{ marginBottom: sp.lg }} />
          <Skeleton height={72} style={{ marginBottom: sp.lg }} />
          <Skeleton height={72} />
        </View>
      </Screen>
    );
  }

  const waitingOnYou = proposals.filter((p) => p.status === 'open' && p.proposer_id !== user?.id);
  const waitingOnThem = proposals.filter((p) => p.status === 'open' && p.proposer_id === user?.id);
  const resolved = proposals.filter((p) => p.status !== 'open').slice(0, 20);

  const row = (p: Proposal, last: boolean) => (
    <ListRow
      key={p.id}
      title={p.title}
      caption={[p.proposed_for ? formatDay(p.proposed_for) : null, p.location].filter(Boolean).join(' · ') || undefined}
      trailing={<Pill label={p.status} tone={STATUS_TONE[p.status]} />}
      onPress={p.status === 'open' ? () => setSelected(p) : undefined}
      last={last}
    />
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load().catch(() => {});
              setRefreshing(false);
            }}
            tintColor={colors.accent}
          />
        }
      >
        {proposals.length === 0 && (
          <Empty
            line="No dates planned yet."
            actionTitle="Propose one"
            onAction={() => setComposerOpen(true)}
          />
        )}

        {waitingOnYou.length > 0 && (
          <Section label="Waiting on you">
            <Card>{waitingOnYou.map((p, i) => row(p, i === waitingOnYou.length - 1))}</Card>
          </Section>
        )}
        {waitingOnThem.length > 0 && (
          <Section label="Waiting on them">
            <Card>{waitingOnThem.map((p, i) => row(p, i === waitingOnThem.length - 1))}</Card>
          </Section>
        )}
        {resolved.length > 0 && (
          <Section label="Recently">
            <Card>{resolved.map((p, i) => row(p, i === resolved.length - 1))}</Card>
          </Section>
        )}

        {proposals.length > 0 && <PrimaryButton title="Propose a date" onPress={() => setComposerOpen(true)} />}
      </ScrollView>

      <ProposeSheet
        open={composerOpen || countering}
        counterOf={countering ? selected : null}
        onClose={() => {
          setComposerOpen(false);
          setCountering(false);
          setSelected(null);
        }}
        onDone={() => {
          setComposerOpen(false);
          setCountering(false);
          setSelected(null);
          load().catch(() => {});
        }}
      />

      <Sheet visible={!!selected && !countering} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <>
            <Text style={[text.caption, { marginBottom: sp.lg }]}>
              {[selected.proposed_for ? formatDay(selected.proposed_for) : null, selected.location]
                .filter(Boolean)
                .join(' · ') || 'No date or place yet, just the idea.'}
            </Text>
            <Text style={[text.bodySerif, { marginBottom: sp.lg }]}>
              {partner?.display_name ?? 'Your partner'} proposed this. Saying yes
              {selected.proposed_for ? ' adds it to your milestones.' : ' settles it.'}
            </Text>
            <PrimaryButton title="Accept" onPress={() => act(selected.id, 'accept')} />
            <SecondaryButton title="Counter with another idea" onPress={() => setCountering(true)} style={{ marginTop: sp.md }} />
            <SecondaryButton title="Decline" destructive onPress={() => act(selected.id, 'decline')} style={{ marginTop: sp.md }} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

function ProposeSheet({
  open,
  counterOf,
  onClose,
  onDone,
}: {
  open: boolean;
  counterOf: Proposal | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError('Date should look like 2026-08-14 (YYYY-MM-DD)');
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        location: location.trim() || undefined,
        proposedFor: date.trim() || undefined,
      };
      if (counterOf) {
        await api(`/api/dates/${counterOf.id}`, { method: 'PATCH', body: { action: 'counter', ...body } });
      } else {
        await api('/api/dates', { method: 'POST', body });
      }
      setTitle('');
      setLocation('');
      setDate('');
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={open} onClose={onClose} title={counterOf ? 'Counter with your idea' : 'Propose a date'}>
      {counterOf && (
        <Text style={[text.caption, { marginBottom: sp.lg }]}>Instead of "{counterOf.title}".</Text>
      )}
      <TextField label="What are we doing?" value={title} onChangeText={setTitle} placeholder="Dinner at that little place" />
      <TextField label="Where (optional)" value={location} onChangeText={setLocation} placeholder="The old town" />
      <TextField
        label="When (optional, YYYY-MM-DD)"
        value={date}
        onChangeText={setDate}
        placeholder="2026-08-14"
        autoCapitalize="none"
      />
      <FormError message={error} />
      <PrimaryButton title={counterOf ? 'Send counter' : 'Propose'} onPress={submit} loading={busy} disabled={!title.trim()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.xl,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
});
