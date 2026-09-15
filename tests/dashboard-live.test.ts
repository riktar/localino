import { compactPage } from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir,mkdtemp,readFile,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { _electron as electron } from 'playwright'
import { CodexRpc } from '../src/main/codex/rpc'
import { resolveCodex } from '../src/main/codex/resolve'
import { normalizeUsage,numberLabel,durationSeconds } from '../src/shared/usage'

test('Real dashboard and packaged lifecycle: source comparison, shared views, hidden usage, restart and disconnect', {timeout:90000}, async()=>{
  const packaged=process.env.LOCALINO_TEST_PACKAGED==='1'
  const probe=new CodexRpc(await resolveCodex(null));await probe.start()
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/dashboard-live-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const launch=()=>electron.launch({...(packaged?{executablePath:resolve('dist/win-unpacked/Localino.exe'),args:[`--user-data-dir=${profile}`]}:{args:['.',`--user-data-dir=${profile}`]}),env})
  let app=await launch()
  try {
    const panel=await compactPage(app)
    // Capture the actual native Menu object; exercise its dashboard command without claiming an OS mouse click.
    await app.evaluate(({Menu})=>{
      const context=globalThis as typeof globalThis & {localinoMenu:Electron.Menu}
      const build=Menu.buildFromTemplate
      Menu.buildFromTemplate=function(template){const menu=build.call(this,template);context.localinoMenu=menu;return menu}
    })
    await panel.getByRole('button',{name:'Collega Codex',exact:true}).click()
    await panel.getByRole('progressbar').first().waitFor()
    assert.equal((await panel.evaluate(()=>window.localino.getUsage())).lastSuccessAt,null)
    await app.evaluate(()=>{
      const menu=(globalThis as typeof globalThis & {localinoMenu:Electron.Menu}).localinoMenu
      menu.items.find(item=>item.label==='Apri Consumi')!.click()
    })
    const page=app.windows().find(p=>p!==panel)??await app.waitForEvent('window')
    await page.locator('[data-summary]').waitFor()
    const before=normalizeUsage(await probe.request('account/usage/read'))
    await page.evaluate(()=>window.localino.refreshUsage())
    const state=await page.evaluate(()=>window.localino.getUsage())
    await page.waitForFunction(timestamp=>Number(document.querySelector('[data-usage-updated-at]')?.getAttribute('data-usage-updated-at'))>=timestamp!,state.lastSuccessAt,{polling:100})
    const after=normalizeUsage(await probe.request('account/usage/read'))
    for(const key of Object.keys(state.data!.summary) as (keyof typeof after.summary)[]) {
      const value=state.data!.summary[key],a=before.summary[key],b=after.summary[key]
      assert.ok(value===a||value===b||(value!==null&&a!==null&&b!==null&&value>=Math.min(a,b)&&value<=Math.max(a,b)))
      assert.ok((await page.locator('[data-summary]').innerText()).includes(key==='longestRunningTurnSec'?durationSeconds(value):numberLabel(value)))
    }
    for(const day of state.data!.days){
      const a=before.days.find(d=>d.date===day.date)?.tokens,b=after.days.find(d=>d.date===day.date)?.tokens
      assert.ok(day.tokens===a||day.tokens===b||(a!==undefined&&b!==undefined&&day.tokens>=Math.min(a,b)&&day.tokens<=Math.max(a,b)))
    }
    await page.getByRole('combobox',{name:'Periodo'}).selectOption('all')
    await page.getByText('Tabella dei dati giornalieri',{exact:true}).click()
    for(const day of state.data!.days) assert.ok((await page.locator('[data-usage-table]').innerText()).includes(day.date))
    await panel.evaluate(()=>window.localino.openDashboard());assert.equal(app.windows().length,2)
    const security=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>{
      const p=w.webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration}
    }))
    assert.ok(security.every(p=>p.sandbox&&p.contextIsolation&&!p.nodeIntegration))
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Consumi'))!.setSize(800,600))
    await page.waitForFunction(()=>innerWidth<=800&&document.documentElement.scrollWidth<=innerWidth,null,{polling:100})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:`test-results/dashboard-${packaged?'packaged':'real'}.png`,fullPage:true,mask:[page.getByTestId('account-email')]})
    const beforeNavigation=await page.evaluate(()=>window.localino.getUsage())
    await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click()
    await app.evaluate(()=>{const original=Date.now;Date.now=()=>original()+301000})
    await new Promise(r=>setTimeout(r,1600))
    assert.equal((await page.evaluate(()=>window.localino.getUsage())).lastSuccessAt,beforeNavigation.lastSuccessAt)
    await page.getByRole('navigation').getByRole('button',{name:'Clipboard',exact:true}).click()
    assert.equal((await page.evaluate(()=>window.localino.getUsage())).lastSuccessAt,beforeNavigation.lastSuccessAt)
    await page.getByRole('navigation').getByRole('button',{name:'Consumi',exact:true}).click()
    // Await the refresh already started by navigation before testing hidden polling.
    await page.evaluate(()=>window.localino.refreshUsage())
    assert.ok((await page.evaluate(()=>window.localino.getUsage())).lastSuccessAt!>beforeNavigation.lastSuccessAt!)
    const old=await page.evaluate(()=>window.localino.getUsage())
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Consumi'))!.close())
    await app.evaluate(()=>{const original=Date.now;Date.now=()=>original()+301000})
    await new Promise(r=>setTimeout(r,1600))
    assert.equal((await page.evaluate(()=>window.localino.getUsage())).lastSuccessAt,old.lastSuccessAt)
    await panel.evaluate(()=>window.localino.openDashboard())
    const deadline=Date.now()+17000
    let current=await page.evaluate(()=>window.localino.getUsage())
    while(current.lastSuccessAt===old.lastSuccessAt&&Date.now()<deadline){await new Promise(r=>setTimeout(r,100));current=await page.evaluate(()=>window.localino.getUsage())}
    assert.ok(current.lastSuccessAt!>old.lastSuccessAt!)
    await page.getByRole('button',{name:'Scollega da Localino',exact:true}).click()
    await panel.getByRole('button',{name:'Collega Codex',exact:true}).waitFor()
    assert.equal((await page.evaluate(()=>window.localino.getUsage())).data,null)
    assert.deepEqual(JSON.parse(await readFile(join(profile,'connection.json'),'utf8')),{enabled:false,cliPath:null})
    await writeFile(`test-results/dashboard-${packaged?'packaged':'real'}.json`,JSON.stringify({observedAt:new Date().toISOString(),packaged,daysCompared:state.data!.days.length,summaryFieldsCompared:5,issues:state.data!.issues,minimumSize:[800,600],sharedLifecycle:true,nativeMenuCommand:'actual MenuItem callback; physical tray mechanism confirmed separately'},null,2))
    await app.close();app=await launch()
    const restarted=await compactPage(app);await restarted.getByRole('button',{name:'Collega Codex',exact:true}).waitFor()
    assert.equal((await restarted.evaluate(()=>window.localino.getUsage())).data,null)
  } finally {await app.close();await probe.stop()}
})
