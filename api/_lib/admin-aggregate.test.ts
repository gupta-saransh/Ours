import { describe, expect, it } from 'vitest';
import {
  buildActivitySeries,
  buildCoupleRows,
  countActiveSince,
  lastNDays,
  unionAllSources,
} from './admin-aggregate';

describe('lastNDays', () => {
  it('ends on today and runs oldest first', () => {
    expect(lastNDays(3, '2026-07-19')).toEqual(['2026-07-17', '2026-07-18', '2026-07-19']);
  });

  it('crosses a month boundary', () => {
    expect(lastNDays(3, '2026-08-01')).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
  });

  it('crosses a leap day', () => {
    expect(lastNDays(2, '2028-03-01')).toEqual(['2028-02-29', '2028-03-01']);
  });

  it('accepts a full ISO timestamp and uses its date part', () => {
    expect(lastNDays(1, '2026-07-19T23:59:59.000Z')).toEqual(['2026-07-19']);
  });
});

describe('buildActivitySeries', () => {
  const sources = ['memories', 'notes'] as const;

  it('fills every day in the window, including zeroes', () => {
    const out = buildActivitySeries(['2026-07-18', '2026-07-19'], [{ day: '2026-07-19', src: 'memories', n: 3 }], sources);
    expect(out).toEqual([
      { day: '2026-07-18', counts: { memories: 0, notes: 0 }, total: 0 },
      { day: '2026-07-19', counts: { memories: 3, notes: 0 }, total: 3 },
    ]);
  });

  it('totals across sources within a day', () => {
    const out = buildActivitySeries(
      ['2026-07-19'],
      [
        { day: '2026-07-19', src: 'memories', n: 2 },
        { day: '2026-07-19', src: 'notes', n: 5 },
      ],
      sources
    );
    expect(out[0].total).toBe(7);
  });

  it('ignores rows for days outside the window', () => {
    const out = buildActivitySeries(['2026-07-19'], [{ day: '2026-01-01', src: 'memories', n: 99 }], sources);
    expect(out[0].total).toBe(0);
  });

  it('ignores an unknown source rather than inflating the total', () => {
    const out = buildActivitySeries(['2026-07-19'], [{ day: '2026-07-19', src: 'mystery', n: 99 }], sources);
    expect(out[0].total).toBe(0);
  });

  it('returns an empty series for an empty window', () => {
    expect(buildActivitySeries([], [{ day: '2026-07-19', src: 'memories', n: 1 }], sources)).toEqual([]);
  });
});

describe('buildCoupleRows', () => {
  const sources = ['memories', 'notes'] as const;
  const couples = [
    { id: 'aaaaaaaa-1111-2222-3333-444444444444', created_at: '2026-01-01', encrypted: true },
    { id: 'bbbbbbbb-1111-2222-3333-444444444444', created_at: '2026-02-01', encrypted: false },
  ];

  it('truncates the couple id to an 8-char opaque prefix', () => {
    const rows = buildCoupleRows(couples, [], [], [], sources);
    expect(rows.every((r) => r.id.length === 8)).toBe(true);
    expect(rows.map((r) => r.id)).toContain('aaaaaaaa');
  });

  it('sorts by total volume, biggest first', () => {
    const rows = buildCoupleRows(
      couples,
      [
        { couple_id: couples[0].id, src: 'memories', n: 1 },
        { couple_id: couples[1].id, src: 'memories', n: 9 },
      ],
      [],
      [],
      sources
    );
    expect(rows[0].id).toBe('bbbbbbbb');
    expect(rows[0].total).toBe(9);
  });

  it('keeps a couple that has made nothing, as a zero row', () => {
    const rows = buildCoupleRows(couples, [], [], [], sources);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ total: 0, counts: { memories: 0, notes: 0 }, last_active: null });
  });

  it('attaches member counts and last-active, defaulting when absent', () => {
    const rows = buildCoupleRows(
      couples,
      [],
      [{ couple_id: couples[0].id, last_active: '2026-07-19T10:00:00Z' }],
      [{ couple_id: couples[0].id, members: 2 }],
      sources
    );
    const first = rows.find((r) => r.id === 'aaaaaaaa')!;
    const second = rows.find((r) => r.id === 'bbbbbbbb')!;
    expect(first).toMatchObject({ members: 2, last_active: '2026-07-19T10:00:00Z' });
    expect(second).toMatchObject({ members: 0, last_active: null });
  });

  it('sums duplicate rows for the same couple and source', () => {
    const rows = buildCoupleRows(
      [couples[0]],
      [
        { couple_id: couples[0].id, src: 'memories', n: 2 },
        { couple_id: couples[0].id, src: 'memories', n: 3 },
      ],
      [],
      [],
      sources
    );
    expect(rows[0].counts.memories).toBe(5);
  });
});

describe('countActiveSince', () => {
  const since = '2026-07-12T00:00:00Z';

  it('counts only couples active at or after the cutoff', () => {
    const n = countActiveSince(
      [
        { couple_id: 'a', last_active: '2026-07-19T00:00:00Z' },
        { couple_id: 'b', last_active: '2026-07-01T00:00:00Z' },
        { couple_id: 'c', last_active: since },
      ],
      since
    );
    expect(n).toBe(2);
  });

  it('ignores couples that never did anything', () => {
    expect(countActiveSince([{ couple_id: 'a', last_active: null }], since)).toBe(0);
  });

  it('is zero for no couples', () => {
    expect(countActiveSince([], since)).toBe(0);
  });
});

describe('unionAllSources', () => {
  it('emits one tagged SELECT per source', () => {
    const sql = unionAllSources([
      { src: 'memories', table: 'memories' },
      { src: 'notes', table: 'love_notes' },
    ]);
    expect(sql).toBe(
      "SELECT couple_id, created_at, 'memories' AS src FROM memories UNION ALL " +
        "SELECT couple_id, created_at, 'notes' AS src FROM love_notes"
    );
  });
});
