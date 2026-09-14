import test from 'node:test'
import { resolve } from 'node:path'
import { createServer, loadConfigFromFile } from 'vite'
import { desktopSmoke } from './helpers.mjs'

test('Sviluppo: React e Tailwind serviti da Vite nella finestra Electron', { timeout: 60_000 }, async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, resolve('electron.vite.config.ts'))
  const server = await createServer({
    ...loaded.config.renderer,
    configFile: false,
    root: resolve('src/renderer'),
    server: { host: '127.0.0.1', port: 0 },
  })
  try {
    await server.listen()
    await desktopSmoke(false, server.resolvedUrls.local[0])
  } finally {
    await server.close()
  }
})
