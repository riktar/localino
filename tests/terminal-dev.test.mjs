import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn, execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, utimes, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve, dirname } from 'node:path'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await pause(100) }
  throw Error('Dev terminal condition timed out')
}

test('npm run dev builds absent Ink worker and rebuilds it when its source changes', { timeout: 90000 }, async () => {
  await mkdir('test-results/profiles', { recursive: true })
  const profile = await mkdtemp(resolve('test-results/profiles/dev-terminal-'))
  const project = await mkdtemp(resolve('test-results/profiles/dev-project-'))
  const workerFile = resolve('out/main/ink-worker.mjs'), source = resolve('src/main/sessions/ink-viewport.ts')
  const sourceTimes = await stat(source)
  const sourceBytes = await readFile(source)
  // Only generated output is removed; the temporary source edit is restored.
  await rm(workerFile, { force: true })
  const port = await new Promise(resolvePort => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) }) })
  const env = { ...process.env, ELECTRON_ENTRY: resolve('tests/fixtures/dev-terminal-entry.cjs'), LOCALINO_TEST_PROJECT: project,
    LOCALINO_CODEX_PATH: resolve(process.platform === 'win32' ? 'tests/fixtures/session-agent.cmd' : 'tests/fixtures/session-agent.mjs'),
    ELECTRON_CLI_ARGS: JSON.stringify([`--user-data-dir=${profile}`]), REMOTE_DEBUGGING_PORT: String(port) }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const npmCli = process.env.npm_execpath || (process.platform === 'win32' ? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : '/usr/share/nodejs/npm/bin/npm-cli.js')
  const child = spawn(process.execPath, [npmCli, 'run', 'dev'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = '', browser, stage = 'debug endpoint'
  child.stdout.on('data', data => { log += data }); child.stderr.on('data', data => { log += data })
  try {
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { return false } })
    assert.ok((await stat(workerFile)).size > 100000)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    stage = 'initial terminal'
    const context = browser.contexts()[0], panel = context.pages()[0]
    await panel.waitForFunction(() => typeof window.localino?.openDashboard === 'function')
    await panel.locator('[data-destination]').waitFor()
    await waitFor(async () => {
      if (context.pages().some(page => page.url().includes('view=usage'))) return true
      await panel.evaluate(() => window.localino.openDashboard()); return false
    })
    const page = context.pages().find(page => page.url().includes('view=usage'))
    await page.locator('[data-live-sessions="codex"]').getByText(/CLI available|localino-session-fixture/).waitFor()
    await page.getByRole('button', { name: 'Start session', exact: true }).click()
    const card = page.locator('[data-session-id]')
    await card.locator('[data-session-status="idle"]').waitFor(); await card.press('Enter')
    await page.waitForFunction(() => document.querySelector('.xterm-accessibility')?.textContent.includes('dev-project-'))
    const before = (await stat(workerFile)).mtimeMs
    stage = 'source watch rebuild'
    await writeFile(source, Buffer.concat([sourceBytes, Buffer.from('\n// Dev watcher regression probe.\n')]))
    await waitFor(async () => { try { return (await stat(workerFile)).mtimeMs > before } catch { return false } })
    assert.ok(log.includes('watching for file changes'))
  } catch (error) {
    throw new Error(`${stage}: ${error.message}\nDev log:\n${log.slice(-6000)}`, { cause: error })
  } finally {
    // Stop only the process tree started by this test, including Vite's restarted Electron.
    if (child.exitCode === null && process.platform === 'win32') await new Promise(resolveKill => execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => resolveKill()))
    else if (child.exitCode === null) child.kill('SIGTERM')
    await browser?.close().catch(() => {})
    await writeFile(source, sourceBytes)
    await utimes(source, sourceTimes.atime, sourceTimes.mtime)
  }
})
