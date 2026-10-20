import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    environment: 'node',
    // Network tests open real sockets; give them room but keep the suite fast.
    testTimeout: 5000,
    server: {
      deps: {
        // node:sqlite is younger than the builtin list Vite knows about.
        external: ['node:sqlite'],
      },
    },
  },
});
