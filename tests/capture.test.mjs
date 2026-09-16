import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { cp, mkdir, mkdtemp, writeFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mainPage } from './helpers.mjs'

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
async function waitInPage(page,predicate) {
  const deadline=Date.now()+7000
  while(Date.now()<deadline){if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,20))}
  assert.fail('Application condition did not become true')
}
async function closeTestApp(app) {
  // Failed assertions may leave a protected draft or an in-flight save. Bound
  // teardown of this isolated synthetic test process, without masking failures.
  const fallback=setTimeout(()=>{app.process().kill()},3000)
  try {await app.close()} finally {clearTimeout(fallback)}
}
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
    await waitInPage(page,async () => (await window.localino.getCaptureStatus()).status === 'ready')
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
    await draftPage.getByRole('status').filter({hasText:'Presentazione: 42 ms'}).waitFor()
    await editor.fill(text + '\nModifica protetta')
    await page.evaluate(() => window.localino.requestCapture())
    assert.equal(await editor.inputValue(), text + '\nModifica protetta')
    await editor.press('Control+Enter'); await draftPage.getByRole('alert').waitFor()
    assert.equal(await editor.inputValue(), text + '\nModifica protetta')
    await rename(join(setup.profile, 'notes.json'), join(setup.profile, 'unreadable-store'))
    await page.evaluate(() => window.localino.reloadNotes())
    await editor.press('Control+Enter')
    await waitInPage(page,async () => (await window.localino.getNotes()).notes.length === 1)
    assert.equal((await page.evaluate(() => window.localino.getNotes())).notes[0].text, text + '\nModifica protetta')
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=capture')).isVisible()), false)
    await page.waitForFunction(()=>document.querySelector('[data-note-text]')?.textContent.includes('Modifica protetta'))
    await writeFile(join(setup.application, 'out/native/mode.txt'), 'empty')
    await waitInPage(draftPage,async()=>await window.localino.getCaptureDraft()===null)
    await page.evaluate(() => window.localino.requestCapture())
    await draftPage.getByRole('status').filter({hasText:'Nessuna selezione'}).waitFor()
    await draftPage.evaluate(async()=>{const d=await window.localino.getCaptureDraft();await window.localino.cancelCapture(d.id)})
    assert.equal((await page.evaluate(() => window.localino.getNotes())).notes.length, 1)
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
    await waitInPage(page,async () => !(await window.localino.getCaptureStatus()).enabled)
    assert.match(await page.getByRole('main').innerText(), /accessibilitySupport/)
    const state = await page.evaluate(() => window.localino.getShortcuts())
    assert.equal(state.bindings.find(b => b.id === 'capture' && b.scope === 'global').key, 'Ctrl+Alt+P')
  } finally { await closeTestApp(app) }
})

test('missing packaged-style helper leaves library and manual capture usable', async () => {
  const setup = await prepare()
  await rename(setup.executable, setup.executable + '.unavailable')
  const app = await electron.launch({ args: [setup.application, `--user-data-dir=${setup.profile}`], env })
  try {
    const page = await mainPage(app)
    await waitInPage(page,async () => (await window.localino.getCaptureStatus()).status === 'error')
    await page.getByRole('alert').filter({ hasText: 'Componente di cattura' }).waitFor()
    const opening = app.waitForEvent('window')
    await page.evaluate(() => window.localino.requestCapture())
    const draft = await opening
    const editor = draft.getByRole('textbox', { name: 'Testo da salvare' }); await editor.fill('Componente assente: salvataggio manuale')
    await editor.press('Control+Enter')
    await waitInPage(page,async () => (await window.localino.getNotes()).notes.length === 1)
    assert.equal((await page.evaluate(() => window.localino.getNotes())).notes[0].completed, false)
  } finally { await closeTestApp(app) }
})


test('valid capture autosaves once, reveals the selected full prompt and preserves a suspended manual draft', async () => {
  const setup = await prepare()
  const compile = spawnSync(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', `/out:${setup.executable}`, '/reference:System.Web.Extensions.dll', resolve('tests/fixtures/capture-helper.cs')], { windowsHide:true, encoding:'utf8' })
  assert.equal(compile.status,0,compile.stdout)
  const app=await electron.launch({args:[setup.application,`--user-data-dir=${setup.profile}`],env})
  try {
    const page=await mainPage(app);page.setDefaultTimeout(7000)
    await waitInPage(page,async()=>(await window.localino.getCaptureStatus()).status==='ready')
    await page.evaluate(()=>window.localino.navigate('clipboard'))
    await page.getByRole('button',{name:'Nuovo prompt',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Testo del prompt'})
    await editor.fill('Bozza manuale da conservare\nSeconda riga')
    await page.getByRole('searchbox',{name:'Cerca prompt'}).fill('filtro che nasconde la cattura')
    await page.getByRole('combobox',{name:'Mostra'}).selectOption('completed')
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).minimize())
    await page.evaluate(()=>Promise.all(Array.from({length:5},()=>window.localino.requestCapture())))
    const expected='Prova Localino 🌱\nSeconda riga è 漢字'
    await page.locator('[data-note-text]').waitFor()
    assert.equal(await page.locator('[data-note-text]').innerText(),expected)
    assert.equal(await page.getByRole('searchbox',{name:'Cerca prompt'}).inputValue(),'')
    assert.equal(await page.getByRole('combobox',{name:'Mostra'}).inputValue(),'open')
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-pressed')==='true')
    await page.getByText('Ultima cattura · Acquisizione: 5 ms · Presentazione: 42 ms').waitFor()
    assert.equal((await page.evaluate(()=>window.localino.getNotes())).notes.length,1)
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('view=capture'))),false)
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).isMinimized()),false)
    assert.equal(await page.getByRole('dialog').count(),0)
    await page.getByRole('button',{name:'Riprendi bozza'}).click()
    assert.equal(await editor.inputValue(),'Bozza manuale da conservare\nSeconda riga')
    await page.getByRole('button',{name:'Salva prompt',exact:true}).click()
    await waitInPage(page,async()=>(await window.localino.getNotes()).notes.length===2)
    // A later, distinct capture must create a new item, even for identical text.
    await page.evaluate(()=>window.localino.requestCapture())
    await waitInPage(page,async()=>(await window.localino.getNotes()).notes.length===3)
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-pressed')==='true')
    assert.equal(await page.locator('[data-note-text]').innerText(),expected)
    await page.screenshot({path:'test-results/capture-autosave.png'})
  } finally {await closeTestApp(app)}
})

test('native foreground helper validates the target process and reports actual Windows foreground',async()=>{
  const app=await electron.launch({args:[resolve('.'),`--user-data-dir=${(await prepare()).profile}`],env})
  try {
    const page=await mainPage(app)
    const target=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main'));w.show();return {handle:w.getNativeWindowHandle().readBigUInt64LE().toString(),pid:process.pid}})
    const binary=resolve('out/native/Localino.Capture.exe')
    const invalid=spawnSync(binary,['--focus',target.handle,'1'],{windowsHide:true,encoding:'utf8',timeout:2000})
    assert.equal(invalid.stdout,'unavailable')
    const source=await app.evaluate(({BrowserWindow})=>{const w=new BrowserWindow({show:true,title:'Localino foreground test source'});return w.getNativeWindowHandle().readBigUInt64LE().toString()})
    const origin=spawnSync(binary,['--focus',source,String(target.pid)],{windowsHide:true,encoding:'utf8',timeout:2000})
    assert.equal(origin.stdout,'focused') // Actual Windows foreground is now a different owned window.
    const result=spawnSync(binary,['--focus',target.handle,String(target.pid)],{windowsHide:true,encoding:'utf8',timeout:2000})
    assert.equal(result.status,0);assert.equal(result.stdout,'focused')
    assert.ok(page)
  }finally {await closeTestApp(app)}
})
