import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { one } from './db';

/**
 * Envelope encryption at rest (feature 4).
 *
 * Two layers of key:
 *  - MASTER key: 256-bit, base64 in `MASTER_ENCRYPTION_KEY` (Vercel env). Never
 *    stored in the database. Rotating it is documented in CLAUDE.md.
 *  - Per-couple DEK: random 256-bit key, wrapped (encrypted) with the master key
 *    and stored on `couples.wrapped_dek`. Field values are encrypted with the
 *    couple's DEK.
 *
 * Ciphertext layout for every value: iv(12) || ciphertext || authTag(16), as a
 * single BYTEA. AES-256-GCM, so each value is authenticated (tampering fails
 * closed to a plaintext fallback rather than returning garbage).
 *
 * Everything degrades gracefully: with no master key set, the helpers return
 * null and callers keep reading/writing plaintext exactly as before. This keeps
 * the deployed app working until the key is provisioned, and lets old rows
 * (written before a value was encrypted, or never backfilled) keep resolving.
 *
 * This module is the single encrypt/decrypt boundary. A future move to true
 * end-to-end encryption is a swap of this file plus a client layer, not a
 * rewrite of the routes.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let masterKeyCache: Buffer | null | undefined; // undefined = unchecked, null = absent

function masterKey(): Buffer | null {
  if (masterKeyCache === undefined) {
    const b64 = process.env.MASTER_ENCRYPTION_KEY;
    if (!b64) {
      masterKeyCache = null;
    } else {
      const key = Buffer.from(b64, 'base64');
      if (key.length !== KEY_LEN) {
        throw new Error('MASTER_ENCRYPTION_KEY must decode to 32 bytes (base64 of a 256-bit key)');
      }
      masterKeyCache = key;
    }
  }
  return masterKeyCache;
}

/** True when a master key is configured and encryption is active. */
export function encryptionEnabled(): boolean {
  return masterKey() !== null;
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

function unseal(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Warm-instance cache of unwrapped DEKs (coupleId -> DEK). Lives only in the
// serverless function's memory for its short life; never persisted.
const dekCache = new Map<string, Buffer>();

/**
 * The couple's data encryption key, unwrapped. Mints and stores one lazily for
 * couples created before encryption existed. Returns null when encryption is
 * disabled (no master key).
 */
async function coupleDek(coupleId: string): Promise<Buffer | null> {
  const mk = masterKey();
  if (!mk) return null;
  const cached = dekCache.get(coupleId);
  if (cached) return cached;

  const row = await one<{ wrapped_dek: Buffer | null }>(
    'SELECT wrapped_dek FROM couples WHERE id = $1',
    [coupleId]
  );
  let dek: Buffer;
  if (row?.wrapped_dek) {
    dek = unseal(mk, row.wrapped_dek);
  } else {
    dek = randomBytes(KEY_LEN);
    await one('UPDATE couples SET wrapped_dek = $2 WHERE id = $1', [coupleId, seal(mk, dek)]);
  }
  dekCache.set(coupleId, dek);
  return dek;
}

/**
 * A freshly wrapped DEK for a brand-new couple, to store on the insert. Returns
 * null when encryption is disabled (leave `wrapped_dek` null; it will be minted
 * lazily if the key is added later).
 */
export function freshWrappedDek(): Buffer | null {
  const mk = masterKey();
  if (!mk) return null;
  return seal(mk, randomBytes(KEY_LEN));
}

/** A couple's unwrapped DEK (minting one lazily), or null when disabled. */
export function getDek(coupleId: string): Promise<Buffer | null> {
  return coupleDek(coupleId);
}

/**
 * Re-wrap a field blob from one couple's DEK to another's (decrypt with `from`,
 * re-encrypt with `to`). Used when content migrates between couples on pairing
 * so it stays readable under the target couple's key.
 */
export function recryptBlob(fromDek: Buffer, toDek: Buffer, blob: Buffer): Buffer {
  return seal(toDek, unseal(fromDek, blob));
}

/* ---------------------------------------------------------------------------
 * Per-message keys (secret chat).
 *
 * A third key layer for one purpose: making expiry irreversible. Master key
 * wraps the couple DEK wraps a PER-MESSAGE key which seals that one message's
 * body and media. Destroying the ~60 byte wrapped key (secret_message_keys)
 * turns the message into noise permanently, which plain deletion cannot promise
 * in a database that keeps MVCC history, replicas and managed backups.
 *
 * Note what does NOT change: the couple DEK is still server-held, so a LIVE
 * secret message is readable by the server exactly like any other field. This
 * layer is about making a SHREDDED message unrecoverable, not about hiding a
 * live one from the operator. That second property needs end-to-end encryption
 * (client-held keys), which this module is still the swap point for.
 * ------------------------------------------------------------------------- */

/** A fresh random key for exactly one message. Never reused, never derived. */
export function freshMessageKey(): Buffer {
  return randomBytes(KEY_LEN);
}

/**
 * Wrap a message key under the couple's DEK for storage. Returns null when
 * encryption is disabled, and callers MUST treat that as "secret chat is
 * unavailable" rather than falling back to plaintext the way ordinary fields
 * do: a secret message stored readable would defeat the entire feature, and it
 * would do it silently.
 */
export async function wrapMessageKey(coupleId: string, messageKey: Buffer): Promise<Buffer | null> {
  const dek = await coupleDek(coupleId);
  if (!dek) return null;
  return seal(dek, messageKey);
}

/** Unwrap a stored message key. Null when encryption is off or the blob fails authentication. */
export async function unwrapMessageKey(coupleId: string, wrapped: Buffer | null | undefined): Promise<Buffer | null> {
  if (!wrapped || wrapped.length === 0) return null;
  const dek = await coupleDek(coupleId);
  if (!dek) return null;
  try {
    return unseal(dek, wrapped);
  } catch {
    return null;
  }
}

/** Seal one value under a message key. Same iv||ct||tag layout as every other field. */
export function sealWithKey(messageKey: Buffer, plaintext: string | Buffer): Buffer {
  return seal(messageKey, typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext);
}

/**
 * Open a value sealed under a message key. Null when the key is gone (shredded)
 * or the blob does not authenticate. A shredded message reaching this function
 * is normal, not an error: it is exactly what expiry is supposed to produce.
 */
export function openWithKey(messageKey: Buffer, blob: Buffer | null | undefined): Buffer | null {
  if (!blob || blob.length === 0) return null;
  try {
    return unseal(messageKey, blob);
  } catch {
    return null;
  }
}

/** Convenience for text fields sealed under a message key. */
export function openTextWithKey(messageKey: Buffer, blob: Buffer | null | undefined): string | null {
  const out = openWithKey(messageKey, blob);
  return out ? out.toString('utf8') : null;
}

// Same lookalike-free alphabet the invite codes use; 32 chars, so one digest
// byte mod 32 maps uniformly.
const FINGERPRINT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short human-comparable fingerprint of the couple's DEK ("seal code" in the
 * UI): both partners see the same code, proof they sit under the same key. A
 * one-way SHA-256 with a fixed context string, so it reveals nothing about the
 * key itself. Null when encryption is disabled.
 */
export async function keyFingerprint(coupleId: string): Promise<string | null> {
  const dek = await coupleDek(coupleId);
  if (!dek) return null;
  const digest = createHash('sha256').update('ours-seal-code-v1').update(dek).digest();
  let code = '';
  for (let i = 0; i < 8; i++) code += FINGERPRINT_ALPHABET[digest[i] % FINGERPRINT_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Encrypt a plaintext field value for storage. Returns the BYTEA blob, or null
 * when encryption is disabled (caller then stores plaintext as before).
 */
export async function encryptField(coupleId: string, plaintext: string): Promise<Buffer | null> {
  const dek = await coupleDek(coupleId);
  if (!dek) return null;
  return seal(dek, Buffer.from(plaintext, 'utf8'));
}

/**
 * Decrypt a stored BYTEA blob. Returns null when there is nothing to decrypt,
 * encryption is disabled, or the blob fails authentication (caller falls back
 * to the plaintext column).
 */
export async function decryptField(coupleId: string, blob: Buffer | null | undefined): Promise<string | null> {
  if (!blob || blob.length === 0) return null;
  const dek = await coupleDek(coupleId);
  if (!dek) return null;
  try {
    return unseal(dek, blob).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve a field for reading: prefer the decrypted ciphertext, fall back to the
 * plaintext column (old/unencrypted rows). Convenience for list mapping.
 */
export async function readField(
  coupleId: string,
  ct: Buffer | null | undefined,
  plaintext: string | null
): Promise<string | null> {
  const decrypted = await decryptField(coupleId, ct);
  return decrypted ?? plaintext;
}
