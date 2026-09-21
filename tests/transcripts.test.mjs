import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright'
import { mainPage } from './helpers.mjs'

function workerStore(root) {
  const worker = new Worker(resolve('out/main/transcript-worker.js'),{workerData:{root},stdout:true,stderr:true})
  let id=0,output='';const pending=new Map()
  worker.stdout.on('data',chunk=>output+=chunk);worker.stderr.on('data',chunk=>output+=chunk)
  worker.on('message',reply=>{const request=pending.get(reply.id);pending.delete(reply.id);if(reply.error)request.reject(Error(reply.error));else request.resolve(reply.value)})
  worker.on('error',error=>{for(const request of pending.values())request.reject(error)})
  return {worker,get output(){return output},call:(method,...args)=>new Promise((resolveCall,reject)=>{const sequence=++id;pending.set(sequence,{resolve:resolveCall,reject});worker.postMessage({id:sequence,method,args})})}
}
const event=(index,sessionId='large')=>({eventId:`event-${index}`,sessionId,provider:'codex',providerSessionId:'provider',turnId:'turn',itemId:`answer-${Math.floor(index/1000)}`,kind:'assistant',operation:'append',offset:(index%1000)*532,text:`${'λ'.repeat(520)}🌍 output\n`,label:'Observed text'})

test('concurrent worker requests retain order and partial output survives an abrupt worker termination',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const root=await mkdtemp(resolve('test-results/profiles/transcript-crash-')),store=workerStore(root)
  for(const sessionId of ['one','two'])await store.call('create',{sessionId,provider:'codex',projectPath:root,projectName:'same project'})
  const requests=[]
  for(let batch=0;batch<10;batch++)for(const sessionId of ['one','two']) {
    const events=Array.from({length:10},(_,offset)=>{const index=batch*10+offset,item=event(index,sessionId);item.offset=index*item.text.length;return item})
    requests.push(store.call('append',events))
  }
  await Promise.all(requests)
  await store.worker.terminate() // No close/flush RPC: kill while both items remain streaming.
  const recovered=workerStore(root)
  try {
    for(const sessionId of ['one','two']) {
      const page=await recovered.call('page',sessionId)
      assert.equal(page.info.interrupted,true);assert.equal(page.events.length,100)
      assert.deepEqual(page.events.map(item=>item.sequence),Array.from({length:100},(_,index)=>index+1))
      assert.ok(page.events.every(item=>item.sessionId===sessionId&&item.disposition==='applied'))
      assert.ok(Object.values(page.states).every(item=>item.outcome==='interrupted'))
    }
  } finally {await recovered.call('close');await recovered.worker.terminate()}
  assert.equal(store.output+recovered.output,'')
})

test('100,000 events / 50 MiB remain durable and paged while the renderer responds; deletion is confirmed and selective', {timeout:180000}, async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/transcripts-')),root=join(profile,'transcripts'),seed=workerStore(root)
  const started=performance.now(),rss=process.memoryUsage().rss
  let expectedBytes=0,peakRss=rss
  try {
    for(const sessionId of ['large','same-name'])await seed.call('create',{sessionId,provider:'codex',projectPath:profile,projectName:'same project'})
    for(let start=0;start<100000;start+=1000) {
      const batch=Array.from({length:1000},(_,offset)=>event(start+offset))
      if(start===0)assert.equal(batch[0].text.length,530)
      for(const item of batch){item.offset=(Number(item.eventId.slice(6))%1000)*item.text.length;expectedBytes+=Buffer.byteLength(item.text)}
      const accepted=await seed.call('append',batch)
      assert.equal(accepted.length,1000);assert.equal(accepted.at(-1).sequence,start+1000)
      peakRss=Math.max(peakRss,process.memoryUsage().rss)
    }
    await seed.call('append',[event(0,'same-name')])
    await seed.call('close')
  } finally {await seed.worker.terminate()}
  assert.ok(expectedBytes>=50*1024*1024)
  assert.equal(seed.output,'')
  const files=await readdir(join(root,'large'));assert.ok(files.filter(name=>name.endsWith('.jsonl')).length>10)
  const manifest=JSON.parse(await readFile(join(root,'large','manifest.json'),'utf8'))
  assert.equal(manifest.info.events,100000);assert.ok(manifest.info.bytes>expectedBytes)
  let checked=0
  for(const file of files.filter(name=>name.endsWith('.jsonl')).sort()) {
    for await(const line of createInterface({input:createReadStream(join(root,'large',file)),crlfDelay:Infinity})) {
      const record=JSON.parse(line),expected=event(checked)
      assert.equal(record.checksum,createHash('sha256').update(JSON.stringify(record.event)).digest('hex'))
      assert.equal(record.event.sequence,checked+1);assert.equal(record.event.text,expected.text)
      assert.equal(record.event.offset,(checked%1000)*expected.text.length);assert.equal(record.event.disposition,'applied');checked++
    }
  }
  assert.equal(checked,100000);assert.ok(peakRss-rss<256*1024*1024)
  console.log(JSON.stringify({datasetEvents:100000,outputBytes:expectedBytes,storedBytes:manifest.info.bytes,seedAndOracleMs:performance.now()-started,peakProcessRssGrowth:peakRss-rss}))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try {
    const page=await mainPage(app),card=page.locator('[data-transcript-id="large"]')
    await card.waitFor();await app.evaluate(({clipboard})=>clipboard.writeText('explicit-clipboard-sentinel'))
    const measurement=await page.evaluate(async()=>{
      const gaps=[];let last=performance.now(),active=true
      const tick=()=>{const now=performance.now();gaps.push(now-last);last=now;if(active)requestAnimationFrame(tick)}
      requestAnimationFrame(tick)
      const started=performance.now(),result=await window.localino.getTranscriptPage('large')
      active=false;gaps.sort((a,b)=>a-b)
      return {elapsedMs:performance.now()-started,p95FrameMs:gaps[Math.floor(gaps.length*.95)]??0,count:result.events.length,first:result.events[0].sequence,last:result.events.at(-1).sequence,interrupted:result.info.interrupted,bytes:JSON.stringify(result).length}
    })
    assert.equal(measurement.count,100);assert.equal(measurement.first,99901);assert.equal(measurement.last,100000);assert.equal(measurement.interrupted,true)
    assert.ok(measurement.p95FrameMs<100,JSON.stringify(measurement));assert.ok(measurement.bytes<2*1024*1024)
    await card.getByRole('button',{name:'Read transcript',exact:true}).click()
    const content=page.locator('[aria-label="Transcript page"]')
    await content.getByText(/#100000 assistant/).waitFor()
    assert.equal(await content.getByRole('listitem').count(),100)
    await content.getByRole('button',{name:'Earlier events'}).click()
    await content.getByText(/#99900 assistant/).waitFor()
    assert.equal(await content.getByRole('listitem').count(),100)
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'explicit-clipboard-sentinel')
    assert.equal(await page.evaluate(()=>window.localino.getTranscriptPage('../escape').then(()=>false,()=>true)),true)
    await page.reload();await card.waitFor()
    assert.equal((await page.evaluate(()=>window.localino.getLiveSessions())).sessions.length,0)
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
    await card.getByRole('button',{name:'Delete transcript',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Deletion cancelled.'}).waitFor()
    assert.equal((await page.evaluate(()=>window.localino.getTranscripts())).sessions.length,2)
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})})
    await card.getByRole('button',{name:'Delete transcript',exact:true}).click()
    await card.waitFor({state:'detached'})
    assert.deepEqual((await page.evaluate(()=>window.localino.getTranscripts())).sessions.map(item=>item.sessionId),['same-name'])
    assert.equal((await page.evaluate(()=>window.localino.getTranscriptPage('same-name'))).events.length,1)
    console.log(JSON.stringify({renderer:measurement,heap:await app.evaluate(()=>process.memoryUsage().heapUsed)}))
  } finally {await app.close()}
})
