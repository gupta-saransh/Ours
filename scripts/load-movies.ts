import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

/**
 * Loads the Picture Night film catalogue from the IMDB CSV into `movies`.
 *
 *   npx tsx scripts/load-movies.ts [path-to.csv] [--min-appearances=8]
 *
 * Idempotent: upserts on `imdb_id`, so re-running after tweaking the threshold
 * updates eligibility in place rather than duplicating the catalogue.
 *
 * THE FACTS ARE NEVER GENERATED. Every title, year, genre, director and cast
 * member comes from the supplied CSV. This script only parses, filters rows it
 * cannot use, and marks which films may be the mystery.
 *
 * ELIGIBILITY, and why it is a proxy: the source file carries no rating and no
 * vote count, so there is no direct popularity signal to rank by. The only
 * recognizability proxy the data supports is how often an actor recurs across
 * the catalogue: a film starring someone who appears in dozens of these is far
 * more likely to be one the couple has heard of than a one-off cast. A film is
 * eligible to BE the mystery when at least one of its cast appears in
 * `--min-appearances` films or more. EVERY film stays valid as a GUESS
 * regardless, so autocomplete always covers the whole catalogue.
 */

const DEFAULT_CSV = 'IMDB-Movie-Dataset(2023-1951).csv';
const DEFAULT_MIN_APPEARANCES = 8;

/** Minimal RFC-4180 parser: the overview column contains commas and quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

interface Row {
  imdb_id: string;
  title: string;
  year: number;
  genres: string[];
  director: string[];
  cast: string[];
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = path.resolve(args.find((a) => !a.startsWith('--')) ?? DEFAULT_CSV);
  const minArg = args.find((a) => a.startsWith('--min-appearances='));
  const minAppearances = minArg ? Number(minArg.split('=')[1]) : DEFAULT_MIN_APPEARANCES;

  if (!fs.existsSync(csvPath)) throw new Error(`No CSV at ${csvPath}`);
  const table = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const header = table[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const [iId, iTitle, iYear, iGenre, iDir, iCast] = [
    col('movie_id'),
    col('movie_name'),
    col('year'),
    col('genre'),
    col('director'),
    col('cast'),
  ];
  if ([iId, iTitle, iYear, iGenre, iDir, iCast].some((i) => i < 0)) {
    throw new Error(`CSV is missing an expected column. Found: ${header.join(', ')}`);
  }

  const skipped = { badYear: 0, noGenre: 0, thinCast: 0, noDirector: 0, dupeId: 0 };
  const seen = new Set<string>();
  const rows: Row[] = [];

  for (const r of table.slice(1)) {
    if (r.length <= iCast) continue;
    const imdb_id = r[iId].trim();
    const title = r[iTitle].trim();
    const yearRaw = r[iYear].trim();
    if (!imdb_id || !title) continue;
    // A mystery with no year cannot be compared on the year tile at all, so an
    // unusable row is dropped rather than loaded and quietly breaking a puzzle.
    const year = Number(yearRaw);
    if (!/^\d{4}$/.test(yearRaw) || year < 1900 || year > 2100) {
      skipped.badYear++;
      continue;
    }
    const genres = splitList(r[iGenre]);
    if (genres.length === 0) {
      skipped.noGenre++;
      continue;
    }
    const director = splitList(r[iDir]);
    if (director.length === 0) {
      skipped.noDirector++;
      continue;
    }
    const cast = splitList(r[iCast]);
    if (cast.length < 3) {
      skipped.thinCast++;
      continue;
    }
    if (seen.has(imdb_id)) {
      skipped.dupeId++;
      continue;
    }
    seen.add(imdb_id);
    rows.push({ imdb_id, title, year, genres, director, cast });
  }

  const appearances = new Map<string, number>();
  for (const m of rows) for (const c of m.cast) appearances.set(c, (appearances.get(c) ?? 0) + 1);
  const isEligible = (m: Row) => m.cast.some((c) => (appearances.get(c) ?? 0) >= minAppearances);
  const eligibleCount = rows.filter(isEligible).length;

  console.log(`Parsed ${rows.length} usable films from ${table.length - 1} CSV rows`);
  console.log('  skipped:', skipped);
  console.log(`  eligible as the mystery (cast appearing in >= ${minAppearances} films): ${eligibleCount}`);
  console.log(`  at 2 puzzles a day that is ~${(eligibleCount / 2 / 365).toFixed(1)} years before a repeat`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  let written = 0;
  // Batched: one statement per film would be thousands of round trips.
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples = chunk.map((m, j) => {
      const b = j * 7;
      values.push(
        m.imdb_id,
        m.title,
        m.year,
        JSON.stringify(m.genres),
        JSON.stringify(m.director),
        JSON.stringify(m.cast),
        isEligible(m)
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await pool.query(
      `INSERT INTO movies (imdb_id, title, year, genres, director, cast_members, eligible)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (imdb_id) DO UPDATE SET
         title = excluded.title, year = excluded.year, genres = excluded.genres,
         director = excluded.director, cast_members = excluded.cast_members,
         eligible = excluded.eligible`,
      values
    );
    written += chunk.length;
    process.stdout.write(`\r  loaded ${written}/${rows.length}`);
  }
  console.log('\nDone.');

  const { rows: check } = await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE eligible)::int AS eligible FROM movies`
  );
  console.log('In the database:', check[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
