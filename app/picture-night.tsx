import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight, Search } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { Card, Empty, ErrorState, Screen, Skeleton, SubScreenHeader } from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, radius, sp, text } from '@/theme';

/**
 * Picture Night: the shared movie riddle board.
 *
 * Two boards a day, both open at once, and a calendar to play any past day
 * (the mystery is arithmetic on the date, so an old day always resolves to the
 * same film). Deliberately NOT This-or-That's private-then-reveal shape: every
 * guess either of you makes lands on this board immediately, for both of you,
 * over `riddle.guessed`. Two people leaning over one crossword.
 *
 * The answer is never in the client until the board is over. The server holds
 * it back, so there is nothing here to accidentally render early.
 */

interface Tile {
  key: 'year' | 'genre' | 'cast' | 'director';
  state: 'hit' | 'near' | 'miss';
  value: string;
  shared: string[];
  direction?: 'up' | 'down';
}
interface Guess {
  movieId: string;
  title: string;
  year: number;
  by: string;
  correct: boolean;
  created_at: string;
  tiles: Tile[];
}
interface BoardState {
  solved: boolean;
  lost: boolean;
  over: boolean;
  attemptsUsed: number;
  attemptsLeft: number;
  hintsUnlocked: number;
  solvedBy: string | null;
}
interface Board {
  round: number;
  state: BoardState;
  guesses: Guess[];
  hints: { label: string; value: string }[];
  answer: { title: string; year: number } | null;
}
interface Data {
  date: string;
  today: string;
  maxAttempts: number;
  boards: Board[];
  month: string;
  marks: { day: string; round: number; solved: boolean; guesses: number }[];
}
interface Result {
  id: string;
  title: string;
  year: number;
}

const TILE_LABEL: Record<Tile['key'], string> = {
  year: 'Year',
  genre: 'Genre',
  cast: 'Cast',
  director: 'Director',
};

const shiftDay = (date: string, by: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

const prettyDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
};

export default function PictureNight() {
  const { status, user, partner } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const load = useCallback(async (d: string) => {
    setFailed(false);
    const res = await api<Data>(`/api/picture-night?date=${d}`);
    setData(res);
  }, []);

  useEffect(() => {
    setData(null);
    load(date).catch(() => setFailed(true));
  }, [date, load]);

  // The board is shared, so a partner's guess arrives here in full and simply
  // appends. No refetch: the event already carries the tiles and the new state.
  useCoupleEvent('riddle.guessed', (payload: any) => {
    if (!payload || payload.date !== date) return;
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        boards: prev.boards.map((b) =>
          b.round !== payload.round
            ? b
            : b.guesses.some((g) => g.movieId === payload.guess.movieId)
              ? // Our own echo of a guess we already applied optimistically.
                { ...b, state: payload.state, answer: payload.answer ?? b.answer }
              : {
                  ...b,
                  guesses: [...b.guesses, payload.guess],
                  state: payload.state,
                  answer: payload.answer ?? b.answer,
                }
        ),
      };
    });
  });

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (!partner) {
    return (
      <Screen>
        <SubScreenHeader title="Picture Night" onBack={() => router.back()} />
        <Empty line="Picture Night is for two. Invite your person to play along." />
      </Screen>
    );
  }

  const isToday = data ? data.date === data.today : false;

  return (
    <Screen>
      <SubScreenHeader title="Picture Night" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.dateRow}>
          <Pressable onPress={() => setDate((d) => shiftDay(d, -1))} hitSlop={8} style={styles.arrow}>
            <ChevronLeft size={20} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={() => setCalendarOpen(true)} style={styles.dateLabel}>
            <CalendarDays size={15} color={colors.accent} strokeWidth={1.75} />
            <Text style={styles.dateText}>{isToday ? 'Tonight' : prettyDay(date)}</Text>
          </Pressable>
          <Pressable
            onPress={() => !isToday && setDate((d) => shiftDay(d, 1))}
            hitSlop={8}
            style={[styles.arrow, isToday && styles.arrowOff]}
          >
            <ChevronRight size={20} color={isToday ? colors.inkFaint : colors.ink} strokeWidth={1.75} />
          </Pressable>
        </View>

        {failed && <ErrorState onRetry={() => load(date).catch(() => setFailed(true))} />}
        {!data && !failed && (
          <>
            <Skeleton height={180} style={{ marginBottom: sp.lg }} />
            <Skeleton height={180} />
          </>
        )}

        {data?.boards.map((board) => (
          <BoardCard
            key={board.round}
            board={board}
            date={data.date}
            maxAttempts={data.maxAttempts}
            meId={user?.id ?? ''}
            partnerName={partner.display_name}
            onGuessed={(round, guess, state, answer) =>
              setData((prev) =>
                prev
                  ? {
                      ...prev,
                      boards: prev.boards.map((b) =>
                        b.round === round
                          ? { ...b, guesses: [...b.guesses, guess], state, answer: answer ?? b.answer }
                          : b
                      ),
                    }
                  : prev
              )
            }
          />
        ))}
      </ScrollView>

      <Sheet visible={calendarOpen} onClose={() => setCalendarOpen(false)} title="Play another night">
        {data && (
          <MonthCalendar
            month={data.month}
            today={data.today}
            selected={data.date}
            marks={data.marks}
            onPick={(d) => {
              setCalendarOpen(false);
              setDate(d);
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}

/**
 * One board. Sealed oxblood while it is live (the same grammar This-or-That's
 * unplayed card uses), settling to a light card on the reveal.
 */
function BoardCard({
  board,
  date,
  maxAttempts,
  meId,
  partnerName,
  onGuessed,
}: {
  board: Board;
  date: string;
  maxAttempts: number;
  meId: string;
  partnerName: string;
  onGuessed: (round: number, g: Guess, s: BoardState, a: Board['answer']) => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Autocomplete against the catalogue only, so a guess is always a real film.
  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api<{ results: Result[] }>(`/api/picture-night?search=${encodeURIComponent(term.trim())}`)
        .then((r) => {
          // Ignore a slow response that a newer keystroke has already replaced.
          if (mine === seq.current) setResults(r.results);
        })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [term]);

  const submit = async (movieId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    tapHaptic();
    try {
      const res = await api<{ guess: Guess; state: BoardState; answer: Board['answer'] }>('/api/picture-night', {
        method: 'POST',
        body: { date, round: board.round, movieId },
      });
      setTerm('');
      setResults([]);
      if (res.guess.correct) successHaptic();
      onGuessed(board.round, res.guess, res.state, res.answer);
    } catch (err: any) {
      setError(err?.message ?? 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  const { state } = board;
  const sealed = !state.over;
  const heading = board.round === 1 ? 'The first mystery' : 'The second mystery';

  return (
    <Card sealed={sealed} style={styles.board}>
      <Text style={[styles.kicker, sealed && styles.kickerSealed]}>{heading}</Text>

      {state.over ? (
        <>
          <Text style={styles.verdict}>
            {state.solved
              ? state.solvedBy === meId
                ? 'You got it.'
                : `${partnerName} got it.`
              : 'That one got away.'}
          </Text>
          {board.answer && (
            <Text style={styles.answer}>
              {board.answer.title} · {board.answer.year}
            </Text>
          )}
          <Text style={styles.subtle}>
            {state.solved
              ? `Solved in ${state.attemptsUsed} of ${maxAttempts}, between you.`
              : `All ${maxAttempts} guesses spent.`}
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.prompt, styles.promptSealed]}>
            One film. Guess it together, {state.attemptsLeft} {state.attemptsLeft === 1 ? 'try' : 'tries'} left between
            you.
          </Text>
          <View style={styles.pips}>
            {Array.from({ length: maxAttempts }, (_, i) => (
              <View key={i} style={[styles.pip, i < state.attemptsUsed && styles.pipSpent]} />
            ))}
          </View>
        </>
      )}

      {board.hints.length > 0 && !state.over && (
        <View style={styles.hints}>
          {board.hints.map((hint) => (
            <Text key={hint.label} style={styles.hint}>
              ✦ {hint.label}: {hint.value}
            </Text>
          ))}
        </View>
      )}

      {board.guesses.length > 0 && (
        <View style={styles.guesses}>
          {board.guesses.map((g) => (
            <GuessRow key={g.movieId} guess={g} sealed={sealed} mine={g.by === meId} partnerName={partnerName} />
          ))}
        </View>
      )}

      {!state.over && (
        <View style={styles.search}>
          <View style={[styles.searchBox, sealed && styles.searchBoxSealed]}>
            <Search size={16} color={sealed ? colors.onSealed : colors.inkFaint} strokeWidth={1.75} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder="Name a film"
              placeholderTextColor={sealed ? 'rgba(249, 239, 220, 0.5)' : colors.inkFaint}
              style={[styles.input, sealed && { color: colors.onSealed }]}
              autoCorrect={false}
            />
            {busy && <ActivityIndicator size="small" color={sealed ? colors.onSealed : colors.accent} />}
          </View>
          {results.map((r) => (
            <Pressable key={r.id} onPress={() => submit(r.id)} style={styles.result}>
              {/* The year is always shown: 37 titles in this catalogue repeat
                  (Don three times), so a bare title would be ambiguous. */}
              <Text style={[styles.resultText, sealed && { color: colors.onSealed }]} numberOfLines={1}>
                {r.title} <Text style={styles.resultYear}>({r.year})</Text>
              </Text>
            </Pressable>
          ))}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      )}
    </Card>
  );
}

function GuessRow({
  guess,
  sealed,
  mine,
  partnerName,
}: {
  guess: Guess;
  sealed: boolean;
  mine: boolean;
  partnerName: string;
}) {
  return (
    <View style={styles.guess}>
      <View style={styles.guessHead}>
        <Text style={[styles.guessTitle, sealed && { color: colors.onSealed }]} numberOfLines={1}>
          {guess.title} <Text style={styles.resultYear}>({guess.year})</Text>
        </Text>
        <Text style={styles.guessBy}>{mine ? 'you' : partnerName}</Text>
      </View>
      <View style={styles.tiles}>
        {guess.tiles.map((t) => (
          <View
            key={t.key}
            style={[
              styles.tile,
              t.state === 'hit' && styles.tileHit,
              t.state === 'near' && styles.tileNear,
              t.state === 'miss' && (sealed ? styles.tileMissSealed : styles.tileMiss),
            ]}
          >
            <Text style={styles.tileLabel}>{TILE_LABEL[t.key]}</Text>
            <Text style={styles.tileValue} numberOfLines={1}>
              {t.key === 'year'
                ? `${t.value}${t.direction === 'up' ? ' ↑' : t.direction === 'down' ? ' ↓' : ''}`
                : t.shared.length > 0
                  ? t.shared.join(', ')
                  : t.state === 'hit'
                    ? t.value
                    : '·'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The archive. A day is markable only once it has been played. */
function MonthCalendar({
  month,
  today,
  selected,
  marks,
  onPick,
}: {
  month: string;
  today: string;
  selected: string;
  marks: Data['marks'];
  onPick: (day: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first, matching the rest of the app's weeks.
  const lead = (first.getUTCDay() + 6) % 7;

  const byDay = useMemo(() => {
    const map = new Map<string, { solved: number; played: number }>();
    for (const mk of marks) {
      const cur = map.get(mk.day) ?? { solved: 0, played: 0 };
      cur.played += 1;
      if (mk.solved) cur.solved += 1;
      map.set(mk.day, cur);
    }
    return map;
  }, [marks]);

  return (
    <View>
      <View style={styles.weekHead}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={styles.weekLabel}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {Array.from({ length: lead }, (_, i) => (
          <View key={`lead-${i}`} style={styles.cell} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, '0')}`;
          const future = day > today;
          const mark = byDay.get(day);
          return (
            <Pressable
              key={day}
              disabled={future}
              onPress={() => onPick(day)}
              style={[styles.cell, day === selected && styles.cellOn]}
            >
              <Text style={[styles.cellText, future && styles.cellFuture, day === selected && styles.cellTextOn]}>
                {mark?.solved ? '♥' : i + 1}
              </Text>
              {mark && !mark.solved && <View style={styles.cellDot} />}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.legend}>♥ solved together · a dot means you played but did not get it</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: sp.base, paddingBottom: sp.xxxl, width: '100%', maxWidth: 680, alignSelf: 'center' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.md, marginBottom: sp.lg },
  arrow: { padding: sp.xs },
  arrowOff: { opacity: 0.4 },
  dateLabel: { flexDirection: 'row', alignItems: 'center', gap: sp.xs, paddingHorizontal: sp.md, paddingVertical: 4 },
  dateText: { ...text.subtitle, fontSize: 16 },

  board: { marginBottom: sp.lg },
  kicker: { ...text.micro, color: colors.accent, marginBottom: sp.sm },
  kickerSealed: { color: colors.accent },
  prompt: { ...text.bodySerif, marginBottom: sp.md },
  promptSealed: { color: colors.onSealed },
  verdict: { ...text.title, fontSize: 20, marginBottom: sp.xs },
  answer: { ...text.bodySerif, color: colors.accent, marginBottom: sp.xs },
  subtle: { ...text.caption, color: colors.inkMuted },

  pips: { flexDirection: 'row', gap: 6, marginBottom: sp.md },
  pip: { width: 18, height: 4, borderRadius: radius.hairline, backgroundColor: 'rgba(249, 239, 220, 0.35)' },
  pipSpent: { backgroundColor: colors.accent },

  hints: { marginBottom: sp.md, gap: 2 },
  hint: { ...text.caption, color: colors.accent },

  guesses: { gap: sp.sm, marginBottom: sp.md },
  guess: { gap: 4 },
  guessHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.sm },
  guessTitle: { ...text.body, fontWeight: '600', flexShrink: 1 },
  guessBy: { ...text.micro, color: colors.inkFaint },
  tiles: { flexDirection: 'row', gap: 4 },
  tile: { flex: 1, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 6, minWidth: 0 },
  // Olive for a hit, gold for warm: the palette's own positive and flourish
  // colors, rather than importing a traffic-light green and yellow.
  tileHit: { backgroundColor: colors.positive },
  tileNear: { backgroundColor: colors.accent },
  tileMiss: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hairline },
  tileMissSealed: { backgroundColor: 'rgba(249, 239, 220, 0.12)' },
  tileLabel: { ...text.micro, fontSize: 9, color: 'rgba(249, 239, 220, 0.8)' },
  tileValue: { ...text.micro, textTransform: 'none', letterSpacing: 0, color: colors.onSealed, fontSize: 11 },

  search: { gap: 2 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: sp.md,
    paddingVertical: 8,
    backgroundColor: colors.surfaceRaised,
  },
  searchBoxSealed: { backgroundColor: 'rgba(249, 239, 220, 0.10)', borderColor: 'rgba(249, 239, 220, 0.25)' },
  input: { flex: 1, ...text.body, color: colors.ink, outlineStyle: 'none' as any, minWidth: 0 },
  result: { paddingVertical: 7, paddingHorizontal: sp.md },
  resultText: { ...text.body },
  resultYear: { color: colors.inkFaint },
  error: { ...text.caption, color: colors.danger, marginTop: sp.xs },

  weekHead: { flexDirection: 'row', marginBottom: sp.xs },
  weekLabel: { ...text.micro, color: colors.inkFaint, width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellOn: { backgroundColor: colors.surfaceSealed, borderRadius: radius.sm },
  cellText: { ...text.body, color: colors.ink },
  cellTextOn: { color: colors.onSealed },
  cellFuture: { color: colors.inkFaint, opacity: 0.4 },
  cellDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent, marginTop: 2 },
  legend: { ...text.caption, color: colors.inkMuted, marginTop: sp.md },
});
