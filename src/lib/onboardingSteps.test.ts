import { describe, expect, it } from 'vitest';
import { nextStep, stepPosition, stepsFor, type StepContext } from './onboardingSteps';

/**
 * The onboarding rules decide what a new couple is asked for. The cases that
 * matter: nothing is ever asked twice, a solo space is never asked to nickname
 * a partner who does not exist, and native never sees a notifications step it
 * could not honor.
 */

const fresh: StepContext = {
  paired: false,
  hasAnniversary: false,
  hasOwnBirthday: false,
  hasNickname: false,
  canNotify: true,
  hasPushSubscription: false,
};

describe('stepsFor', () => {
  it('asks a brand new solo signup for everything except the nickname', () => {
    // Nobody to nickname yet: pairing has not happened in this pass.
    expect(stepsFor(fresh)).toEqual(['partner', 'anniversary', 'birthday', 'notifications']);
  });

  it('includes the nickname once they are paired, and drops the pairing step', () => {
    expect(stepsFor({ ...fresh, paired: true })).toEqual([
      'anniversary',
      'birthday',
      'nickname',
      'notifications',
    ]);
  });

  it('never re-asks for data that already exists', () => {
    const steps = stepsFor({
      ...fresh,
      paired: true,
      hasAnniversary: true,
      hasOwnBirthday: true,
      hasNickname: true,
    });
    expect(steps).toEqual(['notifications']);
  });

  it('skips notifications on a platform that cannot deliver them', () => {
    expect(stepsFor({ ...fresh, canNotify: false })).toEqual(['partner', 'anniversary', 'birthday']);
  });

  it('skips notifications when a subscription is already stored', () => {
    expect(stepsFor({ ...fresh, hasPushSubscription: true })).toEqual([
      'partner',
      'anniversary',
      'birthday',
    ]);
  });

  it('returns nothing to do when everything is already set', () => {
    expect(
      stepsFor({
        paired: true,
        hasAnniversary: true,
        hasOwnBirthday: true,
        hasNickname: true,
        canNotify: true,
        hasPushSubscription: true,
      })
    ).toEqual([]);
  });
});

describe('nextStep', () => {
  it('walks the list in order', () => {
    const steps = stepsFor(fresh);
    expect(nextStep(steps, 'partner')).toBe('anniversary');
    expect(nextStep(steps, 'anniversary')).toBe('birthday');
  });

  it('returns null at the end of the flow', () => {
    const steps = stepsFor(fresh);
    expect(nextStep(steps, 'notifications')).toBeNull();
  });

  it('recovers when the current step has dropped out of a recomputed list', () => {
    // They paired on the partner step, so 'partner' is gone from the fresh list
    // but is still the step we are standing on.
    const after = stepsFor({ ...fresh, paired: true });
    expect(nextStep(after, 'partner')).toBe('anniversary');
  });

  it('handles an empty list', () => {
    expect(nextStep([], 'partner')).toBeNull();
  });
});

describe('stepPosition', () => {
  it('is 1-based for the progress indicator', () => {
    const steps = stepsFor(fresh);
    expect(stepPosition(steps, 'partner')).toBe(1);
    expect(stepPosition(steps, 'notifications')).toBe(4);
  });

  it('is 0 for a step that is not being shown', () => {
    expect(stepPosition(stepsFor(fresh), 'nickname')).toBe(0);
  });
});
