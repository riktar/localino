import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { panelPage, mainPage } from './helpers.mjs'
import { spawn } from 'node:child_process'

test('panel navigation, offline sections, trusted routes, tray and actual second instance', async () => {
  await mkdir('test-results/profiles', { recursive: true })
  const profile=await mkdtemp(resolve('test-results/profiles/navigation-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try{
    const page=await panelPage(app)
    assert.equal(app.windows().length,1)
    const visible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length)
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    await page.getByRole('heading',{name:'Settings',exact:true}).waitFor()
    await page.getByRole('button',{name:'Back',exact:true}).click()
    const usage=await mainPage(app)
    await usage.getByRole('heading',{name:'Codex usage',exact:true}).waitFor()
    assert.equal(await visible(),1)
    await usage.getByRole('button',{name:'Back to panel'}).click()
    await app.evaluate(({Tray})=>{const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.navigationMenu=menu;return original.call(this,menu)}})
    await page.evaluate(()=>window.localino.disconnect())
    assert.deepEqual(await app.evaluate(()=>globalThis.navigationMenu.items.filter(i=>i.type!=='separator').map(i=>i.label)),['Open Localino','Quit'])
    await page.evaluate(()=>window.localino.hide())
    await app.evaluate(()=>globalThis.navigationMenu.items[0].click())
    await page.locator('[data-destination="panel"]').waitFor()
    for(const route of ['invalid','home','clipboard','consumi','shortcuts'])await assert.rejects(page.evaluate(route=>window.localino.navigate(route),route))
    await page.evaluate(()=>window.localino.hide())
    const child=spawn(await app.evaluate(()=>process.execPath),['.',`--user-data-dir=${profile}`],{env,windowsHide:true,stdio:'ignore'})
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('second instance: '+code)))})
    await page.getByRole('heading',{name:'Localino',exact:true}).waitFor()
    assert.equal(app.windows().length,2);assert.equal(await visible(),1)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).setSize(360,460))
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:'test-results/navigation-minimum.png'})
  }finally{await app.close()}
})
