import { describe, expect, it } from 'vitest';
import { pickDateReminder, type ReminderFlags } from './date-reminders';

const NONE: ReminderFlags = { reminded_24: false, reminded_6: false, reminded_1: false };

describe('pickDateReminder', () => {
  it('says nothing for a date still more than a day away', () => {
    expect(pickDateReminder(30, NONE)).toBeNull();
  });

  it('sends the 24h reminder inside the day-before window', () => {
    const d = pickDateReminder(20, NONE);
    expect(d?.body).toContain('coming up');
    expect(d?.flags).toEqual({ reminded_24: true, reminded_6: false, reminded_1: false });
  });

  it('does not repeat the 24h reminder once it has fired', () => {
    expect(pickDateReminder(20, { ...NONE, reminded_24: true })).toBeNull();
  });

  it('sends the 6h reminder and also marks the 24h one done', () => {
    const d = pickDateReminder(4, { ...NONE, reminded_24: true });
    expect(d?.body).toContain('few hours');
    expect(d?.flags).toEqual({ reminded_24: true, reminded_6: true, reminded_1: false });
  });

  it('does not repeat the 6h reminder', () => {
    expect(pickDateReminder(4, { reminded_24: true, reminded_6: true, reminded_1: false })).toBeNull();
  });

  it('sends the 1h reminder and marks every earlier threshold done', () => {
    const d = pickDateReminder(0.5, { reminded_24: true, reminded_6: true, reminded_1: false });
    expect(d?.body).toContain('almost here');
    expect(d?.flags).toEqual({ reminded_24: true, reminded_6: true, reminded_1: true });
  });

  it('collapses to just the most-urgent reminder for a date added at the last minute', () => {
    // 40 minutes away, nothing sent yet: send only the 1h nudge, suppress the rest.
    const d = pickDateReminder(0.67, NONE);
    expect(d?.body).toContain('almost here');
    expect(d?.flags).toEqual({ reminded_24: true, reminded_6: true, reminded_1: true });
  });

  it('says nothing once the 1h reminder has fired', () => {
    expect(pickDateReminder(0.5, { reminded_24: true, reminded_6: true, reminded_1: true })).toBeNull();
  });

  it('says nothing for a date well in the past', () => {
    expect(pickDateReminder(-3, NONE)).toBeNull();
  });

  it('handles the exact window boundaries', () => {
    expect(pickDateReminder(24, NONE)?.body).toContain('coming up'); // 24h window is inclusive
    expect(pickDateReminder(6, NONE)?.body).toContain('few hours'); // 6h window
    expect(pickDateReminder(1.5, NONE)?.body).toContain('almost here'); // 1h window
  });
});
