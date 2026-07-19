import { describe, expect, it } from 'vitest';
import { momentTarget } from './momentTarget';

const TODAY = '2026-07-19';

describe('momentTarget', () => {
  it('sends a photo to memories', () => {
    expect(momentTarget({ hasPhoto: true, date: null, today: TODAY })).toBe('memory');
  });

  it('sends plain words written today to notes, so they stay pinnable', () => {
    expect(momentTarget({ hasPhoto: false, date: null, today: TODAY })).toBe('note');
  });

  it('treats an explicit date of today as today', () => {
    expect(momentTarget({ hasPhoto: false, date: TODAY, today: TODAY })).toBe('note');
  });

  it('sends BACKDATED words to memories, since notes cannot record a past day', () => {
    expect(momentTarget({ hasPhoto: false, date: '2026-07-03', today: TODAY })).toBe('memory');
  });

  it('sends a future-dated entry to memories too', () => {
    expect(momentTarget({ hasPhoto: false, date: '2026-08-01', today: TODAY })).toBe('memory');
  });

  it('keeps a backdated photo in memories', () => {
    expect(momentTarget({ hasPhoto: true, date: '2026-07-03', today: TODAY })).toBe('memory');
  });

  it('compares only the date part, ignoring any time component', () => {
    expect(momentTarget({ hasPhoto: false, date: '2026-07-19T22:00:00Z', today: '2026-07-19' })).toBe('note');
  });
});
