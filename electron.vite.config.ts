import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'history-worker': resolve('src/main/agents/history-worker.ts') } } } },
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
