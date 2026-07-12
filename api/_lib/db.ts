import 'dotenv/config';
import { Pool } from 'pg';

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

export async function q<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}

export async function one<T = any>(text: string, params?: unknown[]): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}
