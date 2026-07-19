import { describe, expect, it } from 'vitest';
import {
  activeSpacesSpark,
  buildActivitySeries,
  buildCoupleRows,
  contentMix,
  countActiveSince,
  deltaPct,
  flowKpi,
  lastNDays,
  levelKpi,
  NAME_DELIM,
  unionAllSources,
} from './admin-aggregate';

const SOURCES = ['messages', 'memories', 'notes'];

describe('lastNDays', () => {
  it('returns n days ending today, oldest first', () => {
    expect(lastNDays(3, '2026-07-19T22:00:00Z')).toEqual(['2026-07-17', '2026-07-18', '2026-07-19']);
  });

  it('crosses a month boundary correctly', () => {
    expect(lastNDays(3, '2026-08-01T00:00:00Z')).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
  });

  it('returns nothing for a non-positive window', () => {
    expect(lastNDays(0, '2026-07-19')).toEqual([]);
    expect(lastNDays(-5, '2026-07-19')).toEqual([]);
  });
});

describe('buildActivitySeries', () => {
  const days = ['2026-07-17', '2026-07-18', '2026-07-19'];

  it('zero-fills days with nothing, so a quiet stretch keeps its real width', () => {
    const out = buildActivitySeries(days, [{ day: '2026-07-18', src: 'messages', n: 4 }], SOURCES);
    expect(out.map((d) => d.total)).toEqual([0, 4, 0]);
    expect(out[0].counts).toEqual({ messages: 0, memories: 0, notes: 0 });
  });

  it('sums multiple rows for the same day and source', () => {
    const out = buildActivitySeries(
      days,
      [
        { day: '2026-07-19', src: 'messages', n: 2 },
        { day: '2026-07-19', src: 'messages', n: 3 },
      ],
      SOURCES
    );
    expect(out[2].counts.messages).toBe(5);
  });

  it('ignores rows outside the window rather than distorting it', () => {
    const out = buildActivitySeries(days, [{ day: '2026-01-01', src: 'messages', n: 99 }], SOURCES);
    expect(out.reduce((a, d) => a + d.total, 0)).toBe(0);
  });

  it('ignores an unknown source rather than silently inflating the total', () => {
    const out = buildActivitySeries(days, [{ day: '2026-07-19', src: 'nope', n: 7 }], SOURCES);
    expect(out[2].total).toBe(0);
  });
});

describe('deltaPct', () => {
  it('computes a rounded percent change', () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(100, 100)).toBe(0);
  });

  it('returns null with no baseline, rather than Infinity on the card', () => {
    expect(deltaPct(10, 0)).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(deltaPct(Number.NaN, 10)).toBeNull();
    expect(deltaPct(10, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('flowKpi / levelKpi', () => {
  it('sums the sparkline for a flow', () => {
    const k = flowKpi([1, 2, 3], 3);
    expect(k.value).toBe(6);
    expect(k.deltaPct).toBe(100);
  });

  it('takes the value as given for a level, not the sum', () => {
    const k = levelKpi(7, 5, [1, 1, 1]);
    expect(k.value).toBe(7);
    expect(k.deltaPct).toBe(40);
  });

  it('survives an empty sparkline', () => {
    expect(flowKpi([], 0)).toMatchObject({ value: 0, deltaPct: null });
  });
});

describe('activeSpacesSpark', () => {
  it('counts DISTINCT spaces per day, not rows', () => {
    const days = ['2026-07-18', '2026-07-19'];
    const rows = [
      { day: '2026-07-18', couple_id: 'a' },
      { day: '2026-07-18', couple_id: 'a' },
      { day: '2026-07-18', couple_id: 'b' },
      { day: '2026-07-19', couple_id: 'a' },
    ];
    expect(activeSpacesSpark(days, rows)).toEqual([2, 1]);
  });

  it('zero-fills a day nobody touched', () => {
    expect(activeSpacesSpark(['2026-07-18'], [])).toEqual([0]);
  });
});

describe('buildCoupleRows', () => {
  const A = 'aaaaaaaa-1111-2222-3333-444444444444';
  const B = 'bbbbbbbb-1111-2222-3333-444444444444';
  const couples = [
    { id: A, created_at: '2026-07-11', encrypted: true, streak: 3 },
    { id: B, created_at: '2026-07-14', encrypted: true },
  ];
  const members = [
    { couple_id: A, members: 2, names: `Anisha${NAME_DELIM}Saransh` },
    { couple_id: B, members: 1, names: 'Gaurav Chandak' },
  ];

  it('splits member names on the control delimiter', () => {
    const rows = buildCoupleRows(couples, [], [], members, SOURCES);
    expect(rows.find((r) => r.id === 'aaaaaaaa')!.names).toEqual(['Anisha', 'Saransh']);
  });

  it('keeps a single name intact', () => {
    const rows = buildCoupleRows(couples, [], [], members, SOURCES);
    expect(rows.find((r) => r.members === 1)!.names).toEqual(['Gaurav Chandak']);
  });

  it('does NOT split a name containing a comma or plus sign', () => {
    // Precisely why the delimiter is a control character, not ', ' or ' + '.
    const rows = buildCoupleRows([couples[0]], [], [], [{ couple_id: A, members: 1, names: 'Ben, Jr. + Co' }], SOURCES);
    expect(rows[0].names).toEqual(['Ben, Jr. + Co']);
  });

  it('truncates the id so a full couple id never reaches the client', () => {
    const rows = buildCoupleRows([couples[0]], [], [], members, SOURCES);
    expect(rows[0].id).toBe('aaaaaaaa');
    expect(rows[0].id.length).toBe(8);
  });

  it('ranks busiest first', () => {
    const counts = [
      { couple_id: B, src: 'messages', n: 100 },
      { couple_id: A, src: 'messages', n: 5 },
    ];
    const rows = buildCoupleRows(couples, counts, [], members, SOURCES);
    expect(rows[0].total).toBe(100);
    expect(rows[1].total).toBe(5);
  });

  it('breaks a tie by most recently active', () => {
    const counts = [
      { couple_id: A, src: 'messages', n: 5 },
      { couple_id: B, src: 'messages', n: 5 },
    ];
    const last = [
      { couple_id: A, last_active: '2026-07-01' },
      { couple_id: B, last_active: '2026-07-19' },
    ];
    const rows = buildCoupleRows(couples, counts, last, members, SOURCES);
    expect(rows[0].id).toBe('bbbbbbbb');
  });

  it('keeps a space that has made nothing, since a zero row is real signal', () => {
    const rows = buildCoupleRows(couples, [], [], members, SOURCES);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });

  it('flags a space with no members as empty', () => {
    const rows = buildCoupleRows([couples[0]], [], [], [], SOURCES);
    expect(rows[0].empty).toBe(true);
    expect(rows[0].members).toBe(0);
    expect(rows[0].names).toEqual([]);
  });

  it('does not flag a space that has members', () => {
    const rows = buildCoupleRows([couples[0]], [], [], members, SOURCES);
    expect(rows[0].empty).toBe(false);
  });

  it('zero-fills every source key so the stack strip never reads undefined', () => {
    const rows = buildCoupleRows([couples[0]], [{ couple_id: A, src: 'notes', n: 2 }], [], members, SOURCES);
    expect(rows[0].counts).toEqual({ messages: 0, memories: 0, notes: 2 });
  });

  it('defaults a missing streak to zero', () => {
    const rows = buildCoupleRows([couples[1]], [], [], members, SOURCES);
    expect(rows[0].streak).toBe(0);
  });
});

describe('countActiveSince', () => {
  it('counts only spaces active at or after the cutoff', () => {
    const rows = [
      { couple_id: 'a', last_active: '2026-07-19' },
      { couple_id: 'b', last_active: '2026-07-01' },
      { couple_id: 'c', last_active: null },
    ];
    expect(countActiveSince(rows, '2026-07-12')).toBe(1);
  });
});

describe('contentMix', () => {
  it('sorts largest first and drops zeroes', () => {
    expect(contentMix({ messages: 326, memories: 18, notes: 0 }, SOURCES)).toEqual([
      { src: 'messages', n: 326 },
      { src: 'memories', n: 18 },
    ]);
  });
});

describe('unionAllSources', () => {
  it('builds one UNION ALL over every table', () => {
    const sql = unionAllSources([
      { src: 'messages', table: 'messages' },
      { src: 'notes', table: 'love_notes' },
    ]);
    expect(sql).toContain("'messages' AS src FROM messages");
    expect(sql).toContain("'notes' AS src FROM love_notes");
    expect(sql.split('UNION ALL')).toHaveLength(2);
  });
});
