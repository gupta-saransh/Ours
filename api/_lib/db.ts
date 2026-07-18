import 'dotenv/config';
import { Pool } from 'pg';
import { errorFields, log } from './log';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    // Serverless: keep the pool tiny; CockroachDB handles many small pools well.
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

/** A query's first line is enough to identify it in a log; params never are. */
function sqlShape(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

const SLOW_QUERY_MS = 1000;

export async function q<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const startedAt = Date.now();
  try {
    const { rows } = await getPool().query(text, params);
    const ms = Date.now() - startedAt;
    // Only the slow ones: logging every query would drown the signal.
    if (ms >= SLOW_QUERY_MS) log('warn', 'db.slow_query', { sql: sqlShape(text), duration_ms: ms, rows: rows.length });
    return rows as T[];
  } catch (err) {
    // NEVER log params: they carry note bodies, passwords, and ciphertext.
    log('error', 'db.query_failed', {
      sql: sqlShape(text),
      param_count: params?.length ?? 0,
      duration_ms: Date.now() - startedAt,
      ...errorFields(err),
    });
    throw err;
  }
}

export async function one<T = any>(text: string, params?: unknown[]): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}
