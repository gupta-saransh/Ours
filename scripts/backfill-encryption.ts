import 'dotenv/config';
import { q, one } from '../api/_lib/db';
import { encryptionEnabled, encryptField } from '../api/_lib/envelope';

/**
 * One-time backfill for envelope encryption (feature 4). Encrypts existing
 * plaintext values into their `_ct` columns and blanks the plaintext, so old
 * rows become encrypted at rest like new writes. Idempotent: it only touches
 * rows whose ciphertext is still null, so re-running is safe.
 *
 * Run AFTER `npm run migrate` (so the _ct columns exist) with the same
 * MASTER_ENCRYPTION_KEY and DATABASE_URL you use in production:
 *
 *   npx tsx scripts/backfill-encryption.ts
 *
 * Requires MASTER_ENCRYPTION_KEY to be set; without it there is nothing to do.
 */

interface Task {
  label: string;
  select: string; // must return id, couple_id, and the named plaintext columns
  fields: { plaintext: string; ct: string; blankTo: string | null }[];
}

const TASKS: Task[] = [
  {
    label: 'memories.note',
    select: `SELECT id, couple_id, note FROM memories WHERE note_ct IS NULL AND note <> ''`,
    fields: [{ plaintext: 'note', ct: 'note_ct', blankTo: '' }],
  },
  {
    label: 'love_notes.body',
    select: `SELECT id, couple_id, body FROM love_notes WHERE body_ct IS NULL AND body <> ''`,
    fields: [{ plaintext: 'body', ct: 'body_ct', blankTo: '' }],
  },
  {
    label: 'daily_prompt_answers.text',
    select: `SELECT id, couple_id, text FROM daily_prompt_answers WHERE text_ct IS NULL AND text <> ''`,
    fields: [{ plaintext: 'text', ct: 'text_ct', blankTo: '' }],
  },
  {
    label: 'wishlist_items (title/url/notes)',
    select: `SELECT id, couple_id, title, url, notes FROM wishlist_items
             WHERE title_ct IS NULL OR (url IS NOT NULL AND url_ct IS NULL) OR (notes IS NOT NULL AND notes_ct IS NULL)`,
    fields: [
      { plaintext: 'title', ct: 'title_ct', blankTo: '' },
      { plaintext: 'url', ct: 'url_ct', blankTo: null },
      { plaintext: 'notes', ct: 'notes_ct', blankTo: null },
    ],
  },
  {
    label: 'date_proposals (title/location)',
    select: `SELECT id, couple_id, title, location FROM date_proposals
             WHERE title_ct IS NULL OR (location IS NOT NULL AND location_ct IS NULL)`,
    fields: [
      { plaintext: 'title', ct: 'title_ct', blankTo: '' },
      { plaintext: 'location', ct: 'location_ct', blankTo: null },
    ],
  },
];

async function run() {
  if (!encryptionEnabled()) {
    console.error('MASTER_ENCRYPTION_KEY is not set. Set it (and DATABASE_URL) before backfilling.');
    process.exit(1);
  }

  for (const task of TASKS) {
    const rows = await q<Record<string, any>>(task.select);
    let touched = 0;
    for (const row of rows) {
      const sets: string[] = [];
      const params: unknown[] = [row.id];
      for (const f of task.fields) {
        const value = row[f.plaintext];
        if (typeof value !== 'string' || value.length === 0) continue; // nothing to encrypt
        const ct = await encryptField(row.couple_id, value);
        if (!ct) continue; // encryption disabled mid-run; skip
        params.push(ct);
        sets.push(`${f.ct} = $${params.length}`);
        params.push(f.blankTo);
        sets.push(`${f.plaintext} = $${params.length}`);
      }
      if (sets.length === 0) continue;
      const table = task.label.split(/[ .]/)[0];
      await one(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, params);
      touched++;
    }
    console.log(`${task.label}: encrypted ${touched} row(s).`);
  }
  console.log('Backfill complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
