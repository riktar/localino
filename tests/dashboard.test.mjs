import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir,mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'

test('Dashboard: one secure window, sparse data, filters, keyboard, credits and independent errors at minimum size',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/dashboard-'))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const panel=await app.firstWindow();await panel.getByRole('button',{name:'Apri dashboard',exact:true}).click()
    const page=app.windows().find(w=>w!==panel)??await app.waitForEvent('window')
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.getByRole('heading',{name:'Statistiche Codex',exact:true}).waitFor()
    await page.clock.setFixedTime(new Date('2026-01-07T12:00:00Z'))
    await panel.evaluate(()=>window.localino.openDashboard())
    assert.equal(app.windows().length,2)
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Statistiche')) ;w.setSize(800,600)})
    const usage={data:{summary:{lifetimeTokens:1000,peakDailyTokens:500,longestRunningTurnSec:90061,currentStreakDays:0,longestStreakDays:null},days:[{date:'2026-01-01',tokens:10},{date:'2026-01-03',tokens:0},{date:'2026-01-07',tokens:20}],issues:0,range:{start:'2026-01-01',end:'2026-01-07'}},lastSuccessAt:Date.now(),refreshing:false,stale:false,error:null}
    const quotas={data:{buckets:[{id:'codex',name:'Codex',windows:[{kind:'primary',usedPercent:12,durationMins:10080,resetsAt:null}],credits:{hasCredits:true,unlimited:true,balance:'12.34'}}],availableResets:0},lastSuccessAt:Date.now(),refreshing:false,stale:false,error:null}
    await app.evaluate(({BrowserWindow},{usage,quotas})=>{for(const w of BrowserWindow.getAllWindows()){
      w.webContents.send('localino:connection-changed',{status:'connected',account:{email:'synthetic@example.test',plan:'test'},error:null})
      w.webContents.send('localino:usage-changed',usage);w.webContents.send('localino:quotas-changed',quotas)
    }},{usage,quotas})
    await page.getByText('Crediti illimitati',{exact:true}).waitFor()
    assert.equal(await page.getByRole('combobox',{name:'Periodo'}).inputValue(),'30')
    await page.getByRole('combobox',{name:'Periodo'}).selectOption('7')
    await page.waitForFunction(()=>document.querySelector('[data-coverage]')?.textContent?.includes('3/7'))
    assert.match(await page.locator('[data-period-metrics]').innerText(),/Totale parziale\s+30/)
    assert.match(await page.locator('[data-period-metrics]').innerText(),/Media per giorno disponibile\s+10/)
    assert.match(await page.locator('[data-summary]').innerText(),/1\.?000/)
    await page.locator('.recharts-line-dot').first().hover()
    const tooltip=page.locator('.recharts-tooltip-wrapper')
    await tooltip.getByText('2026-01-01',{exact:true}).waitFor({state:'visible'})
    assert.match(await tooltip.innerText(),/10 token/)
    await page.locator('.recharts-surface').first().focus()
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight')
    await tooltip.getByText('2026-01-03',{exact:true}).waitFor({state:'visible'})
    assert.match(await tooltip.innerText(),/0 token/)
    assert.deepEqual(errors,[])
    await page.getByText('Tabella dei dati giornalieri',{exact:true}).focus();await page.keyboard.press('Enter')
    await page.locator('[data-usage-table]').waitFor({state:'visible'})
    assert.match(await page.locator('[data-usage-table]').innerText(),/2026-01-03\s+0/)
    await page.getByRole('combobox',{name:'Periodo'}).focus();await page.keyboard.press('End');await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('combobox',{name:'Periodo'}).inputValue(),'all')
    assert.match(await page.locator('[data-summary]').innerText(),/1\.?000/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    assert.equal(await page.evaluate(()=>typeof window.require),'undefined')
    await page.screenshot({path:'test-results/dashboard-fixture.png',fullPage:true})
    usage.error='unsupported';usage.stale=true
    await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('localino:usage-changed',s)),usage)
    await page.getByRole('alert').filter({hasText:'non sono supportate'}).waitFor()
    assert.equal(await page.getByRole('progressbar').count(),1)
    await page.evaluate(()=>window.localino.hide())
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Statistiche')).isVisible()),false)
    await panel.evaluate(()=>window.localino.openDashboard());assert.equal(app.windows().length,2)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('localino:connection-changed',{status:'disconnected',account:null,error:null})))
    await page.getByText("Collega Codex per leggere le statistiche dell'account.",{exact:true}).waitFor()
    assert.equal(await page.locator('[data-summary]').count(),0)
    assert.deepEqual(errors,[])
  } finally {await app.close()}
})
