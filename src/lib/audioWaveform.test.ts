import { describe, expect, it } from 'vitest';
import {
  MAX_VOICE_NOTE_MS,
  MIN_VOICE_NOTE_MS,
  WAVEFORM_BARS,
  downsampleWaveform,
  formatClipDuration,
  meteringToLevel,
} from './audioWaveform';

describe('meteringToLevel', () => {
  it('reads 0dBFS (loudest) as full level', () => {
    expect(meteringToLevel(0)).toBe(1);
  });

  it('reads anything above 0 as still full level (clamped)', () => {
    expect(meteringToLevel(5)).toBe(1);
  });

  it('reads -50dB and quieter as silence', () => {
    expect(meteringToLevel(-50)).toBe(0);
    expect(meteringToLevel(-80)).toBe(0);
  });

  it('is linear between the floor and 0', () => {
    expect(meteringToLevel(-25)).toBeCloseTo(0.5, 5);
    expect(meteringToLevel(-12.5)).toBeCloseTo(0.75, 5);
  });

  it('treats missing/non-finite metering as silence, not a crash', () => {
    expect(meteringToLevel(undefined)).toBe(0);
    expect(meteringToLevel(null)).toBe(0);
    expect(meteringToLevel(Number.NaN)).toBe(0);
  });
});

describe('downsampleWaveform', () => {
  it('produces exactly barCount bars regardless of input length', () => {
    expect(downsampleWaveform([1, 0, 1, 0, 1], 40)).toHaveLength(40);
    expect(downsampleWaveform(new Array(500).fill(0.3), 40)).toHaveLength(40);
    expect(downsampleWaveform([0.5], 40)).toHaveLength(40);
  });

  it('pads with 0 (not a fabricated shape) when there are no samples at all', () => {
    expect(downsampleWaveform([], 40)).toEqual(new Array(40).fill(0));
  });

  it('averages each bucket', () => {
    // 4 samples into 2 bars: [1,1] -> 1, [0,0] -> 0.
    expect(downsampleWaveform([1, 1, 0, 0], 2)).toEqual([1, 0]);
  });

  it('handles a sample count that does not divide evenly into barCount', () => {
    const bars = downsampleWaveform([1, 0.5, 0, 1, 0.5], 3);
    expect(bars).toHaveLength(3);
    for (const b of bars) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range values into 0..1', () => {
    expect(downsampleWaveform([2, 2], 1)[0]).toBe(1);
    expect(downsampleWaveform([-2, -2], 1)[0]).toBe(0);
  });

  it('ignores non-finite samples rather than corrupting the average', () => {
    expect(downsampleWaveform([1, Number.NaN, 1], 1)).toEqual([1]);
  });

  it('defaults to WAVEFORM_BARS when no count is given', () => {
    expect(downsampleWaveform([1, 0, 1])).toHaveLength(WAVEFORM_BARS);
  });

  it('returns an empty array for a zero or negative bar count', () => {
    expect(downsampleWaveform([1, 0, 1], 0)).toEqual([]);
    expect(downsampleWaveform([1, 0, 1], -3)).toEqual([]);
  });

  it('is stable: the same input always yields the same bars', () => {
    const samples = [0.2, 0.9, 0.4, 0.1, 0.7, 0.3];
    expect(downsampleWaveform(samples, 4)).toEqual(downsampleWaveform(samples, 4));
  });
});

describe('formatClipDuration', () => {
  it('formats seconds under a minute as 0:ss', () => {
    expect(formatClipDuration(0)).toBe('0:00');
    expect(formatClipDuration(7_000)).toBe('0:07');
    expect(formatClipDuration(59_000)).toBe('0:59');
  });

  it('rolls over into minutes at the 60s boundary', () => {
    expect(formatClipDuration(60_000)).toBe('1:00');
    expect(formatClipDuration(83_000)).toBe('1:23');
  });

  it('pads seconds under 10 with a leading zero', () => {
    expect(formatClipDuration(65_000)).toBe('1:05');
  });

  it('rounds to the nearest second', () => {
    expect(formatClipDuration(7_600)).toBe('0:08');
    expect(formatClipDuration(7_400)).toBe('0:07');
  });

  it('never goes negative for bad input', () => {
    expect(formatClipDuration(-500)).toBe('0:00');
    expect(formatClipDuration(Number.NaN)).toBe('0:00');
  });

  it('formats the cap sensibly', () => {
    expect(formatClipDuration(MAX_VOICE_NOTE_MS)).toBe('3:00');
  });
});

describe('constants', () => {
  it('the minimum is well under the maximum', () => {
    expect(MIN_VOICE_NOTE_MS).toBeLessThan(MAX_VOICE_NOTE_MS);
  });
});
