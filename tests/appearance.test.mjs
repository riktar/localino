import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { panelPage, waitFor } from './helpers.mjs'

test('frameless windows, persistent synchronized themes, live system scheme and reduced motion', async () => {
  await mkdir('test-results/profiles', { recursive: true })
  const profile = await mkdtemp(resolve('test-results/profiles/appearance-'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const launch = () => electron.launch({ args: ['.', '--user-data-dir=' + profile], env })
  let app = await launch()
  try {
    let page = await panelPage(app)
    assert.deepEqual(await page.evaluate(() => window.localino.getTheme()), { preference: 'system' })
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system')
    assert.equal(await page.locator('.panel-header').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'drag')
    assert.equal(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'no-drag')
    assert.equal(await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w.getBounds().height - w.getContentBounds().height < 15 }), true, 'No native caption above app content')
    await assert.rejects(page.evaluate(() => window.localino.setTheme('invalid')))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
    await theme.selectOption('dark')
    await waitFor(page, () => getComputedStyle(document.body).backgroundColor === 'rgb(25, 26, 29)')
    await page.screenshot({ path: 'test-results/appearance-dark-settings.png' })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.evaluate(() => window.localino.mutateNote({ kind: 'create', text: 'A compact panel. Everything within reach.' }))
    await page.locator('.note-row').waitFor()
    await page.screenshot({ path: 'test-results/appearance-dark-panel.png' })
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.localino.openDashboard())
    const usage = await opened
    await usage.getByRole('button', { name: 'Back to panel', exact: true }).waitFor()
    await waitFor(usage, () => getComputedStyle(document.body).backgroundColor === 'rgb(25, 26, 29)')
    await usage.getByRole('button', { name: 'Maximize or restore window' }).click()
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=usage')).isMaximized()), true)
    await usage.getByRole('button', { name: 'Maximize or restore window' }).click()
    await usage.getByRole('button', { name: 'Close usage' }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await theme.selectOption('light')
    await waitFor(page, () => getComputedStyle(document.body).backgroundColor === 'rgb(250, 249, 246)')
    await waitFor(usage, () => getComputedStyle(document.body).backgroundColor === 'rgb(250, 249, 246)')
    await theme.selectOption('system')
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system')
    // Media emulation tests the OS-change renderer path without altering the host OS.
    await page.emulateMedia({ colorScheme: 'dark' })
    await waitFor(page, () => document.documentElement.classList.contains('dark'))
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await waitFor(page, () => !document.documentElement.classList.contains('dark'))
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    assert.equal(await page.locator('.note-row').evaluate(el => getComputedStyle(el).animationName), 'none')
    assert.equal(await page.locator('.note-row').evaluate(el => getComputedStyle(el).transitionDuration), '0s')
    await page.screenshot({ path: 'test-results/appearance-light-panel.png' })
    await page.evaluate(() => window.localino.setTheme('dark'))
    assert.equal(JSON.parse(await readFile(join(profile, 'appearance.json'), 'utf8')).theme, 'dark')
    await app.close(); app = await launch(); page = await panelPage(app)
    assert.equal((await page.evaluate(() => window.localino.getTheme())).preference, 'dark')
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), true)
    await waitFor(page, () => getComputedStyle(document.body).backgroundColor === 'rgb(25, 26, 29)')
  } finally { await app.close() }
})
