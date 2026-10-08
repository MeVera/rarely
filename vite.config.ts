import { defineConfig } from 'vitest/config';

// In dev, /api/* is proxied to `wrangler dev` (default port 8787).
// `base: './'` keeps asset paths relative so the build works on GitHub Pages under /rarely/.
export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
});
