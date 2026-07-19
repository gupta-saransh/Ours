import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

/**
 * Delete test accounts and everything in their spaces.
 *
 *   npx tsx scripts/delete-test-users.ts               # DRY RUN, changes nothing
 *   npx tsx scripts/delete-test-users.ts --confirm     # actually deletes
 *   npx tsx scripts/delete-test-users.ts --names=a,b   # override the name list
 *
 * The dry run is the default on purpose: it performs the whole cleanup inside a
 * transaction and then rolls it back, so the row counts it prints are real
 * rather than estimates, and nothing is saved. Run it first.
 *
 * TWO THINGS ABOUT THIS SCHEMA make a naive `DELETE FROM users` wrong:
 *
 *  1. There are no foreign keys and no cascades anywhere. Deleting a user row
 *     leaves their memories, notes, messages, todos, hearts, reactions and game
 *     answers behind forever, pointing at an id that no longer exists. They
 *     keep counting toward the admin dashboard's totals.
 *  2. Content is owned by the COUPLE, not the user. Nearly every table is keyed
 *     on couple_id, so the unit worth deleting is the space, not the person.
 *
 * So this deletes whole couples, and only couples where EVERY member is on the
 * target list. A test account paired with a real account is reported and its
 * couple is left intact, because deleting it would take the real person's data
 * too; only that test account's own authored rows are removed.
 *
 * Names match exactly and case-insensitively (never LIKE), so a real "Animesh"
 * is not caught by "ani", and "Testarossa" is not caught by "test".
 *
 * NOTE ON THE ID SETS: the doomed user and couple ids are resolved ONCE up
 * front and then passed to every statement as arrays. An earlier version used
 * TEMP TABLEs, which CockroachDB only supports behind an experimental flag
 * (`SET experimental_enable_temp_tables`). Arrays need no flag, and the sets
 * are small, so there is nothing to gain by turning an experimental feature on.
 */

const DEFAULT_NAMES = ['test', 'test3', 'ani', 'dum', 'dum1', 'dum2'];

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const namesArg = args.find((a) => a.startsWith('--names='));
const NAMES = (namesArg ? namesArg.slice('--names='.length).split(',') : DEFAULT_NAMES)
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);

/**
 * One statement in the cleanup. `scope` says which id array it binds to $1:
 * 'couples' for "everything in these doomed spaces", 'users' for "everything
 * belonging to these doomed people, wherever it lives".
 */
interface Step {
  label: string;
  scope: 'users' | 'couples';
  sql: string;
}

// Rows found by joining to a PARENT row must go before that parent does.
const CHILD_STEPS: Step[] = [
  {
    label: 'message_reactions (in doomed spaces)',
    scope: 'couples',
    sql: `DELETE FROM message_reactions WHERE message_id IN (
            SELECT id FROM messages WHERE couple_id = ANY($1::UUID[]))`,
  },
  {
    label: 'comment_hearts (in doomed spaces)',
    scope: 'couples',
    sql: `DELETE FROM comment_hearts WHERE comment_id IN (
            SELECT id FROM memory_comments WHERE couple_id = ANY($1::UUID[]))`,
  },
  {
    label: 'memory_hearts (in doomed spaces)',
    scope: 'couples',
    sql: `DELETE FROM memory_hearts WHERE memory_id IN (
            SELECT id FROM memories WHERE couple_id = ANY($1::UUID[]))`,
  },
  {
    label: 'note_hearts (in doomed spaces)',
    scope: 'couples',
    sql: `DELETE FROM note_hearts WHERE note_id IN (
            SELECT id FROM love_notes WHERE couple_id = ANY($1::UUID[]))`,
  },
  // Reactions/hearts these users left anywhere else. There should be none (every
  // query is couple-scoped), but an orphan would keep inflating someone's counts.
  { label: 'memory_hearts (by doomed users)', scope: 'users', sql: `DELETE FROM memory_hearts WHERE user_id = ANY($1::UUID[])` },
  { label: 'note_hearts (by doomed users)', scope: 'users', sql: `DELETE FROM note_hearts WHERE user_id = ANY($1::UUID[])` },
  { label: 'comment_hearts (by doomed users)', scope: 'users', sql: `DELETE FROM comment_hearts WHERE user_id = ANY($1::UUID[])` },
  { label: 'message_reactions (by doomed users)', scope: 'users', sql: `DELETE FROM message_reactions WHERE user_id = ANY($1::UUID[])` },
];

const COUPLE_TABLES = [
  'memory_comments',
  'memories',
  'love_notes',
  'messages',
  'todos',
  'milestones',
  'notifications',
  'bucket_items',
  'wishlist_items',
  'date_proposals',
  'date_ideas',
  'daily_prompt_answers',
  'daily_game_answers',
  'weekly_reflections',
];

// Content authored by a doomed user inside a space that SURVIVES (the mixed
// test/real couples). Their user row is about to vanish, so this content would
// otherwise be authored by a ghost.
const AUTHORED_STEPS: Step[] = (
  [
    ['memory_comments', 'author_id'],
    ['memories', 'author_id'],
    ['love_notes', 'author_id'],
    ['milestones', 'author_id'],
    ['bucket_items', 'author_id'],
    ['todos', 'author_id'],
    ['messages', 'sender_id'],
    ['notifications', 'actor_id'],
    ['daily_prompt_answers', 'user_id'],
    ['daily_game_answers', 'user_id'],
  ] as const
).map(([table, col]) => ({
  label: `${table} (authored by doomed users elsewhere)`,
  scope: 'users' as const,
  sql: `DELETE FROM ${table} WHERE ${col} = ANY($1::UUID[])`,
}));

// Surviving rows that merely POINT at a doomed user: blank the pointer instead
// of deleting the row, or a real partner loses a to-do because a test account
// happened to be assigned to it.
const NULLING_STEPS: Step[] = [
  { label: 'todos.assignee_id -> NULL', scope: 'users', sql: `UPDATE todos SET assignee_id = NULL WHERE assignee_id = ANY($1::UUID[])` },
  { label: 'todos.done_by -> NULL', scope: 'users', sql: `UPDATE todos SET done_by = NULL WHERE done_by = ANY($1::UUID[])` },
  { label: 'milestones.person_id -> NULL', scope: 'users', sql: `UPDATE milestones SET person_id = NULL WHERE person_id = ANY($1::UUID[])` },
  { label: 'users.referred_by -> NULL', scope: 'users', sql: `UPDATE users SET referred_by = NULL WHERE referred_by = ANY($1::UUID[])` },
];

const ALL_STEPS: Step[] = [
  ...CHILD_STEPS,
  ...COUPLE_TABLES.map((t) => ({
    label: `${t} (whole doomed spaces)`,
    scope: 'couples' as const,
    sql: `DELETE FROM ${t} WHERE couple_id = ANY($1::UUID[])`,
  })),
  ...AUTHORED_STEPS,
  ...NULLING_STEPS,
  { label: 'users', scope: 'users', sql: `DELETE FROM users WHERE id = ANY($1::UUID[])` },
  { label: 'couples', scope: 'couples', sql: `DELETE FROM couples WHERE id = ANY($1::UUID[])` },
];

interface DoomedUser {
  id: string;
  couple_id: string | null;
  display_name: string;
  email: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('user:password@host')) {
    console.error('Set DATABASE_URL in .env before running this.');
    process.exit(1);
  }
  if (NAMES.length === 0) {
    console.error('No names to match. Pass --names=a,b or edit DEFAULT_NAMES.');
    process.exit(1);
  }

  console.log(`\nTarget names (exact, case-insensitive): ${NAMES.join(', ')}`);
  console.log(confirmed ? 'Mode: \x1b[31mCONFIRMED — this will commit\x1b[0m\n' : 'Mode: DRY RUN (nothing will be saved)\n');

  const pool = new Pool({ connectionString: url, max: 1 });
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: doomedUsers } = await client.query<DoomedUser>(
      `SELECT id, couple_id, display_name, email
       FROM users WHERE lower(display_name) = ANY($1::STRING[]) ORDER BY display_name`,
      [NAMES]
    );

    if (doomedUsers.length === 0) {
      console.log('No users matched those names. Nothing to do.');
      await client.query('ROLLBACK');
      return;
    }

    const userIds = doomedUsers.map((u) => u.id);

    // Only spaces where EVERY member is on the list.
    const { rows: doomedCouples } = await client.query<{ id: string }>(
      `SELECT DISTINCT u.couple_id AS id
       FROM users u
       WHERE u.id = ANY($1::UUID[])
         AND u.couple_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM users other
           WHERE other.couple_id = u.couple_id AND NOT (other.id = ANY($1::UUID[])))`,
      [userIds]
    );
    const coupleIds = doomedCouples.map((c) => c.id);

    // --- who matched ------------------------------------------------------
    const { rows: counts } = await client.query<{ couple_id: string; members: number }>(
      `SELECT couple_id, count(*)::INT AS members FROM users
       WHERE couple_id = ANY($1::UUID[]) GROUP BY couple_id`,
      [doomedUsers.map((u) => u.couple_id).filter((c): c is string => !!c)]
    );
    const membersByCouple = new Map(counts.map((c) => [c.couple_id, c.members]));

    console.log(`Matched ${doomedUsers.length} user(s):`);
    for (const u of doomedUsers) {
      const space = u.couple_id ? `space ${u.couple_id.slice(0, 8)}… (${membersByCouple.get(u.couple_id) ?? 0} member(s))` : 'no space';
      console.log(`  - ${u.display_name}  <${u.email}>  ${space}`);
    }

    // --- the safety check -------------------------------------------------
    const { rows: mixed } = await client.query<{ test_account: string; paired_with: string; paired_email: string }>(
      `SELECT d.display_name AS test_account, o.display_name AS paired_with, o.email AS paired_email
       FROM users d
       JOIN users o ON o.couple_id = d.couple_id AND o.id <> d.id
       WHERE d.id = ANY($1::UUID[]) AND NOT (o.id = ANY($1::UUID[]))`,
      [userIds]
    );
    if (mixed.length > 0) {
      console.log('\n\x1b[33mHeads up: these test accounts share a space with someone NOT on the list.\x1b[0m');
      console.log('Their couple and its shared content will be KEPT. Only the test account and');
      console.log('the rows it authored are removed.');
      for (const m of mixed) {
        console.log(`  - "${m.test_account}" is paired with "${m.paired_with}" <${m.paired_email}>`);
      }
    }

    console.log(`\nWhole spaces to be deleted: ${coupleIds.length}\n`);

    // --- run every step, reporting what it touched ------------------------
    let total = 0;
    for (const step of ALL_STEPS) {
      const ids = step.scope === 'users' ? userIds : coupleIds;
      if (ids.length === 0) continue; // nothing to match; skip the round trip
      const res = await client.query(step.sql, [ids]);
      const n = res.rowCount ?? 0;
      total += n;
      if (n > 0) console.log(`  ${String(n).padStart(6)}  ${step.label}`);
    }
    console.log(`\n  ${String(total).padStart(6)}  rows affected in total`);

    if (confirmed) {
      await client.query('COMMIT');
      console.log('\n\x1b[32mCommitted. This is permanent.\x1b[0m\n');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run complete, nothing was saved.');
      console.log('If the numbers above look right, run it again with \x1b[1m--confirm\x1b[0m.\n');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
