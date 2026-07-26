import { describe, expect, it } from 'vitest';
import {
  activeSpacesSpark,
  buildActivitySeries,
  buildCoupleRows,
  buildPersonRows,
  contentMix,
  countActiveSince,
  deltaPct,
  featureAdoption,
  flowKpi,
  lastNDays,
  levelKpi,
  NAME_DELIM,
  unionAllPeople,
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

describe('unionAllSources with a where clause', () => {
  it('splits one table into two mutually exclusive sources', () => {
    const sql = unionAllSources([
      { src: 'messages', table: 'messages', where: 'audio_data IS NULL' },
      { src: 'voice', table: 'messages', where: 'audio_data IS NOT NULL' },
    ]);
    expect(sql).toContain("'messages' AS src FROM messages WHERE audio_data IS NULL");
    expect(sql).toContain("'voice' AS src FROM messages WHERE audio_data IS NOT NULL");
  });

  it('omits WHERE entirely for a source that has no filter', () => {
    expect(unionAllSources([{ src: 'notes', table: 'love_notes' }])).not.toContain('WHERE');
  });
});

describe('unionAllPeople', () => {
  it('projects each table own author column as user_id', () => {
    const sql = unionAllPeople([
      { src: 'messages', table: 'messages', userCol: 'sender_id' },
      { src: 'dates', table: 'date_proposals', userCol: 'proposer_id' },
    ]);
    expect(sql).toContain('SELECT sender_id AS user_id');
    expect(sql).toContain('SELECT proposer_id AS user_id');
  });

  it('skips a source with no author column rather than attributing it to nobody', () => {
    const sql = unionAllPeople([
      { src: 'messages', table: 'messages', userCol: 'sender_id' },
      { src: 'milestones', table: 'milestones' },
    ]);
    expect(sql).toContain('FROM messages');
    expect(sql).not.toContain('FROM milestones');
    expect(sql).not.toContain('UNION ALL');
  });

  it('keeps the where clause when splitting a table per author', () => {
    const sql = unionAllPeople([
      { src: 'voice', table: 'messages', where: 'audio_data IS NOT NULL', userCol: 'sender_id' },
    ]);
    expect(sql).toContain('FROM messages WHERE audio_data IS NOT NULL');
  });
});

const PSOURCES = ['messages', 'voice', 'notes'] as const;
const PEOPLE = [
  { id: 'aaaaaaaa-1111', display_name: 'Anisha', couple_id: 'cccccccc-9999' },
  { id: 'bbbbbbbb-2222', display_name: 'Saransh', couple_id: 'cccccccc-9999' },
  { id: 'dddddddd-3333', display_name: 'Nobody', couple_id: null },
];
const MEMBERS = [{ couple_id: 'cccccccc-9999', members: 2, names: `Anisha${NAME_DELIM}Saransh` }];

describe('buildPersonRows', () => {
  const rows = buildPersonRows(
    PEOPLE,
    [
      { user_id: 'aaaaaaaa-1111', src: 'messages', n: 40 },
      { user_id: 'aaaaaaaa-1111', src: 'voice', n: 9 },
      { user_id: 'bbbbbbbb-2222', src: 'messages', n: 12 },
    ],
    [{ user_id: 'aaaaaaaa-1111', src: 'voice', n: 2 }],
    [{ user_id: 'aaaaaaaa-1111', last_active: '2026-07-25T00:00:00.000Z' }],
    MEMBERS,
    PSOURCES
  );

  it('ranks by lifetime total, busiest first', () => {
    expect(rows.map((r) => r.name)).toEqual(['Anisha', 'Saransh', 'Nobody']);
    expect(rows[0].total).toBe(49);
  });

  it('fills every source with a zero so a table never has holes', () => {
    expect(rows[1].counts).toEqual({ messages: 12, voice: 0, notes: 0 });
  });

  it('keeps window counts separate from lifetime counts', () => {
    expect(rows[0].counts.voice).toBe(9);
    expect(rows[0].windowCounts.voice).toBe(2);
    expect(rows[0].windowTotal).toBe(2);
  });

  it('counts breadth as distinct features ever used', () => {
    expect(rows[0].featuresUsed).toBe(2);
    expect(rows[1].featuresUsed).toBe(1);
    expect(rows[2].featuresUsed).toBe(0);
  });

  it('keeps a person who has made nothing, and one with no space', () => {
    const nobody = rows.find((r) => r.name === 'Nobody')!;
    expect(nobody.total).toBe(0);
    expect(nobody.coupleId).toBeNull();
    expect(nobody.coupleName).toBe('');
  });

  it('resolves the space name from the delimited member list', () => {
    expect(rows[0].coupleName).toBe('Anisha + Saransh');
  });

  it('truncates ids the same way the couple leaderboard does', () => {
    expect(rows[0].id).toBe('aaaaaaaa');
    expect(rows[0].coupleId).toBe('cccccccc');
  });

  it('ignores a count row for a user that no longer exists', () => {
    const out = buildPersonRows(
      PEOPLE,
      [{ user_id: 'deleted-user', src: 'messages', n: 99 }],
      [],
      [],
      MEMBERS,
      PSOURCES
    );
    expect(out.every((r) => r.total === 0)).toBe(true);
  });
});

describe('featureAdoption', () => {
  const rows = buildPersonRows(
    PEOPLE,
    [
      { user_id: 'aaaaaaaa-1111', src: 'messages', n: 40 },
      { user_id: 'aaaaaaaa-1111', src: 'voice', n: 9 },
      { user_id: 'bbbbbbbb-2222', src: 'messages', n: 12 },
    ],
    [{ user_id: 'aaaaaaaa-1111', src: 'voice', n: 2 }],
    [],
    MEMBERS,
    PSOURCES
  );

  it('counts DISTINCT people, so one power user does not read as adoption', () => {
    const byS = Object.fromEntries(featureAdoption(rows, PSOURCES).map((a) => [a.src, a]));
    expect(byS.voice).toMatchObject({ users: 1, total: 9 });
    expect(byS.messages).toMatchObject({ users: 2, total: 52 });
  });

  it('reports window users apart from all-time users', () => {
    const voice = featureAdoption(rows, PSOURCES).find((a) => a.src === 'voice')!;
    expect(voice.users).toBe(1);
    expect(voice.windowUsers).toBe(1);
  });

  it('keeps a never-used feature in the list at zero, so it is visibly dead', () => {
    const notes = featureAdoption(rows, PSOURCES).find((a) => a.src === 'notes')!;
    expect(notes).toMatchObject({ src: 'notes', users: 0, total: 0 });
  });

  it('ranks by adoption, widest first', () => {
    expect(featureAdoption(rows, PSOURCES).map((a) => a.src)).toEqual(['messages', 'voice', 'notes']);
  });
});
