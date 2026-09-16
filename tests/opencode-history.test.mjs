import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {mainPage} from './helpers.mjs'
import {fixture} from './fixtures/opencode.mjs'

test('OpenCode packaged SQLite reader matches native stats oracle without external tools and handles 100k sessions',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/opencode-')),source=join(profile,'statistiche è.db')
  fixture(source).db.close();const before=await readFile(source)
  const env={...process.env,PATH:process.env.SystemRoot+'\\System32'};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const packaged=process.env.LOCALINO_TEST_PACKAGED==='1'
  const app=await electron.launch({...(packaged?{executablePath:resolve('dist/win-unpacked/Localino.exe'),args:[`--user-data-dir=${profile}`]}:{args:['.',`--user-data-dir=${profile}`]}),env})
  try{
    const page=await mainPage(app);await page.evaluate(()=>window.localino.selectAgent('opencode'))
    const wait=async predicate=>{const end=Date.now()+16000;while(Date.now()<end){const state=await page.evaluate(()=>window.localino.getHistory('opencode'));if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,30))}throw Error('OpenCode history timeout')}
    const choose=async path=>{await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path);await page.getByRole('button',{name:'Seleziona database',exact:true}).click();await wait(state=>state.source===path)}
    await choose(source)
    let state=await wait(state=>!!state.data)
    assert.equal(state.data.totals.total,135);assert.equal(state.data.totals.cost,0.42)
    await page.waitForFunction(time=>Number(document.querySelector('[data-history-updated-at]')?.getAttribute('data-history-updated-at'))===time,state.lastSuccessAt)
    assert.ok(Date.now()-state.lastSuccessAt<1000);assert.match(await page.locator('[data-agent="opencode"]').innerText(),/Sessioni aggiornate negli ultimi 7 giorni/)
    assert.equal(await page.getByRole('region',{name:'Serie giornaliera input'}).count(),0)
    await page.getByLabel('Periodo',{exact:true}).selectOption('all');state=await wait(s=>s.data?.period==='all');assert.equal(state.data.totals.total,148)
    assert.deepEqual(await readFile(source),before);assert.ok(!JSON.stringify(state).includes('PRIVATE-SENTINEL'))
    const large=join(profile,'large.db'),{db,add}=fixture(large)
    db.exec('DELETE FROM session; BEGIN');const title='x'.repeat(1024),now=Date.now()
    for(let i=0;i<100000;i++)add(String(i),now,1,0,0,0,0,0.001,title)
    db.exec('COMMIT');db.close();assert.ok((await stat(large)).size>100000000)
    const started=Date.now();await choose(large);await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click()
    await page.getByRole('heading',{name:'Benvenuto in Localino'}).waitFor();assert.ok(Date.now()-started<1000)
    await page.evaluate(()=>window.localino.navigate('consumi'));state=await wait(s=>s.data?.records===100000)
    assert.equal(state.data.totals.total,100000);assert.ok(Math.abs(state.data.totals.cost-100)<0.01);assert.ok(Date.now()-started<15000)
    console.log(JSON.stringify({agent:'opencode',records:100000,bytes:(await stat(large)).size,readMs:Date.now()-started,packaged}))
    await writeFile(large,'corrupt database');await page.evaluate(()=>window.localino.refreshHistory('opencode'));state=await wait(s=>s.error==='invalid');assert.equal(state.stale,true);assert.equal(state.data.records,100000)
    await choose(source);state=await wait(s=>s.data?.records===2);assert.equal(state.error,null)
    await page.getByRole('button',{name:'Scollega da Localino',exact:true}).click();await wait(s=>!s.enabled&&s.data===null)
  }finally{await app.close()}
})
