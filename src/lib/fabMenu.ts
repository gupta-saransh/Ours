import { useEffect, useState } from 'react';

/**
 * Tiny shared signal for whether the universal add-menu (the wax-seal FAB) is
 * expanded. The chat button sits directly above the FAB, so it hides while the
 * menu is open to avoid overlapping the action column. Module-level, no
 * provider needed (mirrors HeartsRain's trigger pattern).
 */
let open = false;
const listeners = new Set<(v: boolean) => void>();

export function setFabMenuOpen(v: boolean): void {
  if (v === open) return;
  open = v;
  listeners.forEach((l) => l(v));
}

export function useFabMenuOpen(): boolean {
  const [v, setV] = useState(open);
  useEffect(() => {
    const l = (x: boolean) => setV(x);
    listeners.add(l);
    setV(open);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}
