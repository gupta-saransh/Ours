/**
 * Chat bubble geometry, kept pure so it can be unit tested under plain node.
 *
 * THE PROBLEM THIS SOLVES: bubbles used to size themselves independently. Text
 * bubbles could grow to 80% of whatever the screen happened to be, while an
 * image bubble was pinned to a hardcoded 220px square. The result was a ragged
 * right edge that jumped around message to message, which is nothing like the
 * calm single column WhatsApp and Telegram present.
 *
 * The fix is one shared width budget. Every bubble in the thread caps at the
 * SAME pixel width, and an image is rendered at exactly that width minus the
 * bubble's own inset, so a photo lands flush with the widest line of text
 * instead of at some unrelated size. Short messages still shrink to fit their
 * words, which is what WhatsApp does too, but nothing ever exceeds the column.
 */

/** Never wider than this, no matter how big the screen is. */
export const BUBBLE_MAX = 300;
/** Never narrower than this, so a bubble stays readable on a small phone. */
export const BUBBLE_MIN = 200;
/** Share of the available width a bubble may take before the cap applies. */
export const BUBBLE_SHARE = 0.78;
/** Padding a bubble puts around an image (styles.bubbleWithImage: sp.xs each side). */
export const BUBBLE_IMAGE_INSET = 8;
/** Images render in a consistent 4:3 frame, cropped to fill (contentFit cover). */
export const BUBBLE_IMAGE_RATIO = 3 / 4;

/**
 * The width cap shared by every bubble in the thread. Derived from the width
 * actually available to the list (its 680px column minus padding), not from the
 * raw window, so the wide-web layout does not get absurdly long lines.
 */
export function bubbleMaxWidth(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return BUBBLE_MAX;
  const share = Math.round(availableWidth * BUBBLE_SHARE);
  if (share >= BUBBLE_MIN) return Math.min(share, BUBBLE_MAX);
  // On a very narrow screen the share falls under the readable minimum. Take
  // the minimum, but never more than the container itself has to give, or the
  // bubble would overflow the very column it is meant to sit inside.
  return Math.min(BUBBLE_MIN, Math.round(availableWidth));
}

/**
 * The image frame inside a bubble. Exactly the shared cap minus the bubble's
 * inset, so photos and text end at the same edge.
 */
export function bubbleImageSize(maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, Math.round(maxWidth - BUBBLE_IMAGE_INSET * 2));
  return { width, height: Math.round(width * BUBBLE_IMAGE_RATIO) };
}

/**
 * Web word-wrapping for bubble text.
 *
 * `overflowWrap: 'break-word'` breaks a token ONLY when it cannot fit on a line
 * of its own, which is the WhatsApp behaviour: ordinary words flow whole onto
 * the next line, and only a monstrous unbroken URL is ever split. The previous
 * value, `anywhere`, split words mid-word as soon as the line ran out, which is
 * the bug this replaces.
 *
 * `anywhere` was originally there for a second reason: it also shrinks an
 * element's min-content width, which stopped a long URL from stretching the
 * bubble off screen. That job now belongs to the explicit pixel cap
 * (`bubbleMaxWidth`) plus `minWidth: 0` on the flex chain, so the wrapping rule
 * no longer has to do it and can go back to being merely correct.
 */
export const BUBBLE_TEXT_WRAP = {
  wordBreak: 'normal',
  overflowWrap: 'break-word',
} as const;
