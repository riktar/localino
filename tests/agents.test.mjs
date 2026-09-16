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
    await page.getByRole('button',{name:'Comandi',exact:true}).click()
    assert.match(await page.locator('#command-usage').innerText(),/Lettore Claude Code in preparazione/)
    assert.equal(await page.locator('#command-quotas').getAttribute('aria-disabled'),'true')
    assert.match(await page.locator('#command-quotas').innerText(),/Quote non esposte da Claude Code/)
    await page.getByRole('dialog').getByRole('button',{name:'Chiudi',exact:true}).click()
    await app.evaluate(({Tray})=>{const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.agentMenu=menu;return original.call(this,menu)}})
    await page.evaluate(()=>window.localino.connectAgent('claude'))
    assert.equal(await app.evaluate(()=>globalThis.agentMenu.items.find(item=>item.label==='Aggiorna statistiche').enabled),false)
    await page.evaluate(()=>window.localino.disconnectAgent('claude'))
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
