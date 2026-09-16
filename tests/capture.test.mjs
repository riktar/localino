import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { cp, mkdir, mkdtemp, writeFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mainPage } from './helpers.mjs'

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
async function prepare() {
  await mkdir('test-results/profiles', { recursive: true })
  const root = await mkdtemp(resolve('test-results/profiles/capture-'))
  const application = join(root, 'app')
  await cp('out', join(application, 'out'), { recursive: true })
  await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'localino-capture-test', version: '1.0.0', main: 'out/main/index.js' }))
  return { root, application, executable: join(application, 'out/native/Localino.Capture.exe'), profile: join(root, 'profile') }
}

test('native gesture implementation and helper start/disable/quit protocol (no OS gesture simulated)', async () => {
  const binary = resolve('out/native/Localino.Capture.exe')
  const fsm = spawnSync(binary, ['--self-test'], { windowsHide: true, encoding: 'utf8' })
  assert.equal(fsm.status, 0); assert.match(fsm.stdout, /gesture-tests-ok/)
  const child = spawn(binary, [], { windowsHide: true, stdio: 'pipe' })
  let output = ''; child.stdout.on('data', data => { output += data })
  const wait = async pattern => { const until = Date.now() + 5000; while (!pattern.test(output) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); assert.match(output, pattern) }
  try {
    await wait(/"type":"ready"/)
    child.stdin.write('disable\n'); await wait(/"enabled":false/)
    child.stdin.write('enable\n'); await wait(/"enabled":true/)
    const exit = once(child, 'exit'); child.stdin.end(); await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(Error('helper did not exit on EOF')), 5000).unref())])
  } finally { if (child.exitCode === null) child.kill() }
})

test('capture UI with protocol fixture: exact text, protected draft, save retry, cancel, settings and IPC ownership', async () => {
  const setup = await prepare()
  const compile = spawnSync(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', `/out:${setup.executable}`, '/reference:System.Web.Extensions.dll', resolve('tests/fixtures/capture-helper.cs')], { windowsHide: true, encoding: 'utf8' })
  assert.equal(compile.status, 0, compile.stdout)
  // Unreadable store exercises a real persistence failure. Repair and reload permit retry.
  await mkdir(join(setup.profile, 'notes.json'), { recursive: true })
  const app = await electron.launch({ args: [setup.application, `--user-data-dir=${setup.profile}`], env })
  try {
    const page = await mainPage(app); page.setDefaultTimeout(7000)
    await page.waitForFunction(async () => (await window.localino.getCaptureStatus()).status === 'ready')
    assert.equal(await page.evaluate(async () => { try { await window.localino.getCaptureDraft(); return false } catch { return true } }), true)
    const opening = app.waitForEvent('window')
    await page.evaluate(() => window.localino.requestCapture())
    const draftPage = await opening
    assert.ok(draftPage)
    await draftPage.getByRole('heading', { name: 'Cattura selezione', exact: true }).waitFor()
    const editor = draftPage.getByRole('textbox', { name: 'Testo da salvare' })
    await draftPage.waitForFunction(() => !document.querySelector('textarea').readOnly)
    const text = 'Prova Localino 🌱\nSeconda riga è 漢字'
    assert.equal(await editor.inputValue(), text)
    await editor.fill(text + '\nModifica protetta')
    await page.evaluate(() => window.localino.requestCapture())
    assert.equal(await editor.inputValue(), text + '\nModifica protetta')
    await editor.press('Control+Enter'); await draftPage.getByRole('alert').waitFor()
    assert.equal(await editor.inputValue(), text + '\nModifica protetta')
    await rename(join(setup.profile, 'notes.json'), join(setup.profile, 'unreadable-store'))
    await page.evaluate(() => window.localino.reloadNotes())
    await editor.press('Control+Enter')
    await page.waitForFunction(async () => (await window.localino.getNotes()).notes.length === 1)
    assert.equal((await page.evaluate(() => window.localino.getNotes())).notes[0].text, text + '\nModifica protetta')
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=capture')).isVisible()), false)
    await page.evaluate(() => window.localino.requestCapture())
    await editor.waitFor({ state: 'visible' }); await editor.press('Escape')
    assert.equal((await page.evaluate(() => window.localino.getNotes())).notes.length, 1)
    await writeFile(join(setup.application, 'out/native/mode.txt'), 'empty')
    await page.evaluate(() => window.localino.requestCapture())
    await draftPage.getByRole('status').filter({ hasText: 'Nessuna selezione' }).waitFor()
    assert.equal(await editor.inputValue(), '')
    await editor.fill('Incolla volontario sintetico')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=capture')).setSize(580, 460))
    assert.equal(await draftPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await draftPage.screenshot({ path: 'test-results/capture-minimum.png' })
    await editor.press('Escape')
    await page.evaluate(() => window.localino.navigate('shortcuts'))
    await page.getByRole('checkbox', { name: 'Abilita doppio Shift' }).uncheck()
    await page.waitForFunction(async () => !(await window.localino.getCaptureStatus()).enabled)
    assert.match(await page.getByRole('main').innerText(), /accessibilitySupport/)
    const state = await page.evaluate(() => window.localino.getShortcuts())
    assert.equal(state.bindings.find(b => b.id === 'capture' && b.scope === 'global').key, 'Ctrl+Alt+P')
  } finally { await app.close() }
})

test('missing packaged-style helper leaves library and manual capture usable', async () => {
  const setup = await prepare()
  await rename(setup.executable, setup.executable + '.unavailable')
  const app = await electron.launch({ args: [setup.application, `--user-data-dir=${setup.profile}`], env })
  try {
    const page = await mainPage(app)
    await page.waitForFunction(async () => (await window.localino.getCaptureStatus()).status === 'error')
    await page.getByRole('alert').filter({ hasText: 'Componente di cattura' }).waitFor()
    const opening = app.waitForEvent('window')
    await page.evaluate(() => window.localino.requestCapture())
    const draft = await opening
    const editor = draft.getByRole('textbox', { name: 'Testo da salvare' }); await editor.fill('Componente assente: salvataggio manuale')
    await editor.press('Control+Enter')
    await page.waitForFunction(async () => (await window.localino.getNotes()).notes.length === 1)
    assert.equal((await page.evaluate(() => window.localino.getNotes())).notes[0].completed, false)
  } finally { await app.close() }
})
