import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CodexTranscript } from '../src/main/sessions/provider-transcript'
import { TranscriptClient } from '../src/main/sessions/transcript-client'
import { TranscriptPump } from '../src/main/sessions/transcript-pump'
import { TranscriptWindow } from '../src/main/sessions/transcript-window'

test('100,000 provider deltas / 100 MiB survive normalization, batching and disk with bounded projection', {timeout:120000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-provider-volume-')),store=new TranscriptClient(resolve('out/main/transcript-worker.js'),root),window=new TranscriptWindow()
  const errors:string[]=[],pump=new TranscriptPump(store,error=>errors.push(error)),adapter=new CodexTranscript('volume','codex',events=>pump.push(events))
  let maxProjection=0;store.on('events',events=>{window.append(events);maxProjection=Math.max(maxProjection,JSON.stringify(window.lines('Codex')).length)})
  const rss=process.memoryUsage().rss,started=performance.now();let peak=rss,count=0
  try{
    await store.create({sessionId:'volume',provider:'codex',projectPath:root,projectName:'volume'})
    adapter.beginDelivery('delivery')
    for(let batch=0;batch<100;batch++){
      for(let i=0;i<1000;i++){
        const index=batch*1000+i,delta=`${'λ'.repeat(520)}🌍 ${String(index).padStart(6,'0')}\n`
        adapter.ingest({method:'item/agentMessage/delta',params:{threadId:'owned',turnId:'turn',itemId:`a${Math.floor(index/1000)}`,delta}},{providerSessionId:'owned',turnId:'turn'})
      }
      await pump.flush();peak=Math.max(peak,process.memoryUsage().rss)
    }
    adapter.terminate('done','completed');await pump.flush()
    const page=await store.page('volume');assert.equal(page.info.events,100100);assert.equal(page.info.error,null)
  }finally{await store.dispose()}
  let outputBytes=0
  for(const file of (await readdir(join(root,'volume'))).filter(name=>name.endsWith('.jsonl')).sort()){
    for await(const line of createInterface({input:createReadStream(join(root,'volume',file)),crlfDelay:Infinity})){
      const {event}=JSON.parse(line)
      if(event.operation!=='append')continue
      const expected=`${'λ'.repeat(520)}🌍 ${String(count).padStart(6,'0')}\n`
      assert.equal(event.text,expected);assert.equal(event.offset,(count%1000)*expected.length);assert.equal(event.disposition,'applied');count++;outputBytes+=Buffer.byteLength(expected)
    }
  }
  assert.equal(count,100000);assert.ok(outputBytes>=50*1024*1024);assert.deepEqual(errors,[]);assert.ok(maxProjection<2*1024*1024);assert.ok(peak-rss<256*1024*1024)
  console.log(JSON.stringify({normalizedDeltas:count,outputBytes,maxProjection,peakRssGrowth:peak-rss,elapsedMs:performance.now()-started}))
})
