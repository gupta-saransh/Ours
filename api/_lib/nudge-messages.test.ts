import { describe, expect, it, vi } from 'vitest';
import { NUDGE_MESSAGES, pickNudgeMessage } from './nudge-messages';

describe('nudge-messages', () => {
  it('every template has a {name} placeholder to fill', () => {
    for (const template of NUDGE_MESSAGES) {
      expect(template).toContain('{name}');
    }
  });

  it('never uses an em dash (house copy rule)', () => {
    for (const template of NUDGE_MESSAGES) {
      expect(template).not.toContain('—');
    }
  });

  it('has more than one option (the whole point is variety)', () => {
    expect(NUDGE_MESSAGES.length).toBeGreaterThan(5);
  });

  it('substitutes the given name and leaves no placeholder behind', () => {
    for (let i = 0; i < NUDGE_MESSAGES.length; i++) {
      vi.spyOn(Math, 'random').mockReturnValue(i / NUDGE_MESSAGES.length);
      const result = pickNudgeMessage('Anisha');
      expect(result).toContain('Anisha');
      expect(result).not.toContain('{name}');
      vi.restoreAllMocks();
    }
  });

  it('picks the first and last entries correctly at the random-range boundaries', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickNudgeMessage('Sam')).toBe(NUDGE_MESSAGES[0].replace('{name}', 'Sam'));
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(pickNudgeMessage('Sam')).toBe(NUDGE_MESSAGES[NUDGE_MESSAGES.length - 1].replace('{name}', 'Sam'));
    vi.restoreAllMocks();
  });
});
