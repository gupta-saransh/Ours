import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ask schedule. Two opposing requirements meet here:
 *
 *  - Never nag. A browser grants exactly one real permission prompt, and a
 *    dismissal is remembered forever, so repeated asking permanently costs us
 *    the user.
 *  - Never go silent on someone who just installed Ours to the home screen
 *    specifically so notifications could work.
 *
 * A localStorage stand-in has to exist before the module is imported, since the
 * real one is a browser thing.
 */
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { askIsDue, markPushAskDeclined, readPushAsk, writePushAsk, WAIT_DAYS } = await import('./pushAsk');

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => store.clear());

describe('askIsDue', () => {
  it('asks immediately when nobody has been asked yet', () => {
    expect(askIsDue({ n: 0, at: '' })).toBe(true);
  });

  it('holds off until the gap for the next ask has passed', () => {
    expect(askIsDue({ n: 1, at: daysAgo(1) })).toBe(false);
    expect(askIsDue({ n: 1, at: daysAgo(WAIT_DAYS[1]) })).toBe(true);
  });

  it('stops for good after the last scheduled ask', () => {
    expect(askIsDue({ n: WAIT_DAYS.length, at: daysAgo(365) })).toBe(false);
  });

  it('stops for good once they answered definitively', () => {
    // Granted, or blocked at the browser level. Only settings can undo it.
    expect(askIsDue({ n: 1, at: daysAgo(365), done: true })).toBe(false);
    expect(askIsDue({ n: 1, at: daysAgo(365), done: true }, true)).toBe(false);
  });
});

describe('after adding Ours to the home screen', () => {
  it('asks again even while the cooldown is running', () => {
    // The "maybe later" was tapped in a browser tab, where an iPhone could not
    // have subscribed anyway. Installing earns a fresh ask.
    const record = { n: 1, at: daysAgo(0), askedStandalone: false };
    expect(askIsDue(record)).toBe(false); // still in a tab: wait
    expect(askIsDue(record, true)).toBe(true); // installed: ask now
  });

  it('asks again even after every scheduled ask was used up', () => {
    const record = { n: WAIT_DAYS.length, at: daysAgo(0), askedStandalone: false };
    expect(askIsDue(record, true)).toBe(true);
  });

  it('does not re-ask forever once an ask has happened from the installed app', () => {
    const record = { n: 1, at: daysAgo(0), askedStandalone: true };
    expect(askIsDue(record, true)).toBe(false);
  });

  it('leaves a never-asked person on the normal path', () => {
    expect(askIsDue({ n: 0, at: '' }, true)).toBe(true);
  });
});

describe('markPushAskDeclined', () => {
  it('records where the ask happened, so an install can override it later', () => {
    markPushAskDeclined(false, false);
    expect(readPushAsk()).toMatchObject({ n: 1, askedStandalone: false });
    expect(askIsDue(readPushAsk(), true)).toBe(true);
  });

  it('marks a definitive answer as done', () => {
    markPushAskDeclined(true, true);
    expect(readPushAsk().done).toBe(true);
    expect(askIsDue(readPushAsk(), true)).toBe(false);
  });

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
    });
    expect(() => markPushAskDeclined(false)).not.toThrow();
    // A fresh read falls back to "never asked", so we ask rather than go quiet.
    expect(askIsDue(readPushAsk())).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  it('round-trips a written record', () => {
    writePushAsk({ n: 2, at: daysAgo(4), pairedAsked: true });
    expect(readPushAsk()).toMatchObject({ n: 2, pairedAsked: true });
  });
});
