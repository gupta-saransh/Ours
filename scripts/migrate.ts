import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('user:password@host')) {
    console.error('Set DATABASE_URL in .env before running migrations.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Schema applied ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
