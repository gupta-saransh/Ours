import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Sparkles, Star } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
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
import { colors, radius, sp, text } from '@/theme';
import { formatDay } from '@/lib/format';
import { useComposeParam } from '@/lib/useComposeParam';

interface Proposal {
  id: string;
  proposer_id: string;
  title: string;
  location: string | null;
  proposed_for: string | null;
  proposed_time: string | null;
  status: 'open' | 'accepted' | 'declined' | 'countered';
  counter_of: string | null;
  rating: number | null;
  reflection: string | null;
  memory_id: string | null;
  completed_at: string | null;
}

interface Idea {
  id: string;
  title: string;
  location: string | null;
}

type Segment = 'upcoming' | 'proposals' | 'past';

// A little curated pool the "surprise them" button draws from, alongside the
// couple's own saved ideas.
const BUILT_IN_IDEAS: { title: string; location?: string }[] = [
  { title: 'A slow morning walk with coffee' },
  { title: 'Cook something new together' },
  { title: 'A golden-hour picnic' },
  { title: 'Revisit where you first met' },
  { title: 'A no-phones dinner by candlelight' },
  { title: 'Stargazing somewhere dark' },
  { title: 'Wander a bookshop, pick a book for each other' },
  { title: 'A long drive with your favourite playlist' },
  { title: 'Farmers market, then make brunch' },
  { title: 'Movie night, blanket fort included' },
  { title: 'Try a class together, dance or pottery' },
  { title: 'Find a view and watch the sun go down' },
];

function daysUntil(date: string): number {
  const target = new Date(date);
  const today = new Date();
  return Math.round(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  );
}

function whenLine(p: Proposal): string {
  return [p.proposed_for ? formatDay(p.proposed_for) : null, p.proposed_time, p.location]
    .filter(Boolean)
    .join(' · ');
}

export default function Dates() {
  const { user, partner } = useAuth();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [seg, setSeg] = useState<Segment>('upcoming');
  const [composerOpen, setComposerOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ title: string; location: string } | null>(null);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [countering, setCountering] = useState(false);
  const [reflectFor, setReflectFor] = useState<Proposal | null>(null);

  useComposeParam(() => setComposerOpen(true));

  const load = useCallback(async () => {
    setFailed(false);
    const data = await api<{ proposals: Proposal[]; ideas: Idea[] }>('/api/dates');
    setProposals(data.proposals);
    setIdeas(data.ideas ?? []);
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

  const surprise = () => {
    const pool = [...ideas.map((i) => ({ title: i.title, location: i.location ?? '' })), ...BUILT_IN_IDEAS.map((i) => ({ title: i.title, location: i.location ?? '' }))];
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    tapHaptic();
    setPrefill({ title: pick.title, location: pick.location });
    setComposerOpen(true);
  };

  const { upcoming, openProposals, past } = useMemo(() => {
    const list = proposals ?? [];
    return {
      upcoming: list.filter(
        (p) => p.status === 'accepted' && !p.completed_at && (!p.proposed_for || daysUntil(p.proposed_for) >= 0)
      ),
      openProposals: list.filter((p) => p.status === 'open'),
      past: list.filter(
        (p) =>
          (p.status === 'accepted' && (p.completed_at || (p.proposed_for && daysUntil(p.proposed_for) < 0))) ||
          p.status === 'declined' ||
          p.status === 'countered'
      ),
    };
  }, [proposals]);

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
          <Skeleton height={40} style={{ marginBottom: sp.lg }} />
          <Skeleton height={72} style={{ marginBottom: sp.lg }} />
          <Skeleton height={72} />
        </View>
      </Screen>
    );
  }

  const waitingOnYou = openProposals.filter((p) => p.proposer_id !== user?.id);
  const waitingOnThem = openProposals.filter((p) => p.proposer_id === user?.id);

  const row = (p: Proposal, last: boolean, tone?: 'accent' | 'positive' | 'neutral' | 'danger') => (
    <ListRow
      key={p.id}
      title={p.title}
      caption={whenLine(p) || undefined}
      trailing={
        p.status === 'accepted' && p.completed_at && p.rating ? (
          <Text style={styles.ratingTag}>{'★'.repeat(p.rating)}</Text>
        ) : (
          <Pill label={pillLabel(p)} tone={tone ?? statusTone(p)} />
        )
      }
      onPress={() => setSelected(p)}
      last={last}
    />
  );

  const segTabs: { key: Segment; label: string; n: number }[] = [
    { key: 'upcoming', label: 'Upcoming', n: upcoming.length },
    { key: 'proposals', label: 'Proposals', n: openProposals.length },
    { key: 'past', label: 'Past', n: past.length },
  ];

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
        <View style={styles.segRow}>
          {segTabs.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => {
                tapHaptic();
                setSeg(t.key);
              }}
              style={[styles.segTab, seg === t.key && styles.segTabActive]}
            >
              <Text style={[text.caption, seg === t.key && { color: colors.surfaceSealed, fontWeight: '600' }]}>
                {t.label}
                {t.n > 0 ? ` · ${t.n}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        {seg === 'upcoming' &&
          (upcoming.length === 0 ? (
            <Empty line="No dates on the calendar yet. Propose one, or let us surprise you." />
          ) : (
            <Section label="On the calendar">
              <Card>{upcoming.map((p, i) => row(p, i === upcoming.length - 1, 'positive'))}</Card>
            </Section>
          ))}

        {seg === 'proposals' &&
          (openProposals.length === 0 ? (
            <Empty line="Nothing waiting. Propose a date to get the ball rolling." />
          ) : (
            <>
              {waitingOnYou.length > 0 && (
                <Section label="Waiting on you">
                  <Card>{waitingOnYou.map((p, i) => row(p, i === waitingOnYou.length - 1, 'accent'))}</Card>
                </Section>
              )}
              {waitingOnThem.length > 0 && (
                <Section label="Waiting on them">
                  <Card>{waitingOnThem.map((p, i) => row(p, i === waitingOnThem.length - 1, 'neutral'))}</Card>
                </Section>
              )}
            </>
          ))}

        {seg === 'past' &&
          (past.length === 0 ? (
            <Empty line="Your history of dates will gather here." />
          ) : (
            <Section label="Where you have been">
              <Card>{past.map((p, i) => row(p, i === past.length - 1))}</Card>
            </Section>
          ))}

        <View style={{ marginTop: sp.lg }}>
          <PrimaryButton title="Propose a date" onPress={() => setComposerOpen(true)} />
          <Pressable onPress={surprise} style={styles.surpriseRow} hitSlop={8}>
            <Sparkles size={15} color={colors.accent} strokeWidth={1.75} />
            <Text style={[text.caption, { color: colors.accent }]}>In doubt? Surprise them with an idea!</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ProposeSheet
        open={composerOpen || countering}
        counterOf={countering ? selected : null}
        prefill={prefill}
        onClose={() => {
          setComposerOpen(false);
          setCountering(false);
          setSelected(null);
          setPrefill(null);
        }}
        onDone={() => {
          setComposerOpen(false);
          setCountering(false);
          setSelected(null);
          setPrefill(null);
          load().catch(() => {});
        }}
      />

      <Sheet visible={!!selected && !countering && !reflectFor} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <ProposalDetail
            proposal={selected}
            mine={selected.proposer_id === user?.id}
            partnerName={partner?.display_name ?? 'Your partner'}
            onAccept={() => act(selected.id, 'accept')}
            onDecline={() => act(selected.id, 'decline')}
            onCounter={() => setCountering(true)}
            onReflect={() => setReflectFor(selected)}
            onProposeNew={() => {
              setSelected(null);
              setComposerOpen(true);
            }}
          />
        )}
      </Sheet>

      <ReflectSheet
        proposal={reflectFor}
        onClose={() => setReflectFor(null)}
        onDone={() => {
          setReflectFor(null);
          setSelected(null);
          load().catch(() => {});
        }}
      />
    </Screen>
  );
}

function statusTone(p: Proposal): 'accent' | 'positive' | 'neutral' | 'danger' {
  if (p.status === 'open') return 'accent';
  if (p.status === 'accepted') return 'positive';
  return 'neutral';
}
function pillLabel(p: Proposal): string {
  if (p.status === 'accepted' && !p.completed_at && p.proposed_for && daysUntil(p.proposed_for) < 0) return 'to log';
  return p.status;
}

/** Detail body of the date sheet, shaped by status and by who proposed. */
function ProposalDetail({
  proposal,
  mine,
  partnerName,
  onAccept,
  onDecline,
  onCounter,
  onReflect,
  onProposeNew,
}: {
  proposal: Proposal;
  mine: boolean;
  partnerName: string;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onReflect: () => void;
  onProposeNew: () => void;
}) {
  const when = whenLine(proposal);

  if (proposal.status === 'open' && !mine) {
    return (
      <>
        <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date or place yet, just the idea.'}</Text>
        <Text style={[text.bodySerif, { marginBottom: sp.lg }]}>
          {partnerName} proposed this. Saying yes
          {proposal.proposed_for ? ' adds it to your milestones and upcoming dates.' : ' settles it.'}
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
        <Text style={text.bodySerif}>You proposed this. {partnerName} gets to accept it, counter it, or pass.</Text>
      </>
    );
  }

  if (proposal.status === 'accepted') {
    const days = proposal.proposed_for ? daysUntil(proposal.proposed_for) : null;
    const happened = days !== null && days < 0;

    // Already logged: show the rating, the note, and the linked memory.
    if (proposal.completed_at) {
      return (
        <>
          <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date set.'}</Text>
          {proposal.rating ? <Text style={styles.ratingBig}>{'★'.repeat(proposal.rating)}{'☆'.repeat(5 - proposal.rating)}</Text> : null}
          {proposal.reflection ? (
            <Text style={[text.bodySerif, { marginTop: sp.md }]}>{proposal.reflection}</Text>
          ) : (
            <Text style={[text.bodySerif, { marginTop: sp.md }]}>You logged this one. ♥</Text>
          )}
          {proposal.memory_id ? (
            <Text style={[text.caption, { marginTop: sp.lg, color: colors.accent }]}>
              A photo of it lives in your timeline.
            </Text>
          ) : null}
        </>
      );
    }

    // Happened but not yet logged: invite the reflection.
    if (happened) {
      return (
        <>
          <Text style={[text.caption, { marginBottom: sp.lg }]}>{when}</Text>
          <Text style={[text.bodySerif, { marginBottom: sp.lg }]}>How was it? Rate it, keep a note, add a photo to your timeline.</Text>
          <PrimaryButton title="Log how it went" onPress={onReflect} />
        </>
      );
    }

    // Upcoming: countdown + reminder promise.
    return (
      <>
        <Text style={[text.caption, { marginBottom: sp.lg }]}>{when || 'No date set, just the promise.'}</Text>
        <Text style={[text.bodySerif, { marginBottom: sp.sm }]}>You both said yes to this one. ♥</Text>
        {days !== null && days > 0 && (
          <Text style={text.bodySerif}>{days === 1 ? 'It is tomorrow.' : `${days} days to go.`}</Text>
        )}
        {days !== null && days === 0 && <Text style={text.bodySerif}>It is today. Have a good one.</Text>}
        <Text style={[text.caption, { marginTop: sp.lg }]}>
        </Text>
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

/** After a date has happened: rate it, keep a note, add a photo to the timeline,
 *  and optionally save it to your idea pool. */
function ReflectSheet({
  proposal,
  onClose,
  onDone,
}: {
  proposal: Proposal | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [saveIdea, setSaveIdea] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset when a new proposal opens.
  useEffect(() => {
    setRating(0);
    setNote('');
    setPhoto(null);
    setThumb(null);
    setSaveIdea(false);
    setError(null);
    setBusy(false);
  }, [proposal?.id]);

  const pickPhoto = async () => {
    setError(null);
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
        ImageManipulator.manipulateAsync(uri, [{ resize: { width: 360 } }], {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }),
      ]);
      setPhoto(`data:image/jpeg;base64,${full.base64}`);
      setThumb(`data:image/jpeg;base64,${small.base64}`);
    } catch {
      setError('Could not read that photo, try another one.');
    }
  };

  const submit = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      let memoryId: string | undefined;
      if (photo) {
        // The photo becomes a real timeline memory, dated to the date itself.
        const mem = await api<{ memory: { id: string } }>('/api/memories', {
          method: 'POST',
          body: {
            note: note.trim() || `Our date: ${proposal.title}`,
            photoData: photo,
            thumbData: thumb ?? undefined,
            memoryDate: proposal.proposed_for ?? undefined,
          },
        });
        memoryId = mem.memory.id;
      }
      await api(`/api/dates/${proposal.id}`, {
        method: 'PATCH',
        body: {
          action: 'complete',
          rating: rating || undefined,
          reflection: note.trim() || undefined,
          memoryId,
          saveIdea,
        },
      });
      successHaptic();
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={!!proposal} onClose={onClose} title="How was it?">
      {proposal && (
        <>
          <Text style={[text.caption, { marginBottom: sp.lg }]}>{whenLine(proposal) || proposal.title}</Text>
          <StarRating value={rating} onChange={setRating} />
          <TextField
            label="A note to remember it by (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="What made it special?"
            multiline
            style={{ height: 88, marginTop: sp.lg }}
          />
          <Pressable onPress={pickPhoto} style={styles.photoPick}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.photoPreview} contentFit="cover" />
            ) : (
              <Text style={[text.body, { color: colors.inkMuted }]}>✧ Add a photo to your timeline</Text>
            )}
          </Pressable>
          <Pressable onPress={() => setSaveIdea((s) => !s)} style={styles.saveIdeaRow} hitSlop={6}>
            <View style={[styles.checkbox, saveIdea && styles.checkboxOn]}>
              {saveIdea ? <Text style={{ color: colors.onSealed, fontSize: 13 }}>✓</Text> : null}
            </View>
            <Text style={text.body}>Save this as a date idea to do again</Text>
          </Pressable>
          <FormError message={error} />
          <PrimaryButton title="Keep this date" onPress={submit} loading={busy} disabled={rating === 0 && !note.trim() && !photo} />
          <LockBadge style={{ marginTop: sp.base, alignSelf: 'center' }} />
        </>
      )}
    </Sheet>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => {
            tapHaptic();
            onChange(n === value ? 0 : n);
          }}
          hitSlop={6}
        >
          <Star
            size={30}
            color={colors.accent}
            fill={n <= value ? colors.accent : 'none'}
            strokeWidth={1.75}
          />
        </Pressable>
      ))}
    </View>
  );
}

function ProposeSheet({
  open,
  counterOf,
  prefill,
  onClose,
  onDone,
}: {
  open: boolean;
  counterOf: Proposal | null;
  prefill: { title: string; location: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Apply a "surprise them" prefill when the sheet opens with one.
  useEffect(() => {
    if (open && prefill) {
      setTitle(prefill.title);
      setLocation(prefill.location);
    }
  }, [open, prefill]);

  const submit = async () => {
    setError(null);
    if (date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError('Date should look like 2026-08-14 (YYYY-MM-DD)');
      return;
    }
    if (time.trim() && !/^\d{2}:\d{2}$/.test(time.trim())) {
      setError('Time should look like 19:30 (HH:MM)');
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        location: location.trim() || undefined,
        proposedFor: date.trim() || undefined,
        proposedTime: time.trim() || undefined,
      };
      if (counterOf) {
        await api(`/api/dates/${counterOf.id}`, { method: 'PATCH', body: { action: 'counter', ...body } });
      } else {
        await api('/api/dates', { method: 'POST', body });
      }
      setTitle('');
      setLocation('');
      setDate('');
      setTime('');
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={open} onClose={onClose} title={counterOf ? 'Counter with your idea' : 'Propose a date'}>
      {counterOf && <Text style={[text.caption, { marginBottom: sp.lg }]}>Instead of "{counterOf.title}".</Text>}
      <TextField label="What are we doing?" value={title} onChangeText={setTitle} placeholder="Dinner at that little place" />
      <TextField label="Where (optional)" value={location} onChangeText={setLocation} placeholder="The old town" />
      <View style={styles.whenRow}>
        <TextField
          label="Date (optional)"
          value={date}
          onChangeText={setDate}
          placeholder="2026-08-14"
          autoCapitalize="none"
          style={{ flex: 1 }}
        />
        <TextField
          label="Time (optional)"
          value={time}
          onChangeText={setTime}
          placeholder="19:30"
          autoCapitalize="none"
          style={{ width: 120 }}
        />
      </View>
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
  segRow: { flexDirection: 'row', gap: sp.sm, marginBottom: sp.xl },
  segTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: sp.sm,
    paddingHorizontal: sp.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  segTabActive: { borderColor: colors.surfaceSealed },
  surpriseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.sm,
    marginTop: sp.md,
  },
  ratingTag: { ...text.caption, color: colors.accent, letterSpacing: 1 },
  ratingBig: { fontSize: 24, color: colors.accent, letterSpacing: 3, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: sp.sm },
  whenRow: { flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' },
  photoPick: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: sp.lg,
    marginBottom: sp.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  photoPreview: { width: '100%', aspectRatio: 16 / 10 },
  saveIdeaRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.positive, borderColor: colors.positive },
});
