import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

export async function desktopSmoke(packaged = false, rendererUrl = null) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  if (rendererUrl) env.ELECTRON_RENDERER_URL = rendererUrl
  await mkdir('test-results/profiles', { recursive: true })
  const profile = await mkdtemp(resolve('test-results/profiles/smoke-'))
  const instance = await electron.launch({
    ...(packaged
      ? { executablePath: resolve('dist/win-unpacked/Localino.exe'), args: [`--user-data-dir=${profile}`] }
      : { args: ['.', `--user-data-dir=${profile}`] }),
    env,
    timeout: 30_000,
  })
  try {
    const page = await instance.firstWindow()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('heading', { name: 'localino', exact: true }).waitFor()
    assert.equal(await page.getByText('Non collegato', { exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => typeof window.localino?.hide), 'function')
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined')
    const preferences = await instance.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }
    })
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(250, 249, 246)')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true)
    await mkdir('test-results', { recursive: true })
    await page.screenshot({ path: `test-results/${packaged ? 'packaged' : rendererUrl ? 'development' : 'desktop'}.png` })
    await page.getByRole('button', { name: 'Riduci nella barra' }).click()
    // The renderer and main process run independently; wait for the IPC side effect.
    await instance.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window.isVisible()) await new Promise(resolve => window.once('hide', resolve))
    })
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
    await instance.evaluate(({ app }) => { app.emit('activate') })
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true)
    await instance.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() })
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    await instance.evaluate(({ app }) => { app.emit('activate') })
    assert.deepEqual(errors, [])
  } finally {
    await instance.close()
  }
}
