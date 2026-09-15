import { compactPage } from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'

test('Quota renderer: all buckets, unknown/zero/over-limit, stale state and response-to-render', async () => {
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/quotas-ui-'))
  const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const page=await compactPage(app); await page.getByRole('button',{name:'Collega Codex',exact:true}).waitFor()
    const state={data:{buckets:[{id:'codex',name:'Codex',windows:[{kind:'primary',usedPercent:0,durationMins:300,resetsAt:Date.now()+120000},{kind:'secondary',usedPercent:123,durationMins:10080,resetsAt:null}]},{id:'other',name:'other',windows:[{kind:'primary',usedPercent:null,durationMins:null,resetsAt:null}]},{id:'empty',name:'empty',windows:[]}]},lastSuccessAt:Date.now(),refreshing:false,stale:false,error:null}
    const start=Date.now()
    await app.evaluate(({BrowserWindow},state)=>{
      const w=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('view=main'))
      w.webContents.send('localino:connection-changed',{status:'connected',account:{email:'synthetic@example.test',plan:'test'},error:null})
      w.webContents.send('localino:quotas-changed',state)
    },state)
    await page.getByText('123% utilizzato · Limite superato per questa finestra',{exact:true}).waitFor()
    assert.ok(Date.now()-start<=2000)
    assert.equal(await page.locator('[data-bucket]').count(),3)
    assert.equal(await page.getByRole('progressbar').count(),2)
    assert.equal(await page.getByRole('progressbar').nth(1).getAttribute('aria-valuenow'),'100')
    assert.equal(await page.getByText('100% rimanente',{exact:true}).count(),1)
    assert.equal(await page.locator('[data-bucket="other"]').getByText('Non disponibile',{exact:true}).count(),1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    state.stale=true; state.error='unavailable'
    await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('view=main')).webContents.send('localino:quotas-changed',s),state)
    await page.getByText('Non aggiornato',{exact:true}).waitFor()
    assert.equal(await page.getByRole('progressbar').count(),2)
    await page.screenshot({path:'test-results/quotas-fixture.png',fullPage:true})
    const cdp=await page.context().newCDPSession(page)
    await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Europe/Rome'})
    await page.clock.setFixedTime(new Date('2027-01-01T22:59:00Z'))
    state.data.buckets[0].windows[0].resetsAt=Date.parse('2027-01-01T23:01:00Z')
    await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('view=main')).webContents.send('localino:quotas-changed',s),state)
    const reset=page.locator('[data-bucket="codex"] time').first()
    await page.waitForFunction(()=>document.querySelector('[data-bucket="codex"] time')?.textContent?.includes('00:01:00'))
    assert.match(await reset.innerText(),/0?2\/0?1\/2027/)
    await page.getByText(/tra 2 min/).waitFor()
  } finally {await app.close()}
})
