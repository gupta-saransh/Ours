/**
 * Where a composed "moment" is stored.
 *
 * The Timeline has ONE composer, but two tables still back it, and each keeps
 * an ability the other does not have: `love_notes` rows can be PINNED to the
 * "Kept close" block, `memories` rows carry a backdatable `memory_date` and a
 * comment thread. So the composer decides per entry rather than forcing every
 * moment through one shape.
 *
 * The date rule is the subtle one. Notes sort by when they were WRITTEN and
 * have no date column, so a wordless entry the user deliberately filed on a
 * past day via the calendar would silently jump to today, contradicting the
 * very calendar cell they tapped. Anything carrying a date that is not today
 * therefore goes to `memories`, photo or not.
 */
export type MomentTarget = 'memory' | 'note';

export function momentTarget(opts: { hasPhoto: boolean; date: string | null; today: string }): MomentTarget {
  if (opts.hasPhoto) return 'memory';
  // A backdated moment needs somewhere to record the day it is about.
  if (opts.date && opts.date.slice(0, 10) !== opts.today.slice(0, 10)) return 'memory';
  return 'note';
}
