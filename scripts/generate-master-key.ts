import { randomBytes } from 'node:crypto';

/**
 * Generates the master encryption key for envelope encryption (feature 4).
 * A 256-bit random key, base64-encoded. Run once:
 *
 *   npx tsx scripts/generate-master-key.ts
 *
 * Paste the line into your local .env AND the Vercel project's Environment
 * Variables. Keep it secret and STABLE: rotating it without re-wrapping every
 * couple's key makes existing data unreadable (see CLAUDE.md rotation notes).
 */
const key = randomBytes(32).toString('base64');
console.log('\nAdd this to .env and to Vercel (Project Settings -> Environment Variables):\n');
console.log(`MASTER_ENCRYPTION_KEY=${key}\n`);
console.log('Then: npm run migrate  (adds the ciphertext columns)');
console.log('Optional, to encrypt data that already exists: npx tsx scripts/backfill-encryption.ts\n');
