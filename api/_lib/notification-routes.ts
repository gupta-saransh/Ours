import type { NotificationKind } from './notify';

/**
 * Where a notification of each kind should deep-link when tapped. Used to set
 * the `url` on the Web Push payload so the service worker can open the right
 * screen. Any unmapped kind falls back to home.
 */
const ROUTES: Record<NotificationKind, string> = {
  nudge: '/',
  // Notes and memories now share one surface (the Timeline), so both kinds and
  // the comment/capsule kinds that hang off them all land there.
  memory: '/timeline',
  note: '/timeline',
  milestone: '/milestones',
  partner: '/',
  bucket: '/wishlist',
  prompt: '/prompts',
  capsule: '/timeline',
  date: '/dates',
  wishlist: '/wishlist',
  comment: '/timeline',
  game: '/',
  todo: '/todos',
};

export function routeForKind(kind: string): string {
  return ROUTES[kind as NotificationKind] ?? '/';
}
