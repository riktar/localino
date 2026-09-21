import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { buildInk } from './scripts/build-ink.mjs'

export default defineConfig({
  main: {
    plugins: [{ name: 'localino-ink-worker',
      buildStart() {
        for (const file of ['src/main/sessions/ink-worker.ts','src/main/sessions/ink-viewport.ts','src/shared/terminal.ts','scripts/build-ink.mjs']) this.addWatchFile(resolve(file))
      },
      async writeBundle() { await buildInk() },
    }],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'history-worker': resolve('src/main/agents/history-worker.ts') } } },
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'localino-development-csp',
        apply: 'serve',
        transformIndexHtml: (html) => html
          .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"),
      },
    ],
  },
})
