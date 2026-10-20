import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

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
      '/maps': {
        target: 'http://127.0.0.1:3000',
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: `${here}index.html`,
        editor: `${here}editor.html`,
      },
    },
  },
});
