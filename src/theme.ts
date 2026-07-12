// Ours design tokens. Direction: aged love letters. Parchment paper, espresso
// ink, oxblood wax-seal red, ochre gold, a thread of olive. Warm and grown-up,
// deliberately not the default blush/rose of every AI-generated app.

export const colors = {
  cream: '#F4ECDD',        // parchment ground
  surface: '#FCF7EB',      // paper cards
  ink: '#33241C',          // espresso text
  inkSoft: '#8F7A63',      // faded-ink secondary
  hairline: '#E2D2B6',     // ruled-line borders
  blush: '#D9B491',        // toasted sand (soft accent borders)
  blushSoft: '#EFE4CC',    // tinted fills (pinned notes, chips)
  rose: '#7E382C',         // oxblood, the wax seal; primary action
  rosePressed: '#61281F',
  gold: '#B8862F',         // ochre gold, small flourishes
  sage: '#77743F',         // dry olive, secondary accent
  sageSoft: '#ECE8D5',
  danger: '#94301F',
  onRose: '#F9EFDC',       // text on oxblood
};

export const font = {
  display: 'Fraunces_600SemiBold',
  displayMedium: 'Fraunces_500Medium',
  serif: 'Fraunces_400Regular',
  serifItalic: 'Fraunces_400Regular_Italic',
};

export const type = {
  hero: 34,
  title: 24,
  heading: 19,
  body: 16,
  small: 13.5,
  tiny: 12,
};

export const space = (n: number) => n * 4;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  full: 999,
};
