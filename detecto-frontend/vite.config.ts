import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  /**
   * Every module's real transport (see lib/alerts/api.ts and its siblings)
   * fetches a relative /api path — same-origin by design, so nothing in
   * application code has to know where the backend lives. In dev that
   * origin is the Vite server itself, so without this it has nothing to
   * forward those requests to. Only active when VITE_USE_MOCKS=false
   * actually reaches for it; the mocked dev experience (the default) never
   * touches this.
   */
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
        timeout: 10 * 60 * 1000,
        proxyTimeout: 10 * 60 * 1000,
      },
    },
  },

  /**
   * Tests run through the app's own Vite config, which is the point of using
   * Vitest here rather than a standalone runner: `import.meta.env.DEV` is true,
   * the `@` alias resolves, and the dev mocks behave exactly as they do in the
   * browser. A test that had to be told how to resolve a module would be
   * testing its own setup.
   *
   * `happy-dom` gives a real document, so components render on the client path
   * they actually ship on — effects run, and `matchMedia` answers, which is what
   * `useReducedMotion` reads.
   */
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Mocks in `lib/*/api.ts` keep module-level state for the session, the way
    // a real store would. Isolating files keeps one suite's writes — a
    // suspended tenant, a saved note — out of the next one's fixtures.
    isolate: true,
  },
})
