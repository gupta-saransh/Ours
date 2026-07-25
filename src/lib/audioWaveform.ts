/**
 * Voice-note waveform math, kept pure so it can be unit tested under plain
 * node (the recorder itself, useVoiceRecorder.ts, is not: it touches
 * expo-audio and the DOM, same split as bubbleLayout.ts vs chat.tsx).
 *
 * The bars stored on a sent voice note are REAL amplitude, sampled while
 * recording (native: expo-audio's own metering; web: a small AnalyserNode run
 * alongside the recorder, since expo-audio implements no metering on web at
 * all). Nothing here invents a shape for a clip with no readable levels; an
 * empty input downsamples to an empty (or flat) array, never a fake one, per
 * the app's "no stubs, no mock states" rule.
 */

/**
 * Bars rendered in a sent voice-note bubble. Deliberately modest: the bubble
 * itself is only ~140px of actual bar-drawing width once the play button and
 * duration label are accounted for (see BUBBLE_VOICE_WIDTH), and packing 40
 * thin bars plus their gaps into that space left each bar under 2px wide, a
 * near-invisible dotted line rather than a readable waveform (a real reported
 * bug). Fewer, thicker bars read clearly at this size.
 */
export const WAVEFORM_BARS = 27;

/** A recording longer than this is cut off (3 minutes; a voice NOTE, not a memo). */
export const MAX_VOICE_NOTE_MS = 180_000;

/** Shorter than this and there is nothing worth sending (an accidental tap). */
export const MIN_VOICE_NOTE_MS = 500;

/**
 * expo-audio's native metering reports dBFS: 0 is the loudest the mic can
 * register, and it runs very negative for quiet/silence (in practice rarely
 * below -60 on a phone mic). Mapped onto a 0..1 level with a -50dB floor, so
 * normal speech reads as a readable mid-to-high bar instead of everything
 * clustering near zero. Anything not a finite number (web's status has no
 * metering key at all) reads as silence rather than throwing.
 */
export function meteringToLevel(db: number | null | undefined): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  const FLOOR = -50;
  if (db <= FLOOR) return 0;
  if (db >= 0) return 1;
  return (db - FLOOR) / -FLOOR;
}

/**
 * Buckets an arbitrary-length run of 0..1 levels into exactly `barCount`
 * bars, each the average of its slice, rounded to 2 decimal places (plenty
 * for a bar height, and keeps the stored JSONB small). Pads with 0 when there
 * are fewer samples than bars (a very short clip); never fabricates data that
 * was not actually sampled.
 */
export function downsampleWaveform(samples: number[], barCount: number = WAVEFORM_BARS): number[] {
  if (barCount <= 0) return [];
  if (samples.length === 0) return new Array(barCount).fill(0);

  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor((i * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / barCount));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      const v = samples[j];
      if (typeof v === 'number' && Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    const avg = n > 0 ? sum / n : 0;
    bars.push(Math.round(Math.max(0, Math.min(1, avg)) * 100) / 100);
  }
  return bars;
}

/** mm:ss, the same shape for the recording timer and a played clip's duration. */
export function formatClipDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
