import {waitFor} from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {resolve} from 'node:path'

test('compact clipboard multiselect, exact copy, guards, context keyboard and settings state',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/panel-notes-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.','--user-data-dir='+profile],env})
  try{
    const page=await app.firstWindow();page.setDefaultTimeout(7000)
    await page.locator('[data-clipboard]').waitFor()
    const texts=[' older\r\n漢字 ','newer 🌱\n']
    for(const text of texts)await page.evaluate(text=>window.localino.mutateNote({kind:'create',text}),text)
    const rows=page.locator('[data-note-id]');await rows.nth(1).waitFor()
    await rows.nth(1).getByRole('checkbox').check();await rows.nth(0).getByRole('checkbox').check()
    await rows.nth(0).click({button:'right'})
    await page.getByRole('menuitem',{name:'Copy all (2)',exact:true}).click()
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),texts[1]+'\n'+texts[0])
    const before=await app.evaluate(({clipboard})=>clipboard.readText())
    assert.equal((await page.evaluate(()=>window.localino.copyNotes(['missing']))).ok,false)
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),before)
    await rows.nth(0).getByRole('checkbox').focus();await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem',{name:'Close',exact:true}).click()
    await page.getByRole('button',{name:'Search and filter'}).click()
    await page.getByRole('searchbox',{name:'Search notes'}).fill('older')
    assert.equal(await page.getByRole('checkbox',{checked:true}).count(),0)
    await page.getByRole('searchbox',{name:'Search notes'}).fill('')
    await page.getByRole('button',{name:'New note',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Note text'});await editor.fill('draft kept 🌱')
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    await page.getByRole('button',{name:'Stay',exact:true}).click()
    assert.equal(await editor.inputValue(),'draft kept 🌱')
    assert.equal(await editor.evaluate(el=>document.activeElement===el),true)
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await waitFor(page,async()=>(await window.localino.getNotes()).notes.length===3)
    for(let i=0;i<15;i++)await page.evaluate(i=>window.localino.mutateNote({kind:'create',text:'Scroll item '+i}),i)
    await page.locator('.note-list').evaluate(el=>{el.scrollTop=200})
    const scroll=await page.locator('.note-list').evaluate(el=>el.scrollTop)
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).click()
    assert.equal(await page.locator('.note-list').evaluate(el=>el.scrollTop),scroll)
    for(const [width,height] of [[420,640],[360,460]]){
      await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await page.screenshot({path:`test-results/panel-${width}x${height}.png`})
    }
  }finally{const timer=setTimeout(()=>app.process().kill(),3000);try{await app.close()}finally{clearTimeout(timer)}}
})
