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
  offerInstall: false,
  needsInstallFirst: false,
};

/** An iPhone in a Safari tab: can be installed, cannot subscribe until it is. */
const iphoneInTab: StepContext = { ...fresh, offerInstall: true, needsInstallFirst: true };

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

  // Regression: an existing subscription used to remove this step. On a device
  // that had already granted permission, the account could be auto-subscribed
  // moments after signup, and the step vanished from the flow. It now always
  // shows and the screen picks its own wording.
  it('keeps the notifications step even when a subscription already exists', () => {
    expect(stepsFor(fresh)).toContain('notifications');
  });

  it('leaves only the notifications step when everything else is set', () => {
    expect(
      stepsFor({
        ...fresh,
        paired: true,
        hasAnniversary: true,
        hasOwnBirthday: true,
        hasNickname: true,
      })
    ).toEqual(['notifications']);
  });

  it('returns nothing to do when the platform cannot notify or install', () => {
    expect(
      stepsFor({
        ...fresh,
        paired: true,
        hasAnniversary: true,
        hasOwnBirthday: true,
        hasNickname: true,
        canNotify: false,
      })
    ).toEqual([]);
  });
});

describe('the install step', () => {
  it('appears when the platform can be offered an install', () => {
    expect(stepsFor({ ...fresh, offerInstall: true })).toContain('install');
  });

  it('is absent when there is nothing to install (desktop, or already installed)', () => {
    expect(stepsFor(fresh)).not.toContain('install');
  });

  it('replaces the notification ask on an iPhone that is not installed yet', () => {
    // The ask cannot work in an iOS tab, so the install step carries it; the
    // ask returns on its own once they reopen from the home screen.
    const steps = stepsFor(iphoneInTab);
    expect(steps).toContain('install');
    expect(steps).not.toContain('notifications');
  });

  it('sits before the notification ask when both apply (Android with a prompt)', () => {
    const steps = stepsFor({ ...fresh, offerInstall: true });
    expect(steps.indexOf('install')).toBeLessThan(steps.indexOf('notifications'));
  });

  /**
   * The ordering is the whole point. On iOS the home-screen app has its own
   * storage jar, so installing costs a sign-in; asking at the END would make
   * someone redo a journey they had just finished. Install must come first.
   */
  it('is the very first thing asked, before anything they would have to redo', () => {
    expect(stepsFor({ ...fresh, offerInstall: true })[0]).toBe('install');
    expect(stepsFor({ ...iphoneInTab, paired: true })[0]).toBe('install');
  });

  it('is gone once installed, leaving the ask behind', () => {
    // Reopened from the home screen: standalone, so nothing to install and the
    // browser can finally subscribe.
    const steps = stepsFor({ ...iphoneInTab, offerInstall: false, needsInstallFirst: false });
    expect(steps).not.toContain('install');
    expect(steps).toContain('notifications');
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
