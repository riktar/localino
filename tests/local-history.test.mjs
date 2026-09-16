import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdir,mkdtemp,readFile,writeFile,appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join,resolve } from 'node:path'
import {mainPage,panelPage,packagedExecutable} from './helpers.mjs'

test('Claude real worker, UI, source switching, privacy and large archive responsiveness',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const root=await mkdtemp(resolve('test-results/profiles/history-')),source=join(root,'archivio Unicode è')
  await mkdir(source)
  const rows=JSON.parse(await readFile('tests/fixtures/claude-history.json','utf8'))
  rows.forEach(row=>{row.timestamp=new Date().toISOString();row.message.content=[{type:'text',text:'PRIVATE-CONTENT-SENTINEL'}]})
  const file=join(source,'session.jsonl'),original=rows.map(row=>JSON.stringify(row)).join('\n')+'\n'
  await writeFile(file,original)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const packaged=process.env.LOCALINO_TEST_PACKAGED==='1'
  const app=await electron.launch({...(packaged?{executablePath:packagedExecutable(),args:[`--user-data-dir=${root}`]}:{args:['.',`--user-data-dir=${root}`]}),env})
  try{
    const page=await mainPage(app)
    await app.evaluate(({dialog})=>{globalThis.mainErrors=[];dialog.showErrorBox=(title,content)=>{globalThis.mainErrors.push({title,content})}})
    await page.evaluate(()=>window.localino.selectAgent('claude'))
    const waitHistory=async predicate=>{
      const deadline=Date.now()+16000
      while(Date.now()<deadline){const state=await page.evaluate(()=>window.localino.getHistory('claude'));if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,30))}
      throw Error('History condition timed out')
    }
    const selectSource=async path=>{
      await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path)
      await page.getByRole('button',{name:'Choose source',exact:true}).click()
      await waitHistory(state=>state.source===path)
    }
    await page.getByText('Connection',{exact:true}).click()
    await selectSource(source)
    await waitHistory(state=>!state.refreshing&&state.data!==null)
    let state=await page.evaluate(()=>window.localino.getHistory('claude'))
    assert.equal(state.data.totals.input,107);assert.equal(state.data.totals.output,null);assert.equal(state.data.records,2)
    await page.waitForFunction(time=>Number(document.querySelector('[data-history-updated-at]')?.getAttribute('data-history-updated-at'))===time,state.lastSuccessAt)
    assert.ok(Date.now()-state.lastSuccessAt<1000)
    assert.equal(JSON.stringify(state).includes('PRIVATE-CONTENT-SENTINEL'),false)
    assert.equal(await readFile(file,'utf8'),original)
    await page.getByRole('button',{name:'Open daily table'}).click();assert.match(await page.getByRole('table').innerText(),/107/)
    await page.getByLabel('Period',{exact:true}).selectOption('all')
    await waitHistory(state=>state.data?.period==='all')
    await selectSource(join(root,'missing'))
    await page.getByRole('alert').filter({hasText:'Source missing'}).waitFor()
    state=await page.evaluate(()=>window.localino.getHistory('claude'));assert.equal(state.data,null)
    await selectSource(source)
    await waitHistory(state=>state.data?.totals.input===107)
    const large=join(root,'large');await mkdir(large)
    const largeFile=join(large,'100k.jsonl'),padding='x'.repeat(1024)
    let chunk=''
    for(let i=0;i<100000;i++){
      chunk+=JSON.stringify({type:'assistant',sessionId:'large',timestamp:new Date().toISOString(),message:{id:`response-${i}`,role:'assistant',content:padding,usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}}})+'\n'
      if(i%1000===999){await appendFile(largeFile,chunk);chunk=''}
    }
    const hash=buffer=>createHash('sha256').update(buffer).digest('hex')
    const before=hash(await readFile(largeFile))
    const start=Date.now();await selectSource(large)
    await page.getByRole('button',{name:'Back to panel',exact:true}).click()
    await (await panelPage(app)).getByRole('heading',{name:'Localino',exact:true}).waitFor()
    assert.ok(Date.now()-start<1000,'navigation must remain responsive during parsing')
    await page.evaluate(()=>window.localino.navigate('usage'))
    const readStart=Date.now()
    await waitHistory(state=>state.data?.records===100000)
    state=await page.evaluate(()=>window.localino.getHistory('claude'));assert.equal(state.data.totals.input,100000)
    assert.ok(Date.now()-readStart<15000)
    assert.equal(hash(await readFile(largeFile)),before)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=usage')).setSize(800,600))
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    console.log(JSON.stringify({archiveRecords:100000,bytes:(await readFile(largeFile)).length,readAndRenderMs:Date.now()-readStart,packaged}))
    await page.getByRole('button',{name:'Disconnect',exact:true}).click()
    await waitHistory(state=>state.data===null)
    // A hidden panel may already be destroyed when hide/closed fires during exit.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).destroy())
    await page.evaluate(()=>window.localino.hide())
    assert.deepEqual(await app.evaluate(()=>globalThis.mainErrors),[])
  }finally{await app.close()}
})
