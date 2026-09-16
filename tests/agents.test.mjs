import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir,mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mainPage } from './helpers.mjs'

test('agent selection synchronizes windows, persists, guards drafts and validates IPC',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/agents-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const launch=()=>electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  let app=await launch()
  try{
    const page=await mainPage(app)
    await page.evaluate(()=>window.localino.selectAgent('pi'))
    await page.locator('[data-agent="pi"]').waitFor()
    const panel=app.windows().find(p=>!p.url().includes('view=main'))
    await page.evaluate(()=>window.localino.openPanel())
    await panel.locator('[data-agent="pi"]').waitFor()
    await panel.getByLabel('Agente',{exact:true}).selectOption('claude')
    await page.locator('[data-agent="claude"]').waitFor()
    assert.ok(Object.values((await page.evaluate(()=>window.localino.getAgents())).sources).every(source=>!source.enabled))
    for(const method of ['selectAgent','getHistory','refreshHistory','connectAgent','disconnectAgent'])await assert.rejects(page.evaluate(method=>window.localino[method]('../secret'),method))
    await assert.rejects(page.evaluate(()=>window.localino.setAgentPeriod('pi','invalid')))
    await page.evaluate(()=>window.localino.navigate('clipboard'))
    await page.getByRole('button',{name:'Nuovo prompt',exact:true}).click()
    await page.getByRole('textbox',{name:'Testo del prompt'}).fill('Bozza da conservare')
    await page.evaluate(()=>window.localino.selectAgent('opencode'))
    await page.getByRole('dialog').waitFor()
    assert.equal((await page.evaluate(()=>window.localino.getAgents())).selected,'claude')
    await page.getByRole('button',{name:'Resta',exact:true}).click()
    assert.equal(await page.getByRole('textbox',{name:'Testo del prompt'}).inputValue(),'Bozza da conservare')
    await page.getByRole('button',{name:'Salva prompt',exact:true}).click()
    await page.evaluate(()=>window.localino.selectAgent('opencode'))
    await page.locator('[data-agent="opencode"]').waitFor()
    await app.close();app=await launch()
    const restored=await mainPage(app)
    assert.equal((await restored.evaluate(()=>window.localino.getAgents())).selected,'opencode')
    await restored.evaluate(()=>window.localino.navigate('consumi'))
    await restored.locator('[data-agent="opencode"]').waitFor()
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).setSize(800,600))
    assert.equal(await restored.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
})
