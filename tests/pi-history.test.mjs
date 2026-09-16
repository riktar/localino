import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir,mkdtemp,readFile,cp,appendFile,writeFile } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { mainPage } from './helpers.mjs'

test('Pi reader and packaged UI match official SessionManager fixture, survive source change and a large archive',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/pi-')),source=join(profile,'sessioni è')
  await cp('tests/fixtures/pi-native',source,{recursive:true})
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const packaged=process.env.LOCALINO_TEST_PACKAGED==='1'
  const app=await electron.launch({...(packaged?{executablePath:resolve('dist/win-unpacked/Localino.exe'),args:[`--user-data-dir=${profile}`]}:{args:['.',`--user-data-dir=${profile}`]}),env})
  try{
    const page=await mainPage(app)
    await page.evaluate(()=>window.localino.selectAgent('pi'))
    await page.evaluate(()=>window.localino.setAgentPeriod('pi','all'))
    const wait=async predicate=>{const end=Date.now()+16000;while(Date.now()<end){const state=await page.evaluate(()=>window.localino.getHistory('pi'));if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,30))}throw Error('Pi history timeout')}
    const choose=async path=>{await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path);await page.getByRole('button',{name:'Seleziona cartella',exact:true}).click();await wait(state=>state.source===path)}
    await choose(source)
    let state=await wait(state=>!!state.data)
    assert.equal(state.data.totals.input,20);assert.equal(state.data.totals.output,8);assert.equal(state.data.totals.total,34)
    assert.ok(Math.abs(state.data.totals.cost-0.34)<1e-12)
    await page.waitForFunction(time=>Number(document.querySelector('[data-history-updated-at]')?.getAttribute('data-history-updated-at'))===time,state.lastSuccessAt)
    assert.ok(Date.now()-state.lastSuccessAt<1000)
    assert.match(await page.locator('[data-agent="pi"]').innerText(),/0,34 USD/)
    await page.getByRole('button',{name:'Apri tabella giornaliera'}).click();assert.match(await page.getByRole('table').innerText(),/34/)
    const large=join(profile,'large');await mkdir(large)
    const file=join(large,'large.jsonl'),timestamp=new Date().toISOString()
    await writeFile(file,JSON.stringify({type:'session',version:3,id:'large',timestamp,cwd:'synthetic'})+'\n')
    let chunk='';const content='x'.repeat(1024)
    for(let i=0;i<100000;i++){
      chunk+=JSON.stringify({type:'message',id:String(i),parentId:null,timestamp,message:{role:'assistant',content,usage:{input:1,output:0,cacheRead:0,cacheWrite:0,totalTokens:1,cost:{total:0.001}}}})+'\n'
      if(i%1000===999){await appendFile(file,chunk);chunk=''}
    }
    const started=Date.now();await choose(large)
    await page.getByRole('navigation').getByRole('button',{name:'Home',exact:true}).click()
    await page.getByRole('heading',{name:'Benvenuto in Localino'}).waitFor();assert.ok(Date.now()-started<1000)
    await page.evaluate(()=>window.localino.navigate('consumi'))
    const readStart=Date.now();state=await wait(state=>state.data?.records===100000)
    assert.equal(state.data.totals.total,100000);assert.ok(Math.abs(state.data.totals.cost-100)<0.01)
    assert.ok(Date.now()-readStart<15000)
    console.log(JSON.stringify({agent:'pi',records:100000,bytes:(await readFile(file)).length,readMs:Date.now()-readStart,packaged}))
    await page.getByRole('button',{name:'Scollega da Localino',exact:true}).click();await wait(state=>!state.enabled&&state.data===null)
  }finally{await app.close()}
})
