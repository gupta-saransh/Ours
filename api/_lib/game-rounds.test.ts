import { describe, expect, it } from 'vitest';
import { hasUnplayedRound, roundStateFor, ROUND_TWO_DELAY_MS, type AnswerRow } from './game-rounds';

const NOW = Date.parse('2026-07-19T18:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function row(userId: string, over: Partial<AnswerRow> = {}): AnswerRow {
  return {
    user_id: userId,
    pick: 'a',
    guess: 'b',
    pick2: null,
    guess2: null,
    created_at: ago(0),
    ...over,
  };
}

describe('ROUND_TWO_DELAY_MS', () => {
  it('is three hours, not the old twelve', () => {
    expect(ROUND_TWO_DELAY_MS).toBe(3 * 60 * 60 * 1000);
  });
});

describe('roundStateFor', () => {
  it('keeps round one open while only one partner has played', () => {
    expect(roundStateFor([row('A')], NOW)).toMatchObject({ round: 1, opensAt: null });
  });

  it('holds round one until the delay has passed after the LATER answer', () => {
    const rows = [row('A', { created_at: ago(ROUND_TWO_DELAY_MS + 60_000) }), row('B', { created_at: ago(60_000) })];
    const state = roundStateFor(rows, NOW);
    expect(state.round).toBe(1);
    // Measured from B's answer (the later one), not A's.
    expect(Date.parse(state.opensAt!)).toBe(NOW - 60_000 + ROUND_TWO_DELAY_MS);
  });

  it('opens round two once the delay has elapsed', () => {
    const rows = [
      row('A', { created_at: ago(ROUND_TWO_DELAY_MS + 60_000) }),
      row('B', { created_at: ago(ROUND_TWO_DELAY_MS + 30_000) }),
    ];
    expect(roundStateFor(rows, NOW)).toMatchObject({ round: 2, opensAt: null });
  });

  it('opens round two three hours in, where the old twelve-hour rule still would not have', () => {
    const threeHoursAgo = ago(3 * 60 * 60 * 1000 + 1000);
    const rows = [row('A', { created_at: threeHoursAgo }), row('B', { created_at: threeHoursAgo })];
    expect(roundStateFor(rows, NOW).round).toBe(2);
  });

  it('stays on round one when a timestamp is unreadable, rather than letting NaN decide', () => {
    const rows = [row('A', { created_at: 'not-a-date' }), row('B', { created_at: 'also-not' })];
    expect(roundStateFor(rows, NOW).round).toBe(1);
  });
});

describe('hasUnplayedRound', () => {
  it('is true for someone who has not played at all', () => {
    expect(hasUnplayedRound([], 'A', NOW)).toBe(true);
    expect(hasUnplayedRound([row('B')], 'A', NOW)).toBe(true);
  });

  it('is false once you have played round one and it is still round one', () => {
    expect(hasUnplayedRound([row('A')], 'A', NOW)).toBe(false);
  });

  it('is false while waiting on your partner, since a nudge to you cannot fix that', () => {
    // A has played, B has not. Round one is still the open round, and A has
    // answered it, so A must not be pushed.
    expect(hasUnplayedRound([row('A')], 'A', NOW)).toBe(false);
  });

  it('is false in the gap after both played round one but before round two opens', () => {
    const rows = [row('A', { created_at: ago(60_000) }), row('B', { created_at: ago(60_000) })];
    expect(hasUnplayedRound(rows, 'A', NOW)).toBe(false);
    expect(hasUnplayedRound(rows, 'B', NOW)).toBe(false);
  });

  it('is true once round two opens and you have not answered it', () => {
    const old = ago(ROUND_TWO_DELAY_MS + 60_000);
    const rows = [row('A', { created_at: old }), row('B', { created_at: old })];
    expect(hasUnplayedRound(rows, 'A', NOW)).toBe(true);
  });

  it('is false once you have answered round two, even if your partner has not', () => {
    const old = ago(ROUND_TWO_DELAY_MS + 60_000);
    const rows = [row('A', { created_at: old, pick2: 'a', guess2: 'b' }), row('B', { created_at: old })];
    expect(hasUnplayedRound(rows, 'A', NOW)).toBe(false);
    expect(hasUnplayedRound(rows, 'B', NOW)).toBe(true);
  });

  it('is false for both once both rounds are fully played', () => {
    const old = ago(ROUND_TWO_DELAY_MS + 60_000);
    const rows = [
      row('A', { created_at: old, pick2: 'a', guess2: 'b' }),
      row('B', { created_at: old, pick2: 'b', guess2: 'a' }),
    ];
    expect(hasUnplayedRound(rows, 'A', NOW)).toBe(false);
    expect(hasUnplayedRound(rows, 'B', NOW)).toBe(false);
  });
});
