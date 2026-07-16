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
import { LockBadge } from '@/components/LockBadge';
import { colors, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';

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

  // Opened from the universal add button.
  useComposeParam(() => setComposerOpen(true));

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

  // Every row opens the detail sheet; what the sheet offers depends on the
  // proposal's status and who proposed it.
  const row = (p: Proposal, last: boolean) => (
    <ListRow
      key={p.id}
      title={p.title}
      caption={[p.proposed_for ? formatDay(p.proposed_for) : null, p.location].filter(Boolean).join(' · ') || undefined}
      trailing={<Pill label={p.status} tone={STATUS_TONE[p.status]} />}
      onPress={() => setSelected(p)}
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
          <ProposalDetail
            proposal={selected}
            mine={selected.proposer_id === user?.id}
            partnerName={partner?.display_name ?? 'Your partner'}
            onAccept={() => act(selected.id, 'accept')}
            onDecline={() => act(selected.id, 'decline')}
            onCounter={() => setCountering(true)}
            onProposeNew={() => {
              setSelected(null);
              setComposerOpen(true);
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}

function daysUntil(date: string): number {
  const target = new Date(date);
  const today = new Date();
  return Math.round(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  );
}

/** Detail body of the date sheet, shaped by status and by who proposed. */
function ProposalDetail({
  proposal,
  mine,
  partnerName,
  onAccept,
  onDecline,
  onCounter,
  onProposeNew,
}: {
  proposal: Proposal;
  mine: boolean;
  partnerName: string;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onProposeNew: () => void;
}) {
  const when = [proposal.proposed_for ? formatDay(proposal.proposed_for) : null, proposal.location]
    .filter(Boolean)
    .join(' · ');

  if (proposal.status === 'open' && !mine) {
    return (
      <>
        <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date or place yet, just the idea.'}</Text>
        <Text style={[text.bodySerif, { marginBottom: sp.lg }]}>
          {partnerName} proposed this. Saying yes
          {proposal.proposed_for ? ' adds it to your milestones.' : ' settles it.'}
        </Text>
        <PrimaryButton title="Accept" onPress={onAccept} />
        <SecondaryButton title="Counter with another idea" onPress={onCounter} style={{ marginTop: sp.md }} />
        <SecondaryButton title="Decline" destructive onPress={onDecline} style={{ marginTop: sp.md }} />
      </>
    );
  }

  if (proposal.status === 'open') {
    return (
      <>
        <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date or place yet, just the idea.'}</Text>
        <Text style={text.bodySerif}>
          You proposed this. {partnerName} gets to accept it, counter it, or pass.
        </Text>
      </>
    );
  }

  if (proposal.status === 'accepted') {
    const days = proposal.proposed_for ? daysUntil(proposal.proposed_for) : null;
    return (
      <>
        <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date set, just the promise.'}</Text>
        <Text style={[text.bodySerif, { marginBottom: sp.sm }]}>
          You both said yes to this one. ♥
        </Text>
        {days !== null && days > 0 && (
          <Text style={text.bodySerif}>
            {days === 1 ? 'It is tomorrow.' : `${days} days to go.`}
          </Text>
        )}
        {days !== null && days === 0 && <Text style={text.bodySerif}>It is today. Have a good one.</Text>}
        {days !== null && days < 0 && (
          <Text style={text.bodySerif}>It happened on {formatDay(proposal.proposed_for!)}. Worth a memory?</Text>
        )}
        {proposal.proposed_for && (
          <Text style={[text.caption, { marginTop: sp.lg }]}>It also lives in your milestones.</Text>
        )}
      </>
    );
  }

  return (
    <>
      <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date or place, just the idea.'}</Text>
      <Text style={[text.bodySerif, { marginBottom: sp.lg }]}>
        {proposal.status === 'declined'
          ? 'This one did not land. The next idea might.'
          : 'This one was answered with a different idea.'}
      </Text>
      <SecondaryButton title="Propose something new" onPress={onProposeNew} />
    </>
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
      <LockBadge style={{ marginTop: sp.base, alignSelf: 'center' }} />
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
