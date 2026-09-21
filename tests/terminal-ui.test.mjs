import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mainPage, packagedExecutable } from './helpers.mjs'
import headless from '@xterm/headless'

for (const packaged of process.env.LOCALINO_PACKAGED_TEST ? [true] : [false]) {
  test(`Ink terminal ${packaged ? 'packaged' : 'development'}: Unicode, sandbox, IPC, resize, cleanup`, { timeout: 60000 }, async () => {
    await mkdir('test-results/profiles', { recursive: true })
    const profile = await mkdtemp(resolve('test-results/profiles/terminal-'))
    const project = await mkdtemp(resolve('test-results/profiles/ink-project-'))
    const fixture = resolve(process.platform === 'win32' ? 'tests/fixtures/session-agent.cmd' : 'tests/fixtures/session-agent.mjs')
    if (process.platform !== 'win32') await chmod(fixture, 0o755)
    const env = { ...process.env, LOCALINO_CODEX_PATH: fixture }
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({ ...(packaged ? { executablePath: packagedExecutable(), args: [`--user-data-dir=${profile}`] } : { args: ['.', `--user-data-dir=${profile}`] }), env })
    try {
      const page = await mainPage(app)
      const errors = []; page.on('pageerror', error => errors.push(error.message))
      await page.locator('[data-live-sessions="codex"]').getByText(/CLI available|localino-session-fixture/).waitFor()
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, project)
      await page.getByRole('button', { name: 'Start session', exact: true }).click()
      const card = page.locator('[data-session-id]')
      await card.locator('[data-session-status="idle"]').waitFor()
      await card.press('Enter')
      await card.locator('.xterm-screen').waitFor()
      const message = 'Hello λ🌍\nsecond line \x1b]52;c;ZXZpbA==\x07'
      await card.getByRole('textbox', { name: /Message for/ }).fill(message)
      await card.getByRole('button', { name: 'Send', exact: true }).click()
      await page.waitForFunction(() => {const text=document.querySelector('.xterm-accessibility')?.textContent;return text?.includes('Hello λ🌍')&&text.includes('Codex')})
      const conversation = await card.locator('.xterm-accessibility').innerText()
      assert.ok(conversation.includes('␛]52'))
      assert.ok(conversation.includes('You'))
      assert.ok(conversation.includes('Codex'))
      assert.equal(/Turn started|completed|Unsupported event|prompt ·|assistant ·/.test(conversation),false)
      assert.equal(await page.getByRole('heading',{name:'Saved transcripts'}).count(),0)
      assert.equal(await card.getByRole('list',{name:'Message deliveries'}).count(),0)
      const prefs = await app.evaluate(({ BrowserWindow }) => {
        const prefs = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=usage')).webContents.getLastWebPreferences()
        return { sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation }
      })
      assert.deepEqual(prefs, { sandbox: true, nodeIntegration: false, contextIsolation: true })
      const results = await page.evaluate(async () => {
        const state = await window.localino.getLiveSessions()
        const bad = [{ sessionId: '../bad', viewId: 'v', columns: 80, rows: 10 }, { sessionId: state.sessions[0].id, viewId: 'v', columns: 1000000, rows: 10 }]
        return Promise.all(bad.map(value => window.localino.openTerminal(value).then(() => false, () => true)))
      })
      assert.deepEqual(results, [true, true])
      const sessionId = await card.getAttribute('data-session-id')
      const denied = await app.evaluate(async ({ BrowserWindow, app }, sessionId) => {
        const { join } = process.getBuiltinModule('node:path')
        const foreign = new BrowserWindow({ show: false, webPreferences: { preload: join(app.getAppPath(), 'out/preload/index.js'), sandbox: true, nodeIntegration: false, contextIsolation: true } })
        try {
          const url = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=usage')).webContents.getURL()
          await foreign.loadURL(url)
          return await foreign.webContents.executeJavaScript(`window.localino.openTerminal(${JSON.stringify({ sessionId, viewId: 'foreign', columns: 80, rows: 12 })}).then(()=>false,()=>true)`)
        } finally { foreign.destroy() }
      }, sessionId)
      assert.equal(denied, true)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=usage')).setMinimumSize(360, 460))
      for (const width of [420, 360, 900]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=usage')).setSize(width, 640), width)
        await page.waitForTimeout(80)
        const terminalText = await card.locator('.xterm-accessibility-tree').innerText()
        assert.equal((terminalText.match(/Hello λ🌍/g) ?? []).length, 1)
        assert.equal((terminalText.match(/second line/g) ?? []).length, 1)
      }
      await page.screenshot({ path: `test-results/terminal-${packaged ? 'packaged' : 'dev'}.png` })
      assert.deepEqual(errors, [])
      assert.equal(await card.getByRole('alert').count(), 0)
      // This worker path is inside ASAR in the distributed app, with no external modules.
      const probe = await app.evaluate(async ({ app }) => {
        const { Worker } = process.getBuiltinModule('node:worker_threads')
        const { join } = process.getBuiltinModule('node:path')
        const worker = new Worker(join(app.getAppPath(), 'out/main/ink-worker.mjs'), { stdout: true, stderr: true })
        let output = ''
        const frames = []
        worker.stdout.on('data', data => { output += data }); worker.stderr.on('data', data => { output += data })
        return new Promise((resolveProbe, reject) => {
          const timeout = setTimeout(() => { void worker.terminate(); reject(Error('Packaged Ink timeout')) }, 15000)
          worker.on('error', error => { clearTimeout(timeout); reject(error) })
          worker.on('message', frame => {
            frames.push(frame)
            if (frame.data.includes('END')) worker.postMessage({ type: 'dispose' })
          })
          worker.once('exit', code => { clearTimeout(timeout); resolveProbe({ code, output, frames }) })
          for (let i = 1; i <= 5000; i++) worker.postMessage({ type: 'update', viewport: { viewId: 'probe', sessionId: 'probe', columns: 80, rows: 100 }, lines: [{ label: 'Unicode', text: 'λ'.repeat(i) + (i === 5000 ? '🌍 END' : ''), role: 'assistant' }] })
        })
      })
      assert.equal(probe.code, 0); assert.equal(probe.output, ''); assert.ok(probe.frames.length > 0)
      const oracle = new headless.Terminal({ cols: 80, rows: 100, scrollback: 1000, convertEol: true, allowProposedApi: true })
      try {
        for (const frame of probe.frames) {
          if (frame.reset) { oracle.reset(); oracle.resize(frame.columns, frame.rows) }
          await new Promise(resolveWrite => oracle.write(frame.data, resolveWrite))
        }
        const content = Array.from({ length: oracle.buffer.active.length }, (_, index) => oracle.buffer.active.getLine(index)?.translateToString(true) ?? '').join('\n')
        assert.equal((content.match(/λ/g) ?? []).length, 5000)
        assert.equal((content.match(/🌍 END/g) ?? []).length, 1)
      } finally { oracle.dispose() }
    } finally { await app.close() }
  })
}
