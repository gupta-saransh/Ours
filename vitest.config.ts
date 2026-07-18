import { defineConfig } from 'vitest/config';

// Server-side route logic plus the app's PURE helper modules (no React, no
// react-native imports, so they run under plain node). The rendered app itself
// is exercised in the running Expo build; these tests guard the
// security-sensitive route rules and the fiddly pure logic beside them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
