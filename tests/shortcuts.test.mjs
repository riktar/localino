import test from 'node:test'
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {mainPage} from './helpers.mjs'
test('keyboard catalog, contextual editing, confirmations and persistent shortcut settings',async()=>{
 const profile=await mkdtemp(resolve('test-results/profiles/shortcuts-'))
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
 const launch=()=>electron.launch({args:['.',`--user-data-dir=${profile}`],env});let app=await launch()
 try{
 let page=await mainPage(app);page.setDefaultTimeout(7000)
 const openPalette=async(query)=>{await page.keyboard.press('Control+k');const box=page.getByRole('combobox',{name:'Cerca comando'});await box.fill(query);return box}
 let box=await openPalette('Nuovo prompt');await box.press('Enter')
 const editor=()=>page.getByRole('textbox',{name:'Testo del prompt'})
 await editor().fill('Prima riga');await editor().press('Enter');await editor().press('a')
 assert.equal(await editor().inputValue(),'Prima riga\na')
 await editor().evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true})))
 assert.equal(await editor().count(),1)
 await editor().press('Control+Enter');await page.getByText('Prompt salvato.',{exact:true}).waitFor()
 await page.keyboard.press('F2');await editor().fill('Modifica non salvata')
 box=await openPalette('Completa /');assert.equal(await page.getByRole('dialog').getByRole('option').getAttribute('aria-disabled'),'true')
 await box.press('Escape');assert.equal(await editor().evaluate(e=>e===document.activeElement),true)
 await editor().press('Escape');await page.getByRole('dialog').getByRole('button',{name:'Resta'}).click();assert.equal(await editor().inputValue(),'Modifica non salvata')
 await editor().press('Control+Enter');await page.getByText('Prompt salvato.',{exact:true}).waitFor()
 await page.keyboard.press('Control+Enter');await page.getByText('Prompt completato.',{exact:true}).waitFor()
 await page.keyboard.press('Control+Enter');await page.getByText('Prompt riaperto.',{exact:true}).waitFor()
 await page.keyboard.press('Delete');await page.getByRole('dialog').getByRole('button',{name:'Annulla'}).click()
 await page.keyboard.press('Control+f');assert.equal(await page.getByRole('searchbox').evaluate(e=>e===document.activeElement),true)
 await page.keyboard.press('Control+Comma');await page.getByRole('heading',{name:'Scorciatoie',exact:true}).waitFor()
 const field=()=>page.getByRole('textbox',{name:'Nuovo prompt Locale',exact:true})
 await field().fill('Ctrl+1');await field().locator('..').getByRole('button',{name:'Applica',exact:true}).click();await page.getByRole('alert').filter({hasText:'Collisione'}).waitFor()
 await field().fill('Ctrl+J');await field().locator('..').getByRole('button',{name:'Applica',exact:true}).click();await page.getByRole('status').filter({hasText:'salvate'}).waitFor()
 await page.keyboard.press('Tab');await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click()
 await page.keyboard.press('Control+j');await editor().waitFor();await editor().fill('Persistenza binding');await editor().press('Control+Enter');await page.getByText('Prompt salvato.',{exact:true}).waitFor()
 await app.close();app=await launch();page=await mainPage(app);await page.keyboard.press('Control+j');await editor().waitFor()
 await page.getByRole('button',{name:'Chiudi editor'}).click();await page.keyboard.press('Control+Comma')
 assert.equal(await field().inputValue(),'Ctrl+J')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).setSize(800,600))
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.screenshot({path:'test-results/shortcuts-minimum.png'})
 await page.getByRole('button',{name:'Ripristina default',exact:true}).click();await page.getByRole('status').filter({hasText:'salvate'}).waitFor();assert.equal(await field().inputValue(),'Ctrl+N')
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
})
test('real OS registrations: occupied startup, rollback and release on quit',async()=>{
 const profile=await mkdtemp(resolve('test-results/profiles/shortcuts-conflict-'))
 const helper=join(profile,'helper.cjs');await writeFile(helper,"const {app,globalShortcut}=require('electron');app.whenReady().then(()=>{if(!globalShortcut.register('Ctrl+Alt+L',()=>{}))throw Error('occupied');globalShortcut.register('Ctrl+Alt+O',()=>{});});app.on('will-quit',()=>globalShortcut.unregisterAll())")
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
 const holder=await electron.launch({args:[helper],env});let app
 try{
 await holder.evaluate(async({app})=>{await app.whenReady()})
 app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env});const page=await mainPage(app)
 const state=await page.evaluate(()=>window.localino.getShortcuts());assert.equal(state.bindings.find(b=>b.id==='home'&&b.scope==='global').active,false)
 assert.equal(state.bindings.find(b=>b.id==='clipboard'&&b.scope==='global').active,true)
 const failed=await page.evaluate(()=>window.localino.updateShortcuts({id:'clipboard',scope:'global',key:'Ctrl+Alt+O'}));assert.equal(failed.ok,false)
 assert.equal(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Ctrl+Alt+C')),true)
 await app.close();app=null
 assert.equal(await holder.evaluate(({globalShortcut})=>globalShortcut.register('Ctrl+Alt+C',()=>{})),true)
 }finally{if(app)await app.close();await holder.close()}
})
test('custom event keys work, native cursor editing is preserved and unavailable new cannot run',async()=>{
 const profile=await mkdtemp(resolve('test-results/profiles/shortcuts-rework-'))
 const file=join(profile,'notes.json');await writeFile(file,'{broken')
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
 const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
 try{
 const page=await mainPage(app);page.setDefaultTimeout(6000)
 await page.keyboard.press('Control+n');assert.equal(await page.getByRole('textbox',{name:'Testo del prompt'}).count(),0)
 await page.keyboard.press('Control+3');await page.getByRole('heading',{name:'Clipboard',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Nuovo prompt',exact:true}).isDisabled(),true)
 await page.keyboard.press('Control+k');const box=page.getByRole('combobox',{name:'Cerca comando'});await box.fill('Nuovo prompt')
 assert.equal(await page.getByRole('dialog').getByRole('option').getAttribute('aria-disabled'),'true');await box.press('Enter');assert.equal(await box.count(),1);await box.press('Escape')
 await writeFile(file,JSON.stringify({version:1,notes:[]}));await page.getByRole('button',{name:'Riprova lettura'}).click()
 for(const [key,press] of [['Ctrl+Space','Control+Space'],['Ctrl+Left','Control+ArrowLeft'],['Ctrl+Shift+1','Control+Shift+Digit1']]){
  assert.equal((await page.evaluate(key=>window.localino.updateShortcuts({id:'new',scope:'local',key}),key)).ok,true)
  await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click();await page.keyboard.press(press)
  const editor=page.getByRole('textbox',{name:'Testo del prompt'});await editor.waitFor()
  if(key==='Ctrl+Left'){
   await editor.fill('uno due');await editor.press('Control+ArrowLeft');assert.equal(await editor.inputValue(),'uno due');assert.equal(await page.getByRole('dialog').count(),0)
   await editor.press('Control+Enter');await page.getByText('Prompt salvato.',{exact:true}).waitFor()
  }else await page.getByRole('button',{name:'Chiudi editor'}).click()
 }
 await page.keyboard.press('Control+f');const search=page.getByRole('searchbox');await search.focus();await page.keyboard.press('Control+Comma')
 await page.getByRole('button',{name:'Chiudi impostazioni',exact:true}).click();await search.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('type')==='search')
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
})
