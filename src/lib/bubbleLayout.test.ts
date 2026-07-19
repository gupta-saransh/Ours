import { describe, expect, it } from 'vitest';
import {
  BUBBLE_IMAGE_INSET,
  BUBBLE_MAX,
  BUBBLE_MIN,
  BUBBLE_TEXT_WRAP,
  bubbleImageSize,
  bubbleMaxWidth,
} from './bubbleLayout';

describe('bubbleMaxWidth', () => {
  it('takes a share of the available width on a normal phone', () => {
    // 375pt iPhone minus the list's 16pt padding each side.
    expect(bubbleMaxWidth(343)).toBe(Math.round(343 * 0.78));
  });

  it('never exceeds the absolute cap on a wide screen', () => {
    expect(bubbleMaxWidth(648)).toBe(BUBBLE_MAX);
    expect(bubbleMaxWidth(4000)).toBe(BUBBLE_MAX);
  });

  it('holds a readable minimum on a narrow screen', () => {
    expect(bubbleMaxWidth(240)).toBe(BUBBLE_MIN);
  });

  it('never returns more than the container has to give', () => {
    // The minimum must not win when honouring it would overflow the column.
    expect(bubbleMaxWidth(150)).toBe(150);
    expect(bubbleMaxWidth(150)).toBeLessThanOrEqual(150);
  });

  it('falls back to the cap for a width that has not been measured yet', () => {
    expect(bubbleMaxWidth(0)).toBe(BUBBLE_MAX);
    expect(bubbleMaxWidth(-1)).toBe(BUBBLE_MAX);
    expect(bubbleMaxWidth(Number.NaN)).toBe(BUBBLE_MAX);
    expect(bubbleMaxWidth(Number.POSITIVE_INFINITY)).toBe(BUBBLE_MAX);
  });

  it('is stable: the same width always yields the same cap', () => {
    // This is the whole point. Every bubble in a thread asks with the same
    // available width, so every bubble gets the same edge.
    expect(bubbleMaxWidth(343)).toBe(bubbleMaxWidth(343));
  });

  it('returns whole pixels, so bubbles cannot land on half-pixel edges', () => {
    for (const w of [343, 361, 500, 641]) {
      expect(Number.isInteger(bubbleMaxWidth(w))).toBe(true);
    }
  });
});

describe('bubbleImageSize', () => {
  it('fills the bubble exactly, minus its inset, so photos align with text', () => {
    const max = bubbleMaxWidth(343);
    expect(bubbleImageSize(max).width).toBe(max - BUBBLE_IMAGE_INSET * 2);
  });

  it('keeps a consistent frame regardless of the photo inside it', () => {
    // The size depends only on the bubble cap, never on the image, which is
    // what stops the column jumping from message to message.
    const a = bubbleImageSize(300);
    const b = bubbleImageSize(300);
    expect(a).toEqual(b);
  });

  it('uses a 4:3 frame', () => {
    const { width, height } = bubbleImageSize(300);
    expect(height).toBe(Math.round(width * 0.75));
  });

  it('never produces a zero or negative frame from a tiny cap', () => {
    const { width, height } = bubbleImageSize(4);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe('BUBBLE_TEXT_WRAP', () => {
  it('breaks a word only when it cannot fit alone, never mid-word by default', () => {
    expect(BUBBLE_TEXT_WRAP.overflowWrap).toBe('break-word');
  });

  it('does NOT use overflow-wrap: anywhere (the mid-word splitting regression)', () => {
    // `anywhere` split ordinary words as soon as a line ran out. The pixel cap
    // in bubbleMaxWidth now does the job `anywhere` was really there for.
    expect(BUBBLE_TEXT_WRAP.overflowWrap).not.toBe('anywhere');
    expect(BUBBLE_TEXT_WRAP.wordBreak).not.toBe('break-all');
  });
});
