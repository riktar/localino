import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir,mkdtemp,readFile,writeFile,rmdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { mainPage } from './helpers.mjs'

test('Clipboard exact text, search, copy, completion, guarded navigation/close, deletion and restart',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/clipboard-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const launch=()=>electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  let app=await launch()
  try {
    let page=await mainPage(app)
    await page.getByRole('navigation').getByRole('button',{name:'Clipboard',exact:true}).click()
    await page.getByRole('button',{name:'Nuovo prompt',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Testo del prompt'})
    const text='  Un prompt 🌱\nSeconda riga è 漢字\n  '
    await editor.fill(text)
    await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Resta',exact:true}).click()
    assert.equal(await editor.inputValue(),text)
    assert.equal(await editor.evaluate(e=>document.activeElement===e),true)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).close())
    await page.getByRole('dialog').getByRole('button',{name:'Resta',exact:true}).click()
    await editor.press('Control+Enter')
    await page.getByText('Prompt salvato.',{exact:true}).waitFor()
    assert.equal(await page.locator('[data-note-text]').textContent(),text)
    const before=await page.evaluate(()=>window.localino.getNotes())
    assert.equal(before.notes.length,1);assert.equal(before.notes[0].text,text)
    await app.evaluate(async ({clipboard,ClipboardItem})=>{
      globalThis.clipboardBefore = await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))))
    })
    try {await page.getByRole('button',{name:'Copia',exact:true}).click();await page.getByText('Prompt copiato negli appunti.').waitFor();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),text)}
    finally {await app.evaluate(async ({clipboard},text)=>{if(await clipboard.readText()===text){if(globalThis.clipboardBefore.length)await clipboard.write(globalThis.clipboardBefore);else clipboard.clear()}},text)}
    await page.getByRole('searchbox',{name:'Cerca prompt'}).fill('SECONDA')
    assert.equal(await page.getByRole('region',{name:'Elenco prompt'}).getByRole('button').count(),1)
    await page.getByRole('button',{name:'Completa',exact:true}).click()
    await page.getByText('Prompt completato.',{exact:true}).waitFor()
    await page.getByLabel('Mostra',{exact:true}).selectOption('completed')
    assert.equal(await page.getByRole('region',{name:'Elenco prompt'}).getByRole('button').count(),1)
    await page.getByRole('button',{name:'Riapri',exact:true}).click()
    await page.getByRole('button',{name:'Modifica',exact:true}).click()
    await editor.fill(text+' aggiornato')
    await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Salva',exact:true}).click()
    await page.getByRole('heading',{name:'Benvenuto in Localino'}).waitFor()
    await app.close();app=await launch();page=await mainPage(app)
    await page.getByRole('navigation').getByRole('button',{name:'Clipboard',exact:true}).click()
    await page.getByRole('region',{name:'Elenco prompt'}).getByRole('button').click()
    assert.equal(await page.locator('[data-note-text]').textContent(),text+' aggiornato')
    const persisted=JSON.parse(await readFile(join(profile,'notes.json'),'utf8'))
    assert.equal(persisted.notes[0].id,before.notes[0].id)
    await page.getByRole('button',{name:'Elimina',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Annulla'}).click()
    assert.equal(await page.locator('[data-note-text]').textContent(),text+' aggiornato')
    await page.getByRole('button',{name:'Elimina',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Elimina',exact:true}).click()
    await page.getByText('Prompt eliminato.',{exact:true}).waitFor()
    assert.equal(JSON.parse(await readFile(join(profile,'notes.json'),'utf8')).notes.length,0)
  } finally {await app.close()}
})

test('1000 notes search within 500ms, Unicode edit, minimum layout and oversized recoverable draft',async()=>{
  const profile=await mkdtemp(resolve('test-results/profiles/clipboard-large-'))
  const notes=Array.from({length:1000},(_,i)=>({id:`fixture-${i}`,text:`Nota ${i} — ${i===876?'BERSAGLIO':'appunto'}\nSeconda riga`,createdAt:i+1,updatedAt:i+1,completed:false}))
  await writeFile(join(profile,'notes.json'),JSON.stringify({version:1,notes}))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const page=await mainPage(app)
    await page.getByRole('navigation').getByRole('button',{name:'Clipboard',exact:true}).click()
    await page.getByText('1000 prompt · Più recenti per primi',{exact:true}).waitFor()
    const started=performance.now()
    await page.getByRole('searchbox',{name:'Cerca prompt'}).fill('bersaglio')
    await page.getByText('1 prompt · Più recenti per primi',{exact:true}).waitFor()
    const searchMs=performance.now()-started;assert.ok(searchMs<500,`search: ${searchMs}ms`)
    await page.getByRole('region',{name:'Elenco prompt'}).getByRole('button').click()
    await page.getByRole('button',{name:'Modifica',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Testo del prompt'})
    await editor.fill('x'.repeat(100001))
    await page.getByRole('button',{name:'Salva prompt',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'limite'}).waitFor()
    assert.equal((await editor.inputValue()).length,100001)
    await editor.fill('Testo corretto 🌱\nFine')
    await page.getByRole('button',{name:'Salva prompt',exact:true}).click()
    await page.getByText('Prompt salvato.',{exact:true}).waitFor()
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).setSize(800,600))
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:'test-results/clipboard-minimum.png'})
    await writeFile('test-results/clipboard-performance.json',JSON.stringify({notes:1000,searchMs,environment:'Windows x64 / Electron44'}))
  } finally {await app.close()}
})

test('Corrupt file remains intact; write errors retain draft and retry works without account',async()=>{
  const profile=await mkdtemp(resolve('test-results/profiles/clipboard-errors-'))
  const file=join(profile,'notes.json');await writeFile(file,'{broken')
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const page=await mainPage(app)
    await page.getByRole('navigation').getByRole('button',{name:'Clipboard',exact:true}).click()
    await page.getByRole('alert').filter({hasText:file}).waitFor()
    assert.equal(await readFile(file,'utf8'),'{broken')
    assert.equal(await page.getByRole('button',{name:'Nuovo prompt',exact:true}).isDisabled(),true)
    await page.getByRole('navigation').getByRole('button',{name:'Consumi',exact:true}).click()
    await page.getByRole('button',{name:'Collega Codex',exact:true}).waitFor()
    await page.getByRole('navigation').getByRole('button',{name:'Clipboard',exact:true}).click()
    await writeFile(file,JSON.stringify({version:1,notes:[]}))
    await page.getByRole('button',{name:'Riprova lettura'}).click()
    await page.getByRole('button',{name:'Nuovo prompt',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Testo del prompt'});await editor.fill('Bozza recuperabile')
    // Redirect writes to a directory by swapping only this isolated fixture path.
    const {rename}=await import('node:fs/promises');await rename(file,`${file}.backup`);await mkdir(file)
    await page.getByRole('button',{name:'Salva prompt',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Salvataggio non riuscito'}).waitFor()
    assert.equal(await editor.inputValue(),'Bozza recuperabile')
    assert.equal(await page.getByText('Prompt salvato.',{exact:true}).count(),0)
    await rmdir(file);await rename(`${file}.backup`,file)
    await page.getByRole('button',{name:'Salva prompt',exact:true}).click()
    await page.getByText('Prompt salvato.',{exact:true}).waitFor()
  } finally {await app.close()}
})
