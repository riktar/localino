import { compactPage } from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { CodexRpc } from '../src/main/codex/rpc'
import { resolveCodex } from '../src/main/codex/resolve'
import { normalizeQuotas } from '../src/shared/quotas'

test('Real quotas agree with contemporary Codex reading, render promptly and poll while hidden', {timeout:100000}, async()=>{
  const probe=new CodexRpc(await resolveCodex(null)); await probe.start()
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/live-rates-'))
  const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const page=await compactPage(app)
    await page.getByRole('button',{name:'Collega Codex',exact:true}).click()
    await page.getByRole('progressbar').first().waitFor()
    await app.evaluate(({Tray})=>{
      const context=globalThis as typeof globalThis & {localinoTrayUpdates:number[]}
      context.localinoTrayUpdates=[]
      const original=Tray.prototype.setToolTip
      Tray.prototype.setToolTip=function(text:string){original.call(this,text); context.localinoTrayUpdates.push(Date.now())}
    })
    const before=normalizeQuotas(await probe.request('account/rateLimits/read'))
    await page.evaluate(()=>window.localino.refreshQuotas())
    const snapshot=await page.evaluate(()=>window.localino.getQuotas())
    await page.waitForFunction(timestamp=>document.querySelector('[data-updated-at]')?.getAttribute('data-updated-at')===String(timestamp),snapshot.lastSuccessAt)
    const renderedAt=Date.now(); assert.ok(renderedAt-snapshot.lastSuccessAt!<=2000)
    const trayTimes=await app.evaluate(()=> (globalThis as typeof globalThis & {localinoTrayUpdates:number[]}).localinoTrayUpdates)
    const trayAt=trayTimes.find(t=>t>=snapshot.lastSuccessAt!)
    assert.ok(trayAt!==undefined&&trayAt-snapshot.lastSuccessAt!<=2000)
    for(const b of snapshot.data!.buckets) for(const w of b.windows) {
      const view=page.locator('[data-bucket]').filter({has:page.getByRole('heading',{name:b.name,exact:true})}).locator(`[data-window="${w.kind}"]`)
      assert.ok((await view.innerText()).includes(w.usedPercent===null?'Non disponibile':`${w.usedPercent}% utilizzato`))
    }
    const after=normalizeQuotas(await probe.request('account/rateLimits/read'))
    assert.deepEqual(snapshot.data!.buckets.map(b=>b.id),after.buckets.map(b=>b.id))
    const comparisons=snapshot.data!.buckets.flatMap(b=>b.windows.map(w=>{
      const a=before.buckets.find(v=>v.id===b.id)?.windows.find(v=>v.kind===w.kind)
      const z=after.buckets.find(v=>v.id===b.id)?.windows.find(v=>v.kind===w.kind)
      assert.ok(w.usedPercent===a?.usedPercent||w.usedPercent===z?.usedPercent)
      assert.equal(w.durationMins,z?.durationMins)
      // Unused service buckets can return a moving reset. Record the delta, not an invented fixed reset.
      const resetDeltaMs=w.resetsAt!==null&&z?.resetsAt!==null&&z?.resetsAt!==undefined?z.resetsAt-w.resetsAt:null
      return {id:b.id,kind:w.kind,usedPercent:w.usedPercent,durationMins:w.durationMins,resetDeltaMs}
    }))
    await page.getByRole('button',{name:'Riduci nella barra'}).click()
    const deadline=snapshot.lastSuccessAt!+62500
    const observedReadTimes:number[]=[]
    let hidden=await page.evaluate(()=>window.localino.getQuotas())
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,250))
      hidden=await page.evaluate(()=>window.localino.getQuotas())
      if(hidden.lastSuccessAt!==null&&!observedReadTimes.includes(hidden.lastSuccessAt)) observedReadTimes.push(hidden.lastSuccessAt)
    }
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('view=main')).isVisible()),false)
    const gap=hidden.lastSuccessAt!-snapshot.lastSuccessAt!
    assert.ok(gap>=59000&&gap<70000,`hidden polling gap: ${gap} ms`)
    await writeFile('test-results/rates-live.json',JSON.stringify({observedAt:new Date().toISOString(),receivedAt:snapshot.lastSuccessAt,renderedAt,responseToRenderMs:renderedAt-snapshot.lastSuccessAt!,responseToTrayCallMs:trayAt!-snapshot.lastSuccessAt!,trayMeasurement:'actual native setToolTip call; OS paint not timed',hiddenPollGapMs:gap,observedReadTimes,comparisons},null,2))
    await page.evaluate(()=>window.localino.disconnect())
    assert.equal((await page.evaluate(()=>window.localino.getQuotas())).data,null)
  } finally {await app.close(); await probe.stop()}
})
