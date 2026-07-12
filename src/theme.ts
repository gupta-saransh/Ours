// Ours — design tokens. Warm, restrained, never childish.

export const colors = {
  cream: '#FAF6F0',        // app ground
  surface: '#FFFDFA',      // cards
  ink: '#3B2E2A',          // primary text
  inkSoft: '#93817A',      // secondary text
  hairline: '#EADFD5',     // borders instead of shadows
  blush: '#EAC8C4',
  blushSoft: '#F7ECE9',    // tinted fills (pinned notes, chips)
  rose: '#B4574E',         // primary action
  rosePressed: '#9C4740',
  sage: '#7C8F80',         // secondary accent
  sageSoft: '#EEF1EC',
  danger: '#A63D33',
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
