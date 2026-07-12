// Ours design tokens. Direction: aged love letters. Parchment paper, espresso
// ink, oxblood wax-seal red, ochre gold, a thread of olive. Warm and grown-up,
// deliberately not the default blush/rose of every AI-generated app.
//
// Discipline over decoration: no gradients, no glassmorphism, no shadows.
// Depth = 1px hairline + the surfaceRaised shade. Hierarchy = type and spacing.

import type { TextStyle } from 'react-native';

export const colors = {
  // semantic roles (preferred)
  surface: '#F4ECDD',            // parchment ground
  surfaceRaised: '#FCF7EB',      // paper cards
  surfaceSealed: '#7E382C',      // oxblood, sealed capsules + prompt card
  onSealed: 'rgba(249, 239, 220, 0.92)',
  ink: '#33241C',                // espresso text
  inkMuted: 'rgba(51, 36, 28, 0.68)',
  inkFaint: 'rgba(51, 36, 28, 0.40)',
  hairline: 'rgba(51, 36, 28, 0.12)',
  accent: '#B8862F',             // ochre gold flourishes
  positive: '#77743F',           // dry olive
  danger: '#94301F',

  // legacy aliases kept while every screen migrates; do not use in new code
  cream: '#F4ECDD',
  inkSoft: 'rgba(51, 36, 28, 0.68)',
  blush: '#D9B491',
  blushSoft: '#EFE4CC',
  rose: '#7E382C',
  rosePressed: '#61281F',
  gold: '#B8862F',
  sage: '#77743F',
  sageSoft: '#ECE8D5',
  onRose: '#F9EFDC',
};

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
