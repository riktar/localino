import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test('single panel root, always-on-top, guarded closure and subordinate usage',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/panel-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.', '--user-data-dir='+profile],env})
  try{
    const page=await app.firstWindow()
    await page.locator('[data-destination="panel"]').waitFor()
    assert.equal(app.windows().length,1)
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),true)
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    await page.locator('[data-destination="settings"]').waitFor()
    await page.getByRole('button',{name:'Back',exact:true}).click()
    const opened=app.waitForEvent('window')
    await page.getByRole('button',{name:'Advanced usage',exact:true}).click()
    const detail=await opened
    await detail.getByRole('button',{name:'Back to panel'}).waitFor()
    assert.equal(app.windows().length,2)
    await detail.getByRole('button',{name:'Back to panel'}).click()
    await page.getByRole('button',{name:'Hide panel'}).click()
    await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main'));if(w.isVisible())await new Promise(r=>w.once('hide',r))})
    await app.evaluate(({app})=>app.emit('activate'))
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).isVisible()),true)
    await assert.rejects(page.evaluate(()=>window.localino.navigate('home')))
  }finally{await app.close()}
})
