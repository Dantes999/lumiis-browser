import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // The dev server only serves the client. The game server owns /ws and the
    // production build, so both live behind the same URL in every mode.
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
