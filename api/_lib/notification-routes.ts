import type { NotificationKind } from './notify';

/**
 * Where a notification of each kind should deep-link when tapped. Used to set
 * the `url` on the Web Push payload so the service worker can open the right
 * screen. Any unmapped kind falls back to home.
 */
const ROUTES: Record<NotificationKind, string> = {
  nudge: '/',
  memory: '/memories',
  note: '/notes',
  milestone: '/milestones',
  partner: '/',
  bucket: '/wishlist',
  prompt: '/prompts',
  capsule: '/memories',
  date: '/dates',
  wishlist: '/wishlist',
  comment: '/memories',
};

export function routeForKind(kind: string): string {
  return ROUTES[kind as NotificationKind] ?? '/';
}
