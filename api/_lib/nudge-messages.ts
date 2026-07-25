/**
 * A little variety for the "thinking of you" nudge. Picked server-side, once
 * per send, so the live toast (NudgeToast.tsx), the push notification, and
 * the notifications-pane history all show the exact same line rather than
 * three independently-guessed ones.
 */
export const NUDGE_MESSAGES: string[] = [
  '{name} is thinking of you ♥',
  '{name} just sent a little nudge your way',
  '{name} hit the heart button just for you',
  'Boop. {name} is thinking of you',
  '{name} wanted you to know you are on their mind',
  'A tiny hello from {name} ♥',
  '{name} is sending you a virtual poke',
  '{name} paused their day to think of you',
  'Somewhere nearby, {name} is smiling about you',
  '{name} is missing you right about now',
  '{name} sends their love, no reason needed',
  'Consider yourself nudged, by {name}',
  '{name} pressed the heart, and meant it!',
  'A little spark from {name}, just because...why not?',
];

export function pickNudgeMessage(name: string): string {
  const template = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];
  return template.replace('{name}', name);
}
