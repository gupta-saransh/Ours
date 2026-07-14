import { defineConfig } from 'vitest/config';

// Server-side unit tests only (API route logic). The app itself is exercised in
// the running Expo build; these tests guard the security-sensitive route rules.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.ts'],
  },
});
