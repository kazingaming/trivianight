import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const SERVER_PORT = process.env.SERVER_PORT ?? '8787';
const serverTarget = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point at source so the workspace packages need no build step.
      '@trivia/shared': r('../../packages/shared/src/index.ts'),
      '@trivia/content': r('../../packages/content/src/index.ts'),
      '@trivia/engine': r('../../packages/engine/src/index.ts'),
      '@': r('./src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Same-origin in dev and in production, so no CORS anywhere.
      '/ws': { target: serverTarget, ws: true, changeOrigin: true },
      '/api': { target: serverTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
