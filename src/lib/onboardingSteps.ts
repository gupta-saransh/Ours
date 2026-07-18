/**
 * Which onboarding steps a person actually needs to see.
 *
 * Kept pure (no React, no network, no clock) so the rules are unit-testable:
 * they decide what a new signup is asked for, and they run again on every entry
 * so someone who closes the app mid-flow is not re-asked for something they
 * already gave.
 *
 * Nothing here gates anything. Every step is skippable in the UI; this only
 * decides what is worth showing in the first place.
 */

export type OnboardingStep = 'partner' | 'anniversary' | 'birthday' | 'nickname' | 'notifications';

/** The canonical order. `done` is not a step, it is the end of the flow. */
export const STEP_ORDER: OnboardingStep[] = [
  'partner',
  'anniversary',
  'birthday',
  'nickname',
  'notifications',
];

export interface StepContext {
  /** Are they paired? A solo space has nobody to nickname. */
  paired: boolean;
  /** Is an anniversary milestone already on record? */
  hasAnniversary: boolean;
  /** Is a birthday already on record for THIS person? */
  hasOwnBirthday: boolean;
  /** Have they already given their partner a pet name? */
  hasNickname: boolean;
  /**
   * Can this platform actually deliver notifications? False on native, where
   * APNs/FCM credentials are not provisioned, so asking would be a stub.
   */
  canNotify: boolean;
  /** Does the server already hold a push subscription for them? */
  hasPushSubscription: boolean;
}

/**
 * The steps to show, in order. A step drops out when its data already exists,
 * when it cannot apply (nickname with no partner), or when the platform cannot
 * honor it (notifications on native).
 */
export function stepsFor(ctx: StepContext): OnboardingStep[] {
  return STEP_ORDER.filter((step) => {
    switch (step) {
      case 'partner':
        // Already paired: nothing to invite or join.
        return !ctx.paired;
      case 'anniversary':
        return !ctx.hasAnniversary;
      case 'birthday':
        return !ctx.hasOwnBirthday;
      case 'nickname':
        // Only meaningful once there is a partner to name.
        return ctx.paired && !ctx.hasNickname;
      case 'notifications':
        return ctx.canNotify && !ctx.hasPushSubscription;
      default:
        return false;
    }
  });
}

/**
 * The step to land on after finishing or skipping `current`. Null means the
 * flow is over. Recomputed against a fresh list each time, because answering
 * one step can change which later steps apply (pairing unlocks the nickname
 * step, which is exactly the case the plain index-based version got wrong).
 */
export function nextStep(steps: OnboardingStep[], current: OnboardingStep): OnboardingStep | null {
  const i = steps.indexOf(current);
  if (i === -1) {
    // `current` dropped out of the list (its data arrived while we were on it).
    // Fall back to the first step that still applies.
    return steps[0] ?? null;
  }
  return steps[i + 1] ?? null;
}

/** 1-based position for the progress indicator; 0 when the step is not shown. */
export function stepPosition(steps: OnboardingStep[], current: OnboardingStep): number {
  return steps.indexOf(current) + 1;
}
