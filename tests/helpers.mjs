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
      ? { executablePath: packagedExecutable(), args: [`--user-data-dir=${profile}`] }
      : { args: ['.', `--user-data-dir=${profile}`] }),
    env,
    timeout: 30_000,
  })
  try {
    await instance.firstWindow()
    const page = await panelPage(instance)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('heading', { name: 'Localino', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'New note', exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => typeof window.localino?.hide), 'function')
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined')
    const preferences = await instance.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).webContents.getLastWebPreferences()
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }
    })
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(250, 249, 246)')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true)
    await mkdir('test-results', { recursive: true })
    await page.screenshot({ path: `test-results/${packaged ? 'packaged' : rendererUrl ? 'development' : 'desktop'}.png` })
    await page.getByRole('button', { name: 'Hide panel' }).click()
    // The renderer and main process run independently; wait for the IPC side effect.
    await instance.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main'))
      if (window.isVisible()) await new Promise(resolve => window.once('hide', resolve))
    })
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).isVisible()), false)
    await instance.evaluate(({ app }) => { app.emit('activate') })
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).isVisible()), true)
    await instance.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).close() })
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).isVisible()), false)
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    await instance.evaluate(({ app }) => { app.emit('activate') })
    assert.deepEqual(errors, [])
  } finally {
    await instance.close()
  }
}

export function packagedExecutable() {
  return resolve(process.env.LOCALINO_TEST_EXECUTABLE || (process.platform==='darwin' ? 'dist/'+(process.arch==='arm64'?'mac-arm64':'mac')+'/Localino.app/Contents/MacOS/Localino' : 'dist/win-unpacked/Localino.exe'))
}
export async function panelPage(instance) {
  await instance.firstWindow()
  const page=instance.windows().find(p=>p.url().includes('view=main'))??await instance.firstWindow()
  page.setDefaultTimeout(7000)
  await page.locator('[data-destination]').waitFor()
  return page
}
export async function mainPage(instance) {
  const panel=await panelPage(instance)
  await panel.evaluate(()=>window.localino.openDashboard())
  const page=instance.windows().find(p=>p.url().includes('view=usage'))
  if(!page)throw Error('Usage window unavailable')
  page.setDefaultTimeout(7000)
  await page.getByRole('button',{name:'Back to panel',exact:true}).waitFor()
  return page
}
export const compactPage=panelPage
export async function waitFor(page,predicate,timeout=7000){const end=Date.now()+timeout;while(Date.now()<end){if(await page.evaluate(predicate))return;await new Promise(r=>setTimeout(r,20))}throw Error('Condition timed out')}
