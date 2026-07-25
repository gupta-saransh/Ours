import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { errorFields, log } from './log';

/**
 * Voice-note normalization.
 *
 * THE PROBLEM: a voice note recorded in a browser is whatever MediaRecorder
 * on that browser happens to produce (audio/mp4 on Safari, audio/webm
 * everywhere else); a voice note recorded natively is AAC-in-.m4a. Every
 * platform's PLAYER has different codec support (iOS's AVPlayer and Safari's
 * <audio> in particular cannot reliably decode WebM), so "record on Android
 * Chrome, play back on a partner's iPhone" could silently fail to play. The
 * app has no custom cross-platform audio decoder the way WhatsApp's own apps
 * do, so it leans on each OS's native player, which means every stored clip
 * has to already be in a format every OS's native player accepts.
 *
 * THE FIX: every voice note is transcoded, server-side, into ONE canonical
 * format (AAC in an .m4a/mp4 container) before it is ever stored. This is not
 * a filter on top of the recording, it is a NORMALIZATION step: it runs on
 * every clip regardless of what the client recorded (including a native m4a
 * recording, which is cheap to re-encode and guarantees one code path rather
 * than a "skip if already mp4" branch that could itself go stale). After
 * this, `audio_mime` is always 'audio/mp4' and every clip plays on every
 * platform, the same guarantee a mainstream chat app gives.
 *
 * Uses `ffmpeg-static` (a real npm dependency bundling a static ffmpeg
 * binary per platform, downloaded at install time, the standard way to run
 * ffmpeg from a Vercel Node serverless function) rather than a client-side
 * WASM transcode, which would ship a heavy decoder to every visitor's bundle
 * just to cover the rare person who records a voice note.
 */

const execFileAsync = promisify(execFile);

export type TranscodeReason = 'ffmpeg-missing' | 'decode-failed' | 'transcode-failed' | 'empty-output';

export interface TranscodeResult {
  ok: boolean;
  base64?: string;
  mime?: string;
  reason?: TranscodeReason;
}

/** The canonical, guaranteed-everywhere-playable format every clip is normalized to. */
export const CANONICAL_AUDIO_MIME = 'audio/mp4';

/**
 * Normalizes one `data:<mime>;base64,<...>` clip into AAC/.m4a. Never throws;
 * a failure comes back as `{ ok: false, reason }` so the caller can fail the
 * send loudly (no silent pretend-send, matching email.ts/push.ts) rather than
 * store something that might not have transcoded correctly.
 */
export async function transcodeToAac(dataUri: string): Promise<TranscodeResult> {
  if (!ffmpegPath) {
    log('error', 'voice.transcode_failed', { reason: 'ffmpeg-missing' });
    return { ok: false, reason: 'ffmpeg-missing' };
  }

  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUri);
  if (!match) return { ok: false, reason: 'decode-failed' };
  let inputBuffer: Buffer;
  try {
    inputBuffer = Buffer.from(match[2], 'base64');
  } catch {
    return { ok: false, reason: 'decode-failed' };
  }
  if (inputBuffer.length === 0) return { ok: false, reason: 'decode-failed' };

  const dir = await mkdtemp(join(tmpdir(), 'ours-voice-'));
  const input = join(dir, 'input');
  const output = join(dir, 'output.m4a');
  try {
    await writeFile(input, inputBuffer);
    // Mono, 44.1kHz, 64kbps AAC: plenty for spoken voice, small on disk.
    // +faststart moves the moov atom to the front so playback can start
    // before the whole file has downloaded.
    await execFileAsync(
      ffmpegPath,
      ['-y', '-i', input, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', output],
      { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const out = await readFile(output);
    if (out.length === 0) return { ok: false, reason: 'empty-output' };
    return { ok: true, base64: out.toString('base64'), mime: CANONICAL_AUDIO_MIME };
  } catch (err) {
    log('error', 'voice.transcode_failed', { reason: 'transcode-failed', ...errorFields(err) });
    return { ok: false, reason: 'transcode-failed' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
