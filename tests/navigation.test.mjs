import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mainPage } from './helpers.mjs'
import { spawn } from 'node:child_process'

test('Home navigation, offline sections, trusted routes, minimum layout and actual second instance', async () => {
  await mkdir('test-results/profiles', { recursive: true })
  const profile = await mkdtemp(resolve('test-results/profiles/navigation-'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env })
  try {
    const page = await mainPage(app)
    await page.getByRole('heading', { name: 'Benvenuto in Localino' }).waitFor()
    const nativeTitle = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).getTitle())
    assert.equal(await nativeTitle(), 'Localino — Home')
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ main: w.webContents.getURL().includes('view=main'), visible: w.isVisible() })).sort((a,b) => Number(a.main)-Number(b.main))), [{ main: false, visible: false }, { main: true, visible: true }])
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=main')).setSize(800,600))
    for (const [label, title] of [['Consumi','Statistiche Codex'], ['Clipboard','Clipboard'], ['Scorciatoie','Scorciatoie'], ['Home','Benvenuto in Localino']]) {
      const link = page.getByRole('navigation').getByRole('button', { name: label, exact: true })
      await link.focus(); await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: title, exact: true }).waitFor()
      assert.equal(await link.getAttribute('aria-current'), 'page')
      assert.equal(await nativeTitle(), `Localino — ${label}`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    // Exercise the actual MenuItems; OS tray click mechanism has separate historical evidence.
    await app.evaluate(({Tray})=>{const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.navigationMenu=menu;return original.call(this,menu)}})
    await page.evaluate(()=>window.localino.disconnect())
    for (const [label, route] of [['Apri Home','home'],['Apri Consumi','consumi'],['Apri Clipboard','clipboard'],['Scorciatoie','shortcuts']]) {
      await app.evaluate((_electron,label)=>globalThis.navigationMenu.items.find(item=>item.label===label).click(),label)
      await page.locator(`[data-destination="${route}"]`).waitFor()
      assert.equal(app.windows().length,2)
    }
    await assert.rejects(page.evaluate(() => window.localino.navigate('invalid')))
    await page.getByRole('navigation').getByRole('button', { name: 'Clipboard', exact: true }).click()
    await page.evaluate(() => window.localino.hide())
    const child = spawn(await app.evaluate(() => process.execPath), ['.', `--user-data-dir=${profile}`], { env, windowsHide: true, stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`second instance: ${code}`))) })
    await page.getByRole('heading', { name: 'Benvenuto in Localino' }).waitFor()
    assert.equal(await nativeTitle(), 'Localino — Home')
    assert.equal(app.windows().length, 2)
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length), 1)
    await page.screenshot({ path: 'test-results/home-minimum.png' })
  } finally { await app.close() }
})
