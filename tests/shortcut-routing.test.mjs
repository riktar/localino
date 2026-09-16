import test from 'node:test'
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {resolve} from 'node:path'
import {panelPage,mainPage,waitFor} from './helpers.mjs'

test('Escape closes editors first and every Clipboard route guards drafts and focuses the list',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/routing-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.','--user-data-dir='+profile],env})
  try{
    const page=await panelPage(app),editor=page.getByRole('textbox',{name:'Note text'})
    await page.evaluate(()=>window.localino.mutateNote({kind:'create',text:'Existing note'}))
    await page.getByRole('button',{name:'New note',exact:true}).click()
    await editor.press('Escape');await editor.waitFor({state:'hidden'})
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true)
    await page.getByRole('button',{name:'New note',exact:true}).click();await editor.fill('Keep draft')
    await editor.press('ControlOrMeta+3');await page.getByRole('button',{name:'Stay',exact:true}).click()
    assert.equal(await editor.inputValue(),'Keep draft')
    await editor.press('ControlOrMeta+3');await page.getByRole('button',{name:'Discard',exact:true}).click()
    await editor.waitFor({state:'hidden'})
    await waitFor(page,()=>document.activeElement?.matches('[data-note-id] input'))
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    const usage=await mainPage(app)
    await usage.getByRole('button',{name:'Back to panel'}).focus();await usage.keyboard.press('ControlOrMeta+3')
    await page.locator('[data-destination="panel"]').waitFor()
    await waitFor(page,()=>document.activeElement?.matches('[data-note-id] input'))
    await page.getByRole('button',{name:'New note',exact:true}).click();await editor.fill('Discard on Escape')
    await editor.press('Escape');await page.getByRole('button',{name:'Discard',exact:true}).click()
    await editor.waitFor({state:'hidden'})
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).isVisible()),true)
  }finally{const timer=setTimeout(()=>app.process().kill(),3000);try{await app.close()}finally{clearTimeout(timer)}}
})
