import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir,mkdtemp,readFile,writeFile,rmdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { panelPage as mainPage } from './helpers.mjs'

test('Clipboard exact text, search, copy, completion, guarded navigation/close, deletion and restart',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/clipboard-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const launch=()=>electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  let app=await launch()
  try {
    let page=await mainPage(app)
    await page.getByRole('button',{name:'New note',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Note text'})
    const text='  Un prompt 🌱\nSeconda riga è 漢字\n  '
    await editor.fill(text)
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Stay',exact:true}).click()
    assert.equal(await editor.inputValue(),text)
    assert.equal(await editor.evaluate(e=>document.activeElement===e),true)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).close())
    await page.getByRole('dialog').getByRole('button',{name:'Stay',exact:true}).click()
    await editor.press('ControlOrMeta+Enter')
    await page.getByText('Saved.',{exact:true}).waitFor()
    await page.getByRole('button',{name:/^Read note:/}).click()
    assert.equal(await page.locator('[data-note-text]').textContent(),text)
    const before=await page.evaluate(()=>window.localino.getNotes())
    assert.equal(before.notes.length,1);assert.equal(before.notes[0].text,text)
    await app.evaluate(async ({clipboard,ClipboardItem})=>{
      globalThis.clipboardBefore = await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))))
    })
    try {await page.getByRole('button',{name:'Copy',exact:true}).click();await page.getByText('Copied.').waitFor();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),text)}
    finally {await app.evaluate(async ({clipboard},text)=>{if(await clipboard.readText()===text){if(globalThis.clipboardBefore.length)await clipboard.write(globalThis.clipboardBefore);else clipboard.clear()}},text)}
    await page.getByRole('button',{name:'Back to list'}).click()
    await page.getByRole('button',{name:'Search and filter'}).click()
    await page.getByRole('searchbox',{name:'Search notes'}).fill('SECONDA')
    assert.equal(await page.locator('[data-note-id]').count(),1)
    await page.getByRole('button',{name:'Complete note',exact:true}).click()
    await page.getByText('Completed.',{exact:true}).waitFor()
    await page.getByLabel('Show notes',{exact:true}).selectOption('completed')
    assert.equal(await page.locator('[data-note-id]').count(),1)
    await page.getByRole('button',{name:'Reopen note',exact:true}).click()
    await page.getByLabel('Show notes',{exact:true}).selectOption('open')
    await page.getByRole('button',{name:'Edit note',exact:true}).click()
    await editor.fill(text+' aggiornato')
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click()
    await page.getByRole('heading',{name:'Settings',exact:true}).waitFor()
    await app.close();app=await launch();page=await mainPage(app)
    await page.getByRole('button',{name:/^Read note:/}).click()
    assert.equal(await page.locator('[data-note-text]').textContent(),text+' aggiornato')
    const persisted=JSON.parse(await readFile(join(profile,'notes.json'),'utf8'))
    assert.equal(persisted.notes[0].id,before.notes[0].id)
    await page.getByRole('button',{name:'Back to list'}).click()
    await page.getByRole('button',{name:'Delete note',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click()
    assert.equal(await page.locator('[data-note-id]').count(),1)
    await page.getByRole('button',{name:'Delete note',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click()
    await page.getByText('Deleted.',{exact:true}).waitFor()
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
    await page.waitForFunction(()=>document.querySelectorAll('[data-note-id]').length===1000)
    await page.getByRole('button',{name:'Search and filter'}).click()
    // Measure the approved interval: final input event -> committed result ready
    // for paint. Playwright's fill can spend time focusing an unfocused window.
    await page.evaluate(()=>{
      globalThis.searchTimes={}
      const input=document.querySelector('input[type=search]')
      const section=document.querySelector('[aria-label="Notes"]')
      input.addEventListener('input',()=>{globalThis.searchTimes.input=performance.now()},{once:true,capture:true})
      const observer=new MutationObserver(()=>{
        if(section.querySelectorAll('[data-note-id]').length===1){
          requestAnimationFrame(()=>{globalThis.searchTimes.frame=performance.now()})
          observer.disconnect()
        }
      })
      observer.observe(section,{subtree:true,childList:true,characterData:true})
    })
    const started=performance.now()
    await page.getByRole('searchbox',{name:'Search notes'}).fill('bersaglio')
    await page.waitForFunction(()=>document.querySelectorAll('[data-note-id]').length===1)
    await page.waitForFunction(()=>Number.isFinite(globalThis.searchTimes.frame))
    const harnessMs=performance.now()-started
    const searchMs=await page.evaluate(()=>globalThis.searchTimes.frame-globalThis.searchTimes.input)
    assert.ok(Number.isFinite(searchMs)&&searchMs>=0&&searchMs<500,`search: ${searchMs}ms`)
    await page.getByRole('button',{name:/^Read note:/}).click()
    await page.getByRole('button',{name:'Edit',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Note text'})
    await editor.fill('x'.repeat(100001))
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Limit'}).waitFor()
    assert.equal((await editor.inputValue()).length,100001)
    await editor.fill('Testo corretto 🌱\nFine')
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await page.getByText('Saved.',{exact:true}).waitFor()
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).setSize(360,460))
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:'test-results/clipboard-minimum.png'})
    await writeFile('test-results/clipboard-performance.json',JSON.stringify({notes:1000,searchMs,harnessMs,interval:'input event to frame after matching results',environment:process.platform+' '+process.arch+' / Electron44'}))
  } finally {await app.close()}
})

test('Corrupt file remains intact; write errors retain draft and retry works without account',async()=>{
  const profile=await mkdtemp(resolve('test-results/profiles/clipboard-errors-'))
  const file=join(profile,'notes.json');await writeFile(file,'{broken')
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const page=await mainPage(app)
    await page.getByRole('alert').filter({hasText:file}).waitFor()
    assert.equal(await readFile(file,'utf8'),'{broken')
    assert.equal(await page.getByRole('button',{name:'New note',exact:true}).isDisabled(),true)
    await page.getByRole('button',{name:'Connect',exact:true}).waitFor()
    await writeFile(file,JSON.stringify({version:1,notes:[]}))
    await page.getByRole('button',{name:'Retry'}).click()
    await page.getByRole('button',{name:'New note',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Note text'});await editor.fill('Bozza recuperabile')
    // Redirect writes to a directory by swapping only this isolated fixture path.
    const {rename}=await import('node:fs/promises');await rename(file,`${file}.backup`);await mkdir(file)
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Could not save'}).waitFor()
    assert.equal(await editor.inputValue(),'Bozza recuperabile')
    assert.equal(await page.getByText('Saved.',{exact:true}).count(),0)
    await rmdir(file);await rename(`${file}.backup`,file)
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await page.getByText('Saved.',{exact:true}).waitFor()
  } finally {await app.close()}
})
