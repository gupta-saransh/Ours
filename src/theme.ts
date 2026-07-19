// Ours design tokens. Direction: aged love letters. Parchment paper, espresso
// ink, oxblood wax-seal red, ochre gold, a thread of olive. Warm and grown-up,
// deliberately not the default blush/rose of every AI-generated app.
//
// Discipline over decoration: no gradients, no glassmorphism, no shadows.
// Depth = 1px hairline + the surfaceRaised shade. Hierarchy = type and spacing.

import type { TextStyle } from 'react-native';

// ---------------------------------------------------------------------------
// Theme presets. Five full palettes, all light, all the same aged-stationery
// discipline; only the paper, ink, and seal change. Radius, spacing, type, and
// motion never vary between presets.
//
// HOW SWITCHING WORKS: every screen bakes `colors` into module-scope
// StyleSheet.create calls, so the palette must be decided before any module
// evaluates. On web the chosen preset id sits in localStorage and is read
// synchronously right here at bundle evaluation; picking a new preset persists
// it and reloads the page once, which re-evaluates everything under the new
// palette. Native (not deployed) always gets the default; a live ThemeProvider
// refactor is the eventual native path.
// ---------------------------------------------------------------------------

export type ThemePresetId = 'parchment' | 'dusk' | 'meadow' | 'tide' | 'petal';

interface PaletteSeed {
  surface: string;       // ground
  surfaceRaised: string; // cards
  sealed: string;        // wax seal: primary buttons, sealed capsules
  sealedPressed: string;
  onSealedHex: string;   // light text on the seal color
  onSealedRgb: string;   // same, as "r, g, b" for the 0.92 alpha variant
  ink: string;
  inkRgb: string;        // "r, g, b" for muted/faint/hairline alphas
  accent: string;        // flourishes, section labels
  positive: string;
  positiveSoft: string;
  blush: string;         // legacy warm mid-tone
  blushSoft: string;
}

function makeColors(p: PaletteSeed) {
  const inkA = (alpha: number) => `rgba(${p.inkRgb}, ${alpha})`;
  return {
    // semantic roles (preferred)
    surface: p.surface,
    surfaceRaised: p.surfaceRaised,
    surfaceSealed: p.sealed,
    onSealed: `rgba(${p.onSealedRgb}, 0.92)`,
    ink: p.ink,
    inkMuted: inkA(0.68),
    inkFaint: inkA(0.40),
    hairline: inkA(0.12),
    accent: p.accent,
    positive: p.positive,
    danger: '#94301F',

    // legacy aliases kept while every screen migrates; do not use in new code
    cream: p.surface,
    inkSoft: inkA(0.68),
    blush: p.blush,
    blushSoft: p.blushSoft,
    rose: p.sealed,
    rosePressed: p.sealedPressed,
    gold: p.accent,
    sage: p.positive,
    sageSoft: p.positiveSoft,
    onRose: p.onSealedHex,
  };
}

const PALETTES: Record<ThemePresetId, ReturnType<typeof makeColors>> = {
  // The original: parchment, espresso ink, oxblood seal, ochre gold.
  parchment: makeColors({
    surface: '#F4ECDD',
    surfaceRaised: '#FCF7EB',
    sealed: '#7E382C',
    sealedPressed: '#61281F',
    onSealedHex: '#F9EFDC',
    onSealedRgb: '249, 239, 220',
    ink: '#33241C',
    inkRgb: '51, 36, 28',
    accent: '#B8862F',
    positive: '#77743F',
    positiveSoft: '#ECE8D5',
    blush: '#D9B491',
    blushSoft: '#EFE4CC',
  }),
  dusk: makeColors({
    surface: '#EFEAF2',
    surfaceRaised: '#F9F5FB',
    sealed: '#553A63',
    sealedPressed: '#42294F',
    onSealedHex: '#F6F0F9',
    onSealedRgb: '246, 240, 249',
    ink: '#302438',
    inkRgb: '48, 36, 56',
    accent: '#8E5B8A',
    positive: '#6E7150',
    positiveSoft: '#E7E1EC',
    blush: '#C7A9CF',
    blushSoft: '#E8DFEC',
  }),
  meadow: makeColors({
    surface: '#EEF0E2',
    surfaceRaised: '#F9FAF0',
    sealed: '#4A5A33',
    sealedPressed: '#384526',
    onSealedHex: '#F2F6E7',
    onSealedRgb: '242, 246, 231',
    ink: '#2A3122',
    inkRgb: '42, 49, 34',
    accent: '#9B7B2E',
    positive: '#77743F',
    positiveSoft: '#E6E9D6',
    blush: '#C9CBA3',
    blushSoft: '#E9EBD3',
  }),
  tide: makeColors({
    surface: '#E9F0EC',
    surfaceRaised: '#F5FAF7',
    sealed: '#2F5D57',
    sealedPressed: '#234741',
    onSealedHex: '#EEF6F3',
    onSealedRgb: '238, 246, 243',
    ink: '#233230',
    inkRgb: '35, 50, 48',
    accent: '#3E7E76',
    positive: '#5E7A64',
    positiveSoft: '#E1EBE6',
    blush: '#A9C8C0',
    blushSoft: '#DEEBE6',
  }),
  petal: makeColors({
    surface: '#F6ECE8',
    surfaceRaised: '#FCF5F2',
    sealed: '#8C3A4B',
    sealedPressed: '#6E2C3A',
    onSealedHex: '#FAF0EC',
    onSealedRgb: '250, 240, 236',
    ink: '#3A2529',
    inkRgb: '58, 37, 41',
    accent: '#B26E4F',
    positive: '#7A7248',
    positiveSoft: '#EFE7DC',
    blush: '#DBAFA6',
    blushSoft: '#F1DFD9',
  }),
};

// Picker metadata (Settings → Appearance).
export const THEME_PRESETS: { id: ThemePresetId; name: string; line: string }[] = [
  { id: 'parchment', name: 'Parchment', line: 'Aged love letters, the original' },
  { id: 'dusk', name: 'Lavender dusk', line: 'Violet evenings, quiet hours' },
  { id: 'meadow', name: 'Morning meadow', line: 'Green fields, early light' },
  { id: 'tide', name: 'Sea glass', line: 'Cool water, soft edges' },
  { id: 'petal', name: 'Pressed petals', line: 'A rose kept in a book' },
];

export const THEME_STORAGE_KEY = 'ours.theme';

export function isThemePresetId(v: unknown): v is ThemePresetId {
  return typeof v === 'string' && v in PALETTES;
}

/** Palette for a preset, for preview tiles that render in a non-active theme. */
export function paletteFor(id: ThemePresetId) {
  return PALETTES[id];
}

function activePresetId(): ThemePresetId {
  // localStorage exists on web only; native and the static-export Node pass
  // fall through to the default.
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePresetId(v)) return v;
    }
  } catch {}
  return 'parchment';
}

/** Store the preset for the next bundle evaluation. Caller reloads the page. */
export function persistThemePreset(id: ThemePresetId) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, id);
      // Read by the inline script in app/+html.tsx so the page background is
      // right before the bundle loads (no parchment flash on other themes).
      localStorage.setItem('ours.theme-bg', PALETTES[id].surface);
    }
  } catch {}
}

/** The preset the running bundle was evaluated under. */
export const themePreset: ThemePresetId = activePresetId();

export const colors = PALETTES[themePreset];

export const font = {
  display: 'Fraunces_600SemiBold',
  displayMedium: 'Fraunces_500Medium',
  serif: 'Fraunces_400Regular',
  serifItalic: 'Fraunces_400Regular_Italic',
};

// Spacing scale (points). Only these values are allowed in layout.
export const sp = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

// Legacy 4pt multiplier; still referenced by unmigrated styles.
export const space = (n: number) => n * 4;

/**
 * Categorical series colors for the admin dashboard's charts.
 *
 * A chart legend needs colors that stay distinguishable side by side, which the
 * semantic roles above cannot give (they are one warm family by design). These
 * live here rather than in the screen so the "no hardcoded hex outside
 * theme.ts" rule still holds. Ordered most-distinct first, since the first few
 * entries land on the highest-volume sources and carry the most ink.
 *
 * Deliberately still in the app's warm register: oxblood, gold, olive, clay,
 * ink-blue, plum. Not a generic dashboard rainbow.
 */
export const chartSeries = [
  '#7E382C', // oxblood (chat: always the biggest)
  '#B8862F', // ochre gold
  '#77743F', // dry olive
  '#9C5B3E', // clay
  '#4E6070', // slate blue
  '#6B4A63', // plum
  '#A8823C', // light ochre
  '#5C7355', // sage
  '#8C4F4F', // faded rose
] as const;

export const radius = {
  none: 0,
  hairline: 2,
  sm: 6,      // photos inside cards, inputs
  md: 10,     // cards
  lg: 16,     // sheet top edge
  pill: 999,  // buttons, pills
  full: 999,  // legacy alias
} as const;

// Type presets. Fraunces is reserved for content the couple wrote or reads as
// content; system sans is chrome. Never mix two Fraunces sizes in one card.
export const text = {
  display: {
    fontFamily: font.serifItalic,
    fontSize: 32,
    letterSpacing: -0.5,
    lineHeight: 38,
    color: colors.ink,
  } as TextStyle,
  title: {
    fontFamily: font.displayMedium,
    fontSize: 24,
    letterSpacing: -0.3,
    lineHeight: 30,
    color: colors.ink,
  } as TextStyle,
  subtitle: {
    fontFamily: font.displayMedium,
    fontSize: 18,
    letterSpacing: -0.2,
    lineHeight: 24,
    color: colors.ink,
  } as TextStyle,
  section: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    lineHeight: 16,
    textTransform: 'uppercase',
    color: colors.accent,
  } as TextStyle,
  body: {
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 22,
    color: colors.ink,
  } as TextStyle,
  bodySerif: {
    fontFamily: font.serif,
    fontSize: 16,
    letterSpacing: -0.1,
    lineHeight: 24,
    color: colors.ink,
  } as TextStyle,
  caption: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: 0.1,
    lineHeight: 18,
    color: colors.inkMuted,
  } as TextStyle,
  micro: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
    color: colors.ink,
  } as TextStyle,
};

// Motion is a whisper. Nothing bounces, nothing exceeds 320ms.
export const motion = {
  press: { scale: 0.98, duration: 120 },
  fade: { duration: 180 },
  sheet: { stiffness: 220, damping: 26 },
  stagger: 40,
} as const;

// Legacy numeric sizes; unmigrated styles only.
export const type = {
  hero: 34,
  title: 24,
  heading: 19,
  body: 16,
  small: 13.5,
  tiny: 12,
};
