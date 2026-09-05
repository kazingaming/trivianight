import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@trivia/shared': r('./packages/shared/src/index.ts'),
      '@trivia/content': r('./packages/content/src/index.ts'),
      '@trivia/engine': r('./packages/engine/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // The worker suites boot wrangler and play real matches against it.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    /*
     * One file at a time. Each worker suite starts its own workerd instance,
     * and running several at once starves them of CPU badly enough to make
     * round timing flaky — which looks like a product bug and is not one.
     */
    fileParallelism: false,
    environment: 'node',
  },
});
