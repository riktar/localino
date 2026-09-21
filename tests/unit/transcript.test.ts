import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { TranscriptStore } from '../../src/main/sessions/transcript-store'
import { TranscriptWindow } from '../../src/main/sessions/transcript-window'
import { cleanTranscriptInput, projectTranscriptPage, reduceTranscriptItem, transcriptKinds, type TranscriptEvent, type TranscriptInput, type TranscriptItemState } from '../../src/shared/transcript'

const event=(id:string,change:Partial<TranscriptInput>={}):TranscriptInput=>({eventId:id,sessionId:'one',provider:'codex',providerSessionId:'owned',turnId:'turn',itemId:'answer',kind:'assistant',operation:'append',text:'λ',offset:0,...change})
function fixture(beforeWrite?:()=>void) {
  const root=mkdtempSync(join(tmpdir(),'localino-transcript-')),store=new TranscriptStore(root,beforeWrite)
  store.create({sessionId:'one',provider:'codex',projectPath:root,projectName:'same'})
  store.create({sessionId:'two',provider:'claude',projectPath:root,projectName:'same'})
  return {root,store}
}
test('normalized transcript whitelists observable types and handles offsets, gaps and terminal events',()=>{
  let state:TranscriptItemState|undefined
  for (const [input,expected] of [[event('a'), 'applied'],[event('a-again'),'duplicate'],[event('future',{offset:3}),'gap'],[event('b',{offset:1,text:'🌍'}),'applied'],[event('done',{operation:'finish',outcome:'completed',text:undefined,offset:undefined}),'applied'],[event('late',{offset:3}),'late']] as const) {
    const result=reduceTranscriptItem(state,input);state=result.state;assert.equal(result.disposition,expected)
  }
  assert.equal(state!.length,3);assert.equal(state!.outcome,'unknown');assert.equal(state!.gap,true)
  for(const kind of transcriptKinds) assert.equal(cleanTranscriptInput(event(kind,{kind})).kind,kind)
  const clean=cleanTranscriptInput({...event('safe'),authorization:'SECRET',raw:{token:'SECRET'},privateReasoning:'SECRET'})
  assert.equal(JSON.stringify(clean).includes('SECRET'),false)
  assert.throws(()=>cleanTranscriptInput(event('bad',{kind:'thinking' as never})))
  assert.throws(()=>cleanTranscriptInput(event('bad',{offset:undefined})))
})
test('chat projection shows only user and model text with distinct roles',()=>{
  const window=new TranscriptWindow(),base={version:1 as const,sessionId:'one',provider:'codex' as const,providerSessionId:'owned',turnId:'turn',operation:'snapshot' as const,outcome:'completed' as const,inputHash:'hash',timestamp:1,disposition:'applied' as const}
  const events:TranscriptEvent[]=[
    {...base,eventId:'prompt',itemId:'prompt',kind:'prompt',text:'Hello',sequence:1},
    {...base,eventId:'status',itemId:'status',kind:'status',text:'Turn started',sequence:2},
    {...base,eventId:'tool',itemId:'tool',kind:'tool',text:'secret command output',sequence:3},
    {...base,eventId:'answer',itemId:'answer',kind:'assistant',text:'Hello from the model',sequence:4},
  ]
  window.append(events)
  assert.deepEqual(window.lines('Codex'),[
    {label:'You',text:'Hello',role:'user'},
    {label:'Codex',text:'Hello from the model',role:'assistant'},
  ])
})
test('chat projection pages every message, preserves Unicode and keeps its cache bounded',()=>{
  const window=new TranscriptWindow(),base={version:1 as const,sessionId:'one',provider:'codex' as const,providerSessionId:'owned',turnId:'turn',operation:'snapshot' as const,outcome:'completed' as const,inputHash:'hash',timestamp:1,disposition:'applied' as const}
  const long=`START-${'x'.repeat(9000)}-END`
  window.append(Array.from({length:14},(_,index)=>({...base,eventId:`event-${index+10}`,itemId:`message-${index+10}`,kind:index===0?'prompt' as const:'assistant' as const,text:index===0?long:`Message ${index+10}`,sequence:index+10})))
  assert.equal(window.lines('Codex').length,12);assert.equal(window.hasEarlier(),true);assert.equal(window.before(),10);assert.equal(window.revealLoadedEarlier(),true);assert.equal(window.lines('Codex')[0].text,long);assert.equal(window.hasLater(),true)
  window.prepend(Array.from({length:9},(_,index)=>({...base,eventId:`event-${index+1}`,itemId:`message-${index+1}`,kind:'assistant' as const,text:`Message ${index+1}`,sequence:index+1})))
  assert.equal(window.revealLoadedEarlier(),true);assert.equal(window.lines('Codex').length,11);assert.equal(window.lines('Codex')[0].text,'Message 1');assert.equal(window.lines('Codex').at(-1)?.text,'Message 11');assert.equal(window.hasEarlier(),false)
  const assistant=new TranscriptWindow(),text=`BEGIN-${'x'.repeat(3992)}🌍-${'y'.repeat(1000)}-END`
  assistant.append([{...base,eventId:'long',itemId:'long',kind:'assistant',text,sequence:1}])
  assert.match(assistant.lines('Codex')[0].text,/^…\n/);assert.equal(assistant.hasEarlier(),true);assert.equal(assistant.revealLoadedEarlier(),true)
  const earlier=assistant.lines('Codex')[0].text;assert.match(earlier,/^BEGIN-/);assert.match(earlier,/\n…$/);assert.equal([...earlier].some(character=>character.length===1&&/[\uD800-\uDFFF]/.test(character)),false);assert.equal(assistant.hasLater(),true)
  const bounded=new TranscriptWindow();bounded.append(Array.from({length:150},(_,index)=>({...base,eventId:`new-${index}`,itemId:`new-${index}`,kind:'assistant' as const,text:'x',sequence:index+200})))
  bounded.prepend(Array.from({length:100},(_,index)=>({...base,eventId:`old-${index}`,itemId:`old-${index}`,kind:'assistant' as const,text:'y',sequence:index+1})))
  const retained=bounded.cacheStats();bounded.append(Array.from({length:1000},(_,index)=>({...base,eventId:`late-${index}`,itemId:`late-${index}`,kind:'assistant' as const,text:'z',sequence:index+1000})))
  assert.deepEqual(bounded.cacheStats(),retained);assert.ok(retained.events<=100&&retained.bytes<=2*1024*1024)
  bounded.replaceLatest([{...base,eventId:'latest',itemId:'latest',kind:'assistant',text:'latest',sequence:9999}]);assert.deepEqual(bounded.lines('Codex').map(line=>line.text),['latest']);assert.equal(bounded.hasLater(),false)
  const streamed=new TranscriptWindow(),prompt={...base,eventId:'prompt-protected',itemId:'prompt-protected',kind:'prompt' as const,text:'question',sequence:1}
  streamed.append([prompt,...Array.from({length:200},(_,index)=>({...base,eventId:`delta-${index}`,itemId:'streamed-answer',kind:'assistant' as const,operation:'append' as const,text:'x',offset:index,sequence:index+2}))])
  assert.equal(streamed.cacheStats().events,100);assert.equal(streamed.before(),103);assert.equal(streamed.hasEarlier(),true)
})
test('append/restart preserves exact Unicode, idempotence, final snapshot and session isolation',()=>{
  const {root,store}=fixture()
  const inputs=[event('a'),event('b',{offset:1,text:'🌍'}),event('final',{operation:'snapshot',text:'λ🌍',offset:undefined,outcome:'completed'})]
  assert.equal(store.append(inputs).length,3)
  assert.equal(store.append(inputs).length,0)
  store.append([event('other',{sessionId:'two',provider:'claude',providerSessionId:'claude-id',text:'other'})])
  const restarted=new TranscriptStore(root)
  assert.deepEqual(restarted.page('one').events.map(item=>item.text),['λ','🌍','λ🌍'])
  assert.equal(restarted.page('one').info.interrupted,false)
  assert.equal(projectTranscriptPage(restarted.page('one'))[0].text,'λ🌍')
  assert.equal(restarted.page('two').info.interrupted,true)
  assert.equal(restarted.append([event('a')]).length,0)
  assert.throws(()=>restarted.append([event('a',{text:'conflict'})]),/Conflicting/)
  assert.equal(restarted.page('two').events[0].text,'other')
  assert.throws(()=>restarted.delete('one',false),/confirmation/)
  assert.throws(()=>restarted.delete('../one',true),/not found/)
  restarted.delete('one',true)
  assert.deepEqual(restarted.list().map(item=>item.sessionId),['two'])
  assert.equal(restarted.page('two').events[0].text,'other')
})
test('truncated tail and corrupt complete record remain byte-for-byte intact, index is rebuilt',()=>{
  const {root,store}=fixture()
  store.append([event('a'),event('b',{offset:1})])
  const file=join(root,'one','events-00000001.jsonl')
  appendFileSync(file,'{"event":')
  writeFileSync(join(root,'one','manifest.json'),'{broken')
  writeFileSync(join(root,'one','snapshot.json'),'{broken-snapshot')
  const original=readFileSync(file)
  const recovered=new TranscriptStore(root)
  const page=recovered.page('one')
  assert.equal(page.events.length,2);assert.equal(page.info.interrupted,true);assert.match(page.info.error!,/tail/)
  recovered.append([event('new',{turnId:'new-turn',text:'new'})])
  assert.deepEqual(readFileSync(file),original)
  const preserved=readdirSync(join(root,'one'))
  assert.equal(readFileSync(join(root,'one',preserved.find(name=>name.startsWith('manifest.json.corrupt-'))!),'utf8'),'{broken')
  assert.equal(readFileSync(join(root,'one',preserved.find(name=>name.startsWith('snapshot.json.corrupt-'))!),'utf8'),'{broken-snapshot')
  assert.equal(readdirSync(join(root,'one')).filter(name=>name.endsWith('.jsonl')).length,2)
  const second=join(root,'one','events-00000002.jsonl')
  writeFileSync(second,readFileSync(second,'utf8').replace('"text":"new"','"text":"tampered"'))
  const corrupted=readFileSync(second)
  const again=new TranscriptStore(root).page('one')
  assert.match(again.info.error!,/corrupt/);assert.equal(again.events.some(item=>item.text==='tampered'),false)
  assert.deepEqual(readFileSync(second),corrupted)
})
test('disk-full and oversized events are explicit, never truncate accepted output',()=>{
  let fail=false
  const {root,store}=fixture(()=>{if(fail)throw Object.assign(Error('disk full'),{code:'ENOSPC'})})
  store.append([event('a')]);fail=true
  assert.throws(()=>store.append([event('b',{offset:1})]),/not writable/)
  assert.match(store.list().find(item=>item.sessionId==='one')!.error!,/not saved/)
  assert.equal(new TranscriptStore(root).page('one').events.length,1)
  const other=fixture().store
  assert.throws(()=>other.append([event('huge',{text:'x'.repeat(1024*1024)})]),/1 MiB/)
  assert.equal(other.page('one').events.length,0)
})

test('all observable kinds persist; conflicting offset is a gap and final cannot hide it after restart',()=>{
  const {root,store}=fixture()
  store.append(transcriptKinds.map(kind=>event(`kind-${kind}`,{kind,itemId:`kind-${kind}`,operation:'notice',offset:undefined,text:kind==='unknown'?undefined:kind,label:kind==='unknown'?'unsupported provider event':kind,outcome:'completed'})))
  store.append([event('first'),event('conflict',{text:'changed'}),event('finish',{operation:'finish',offset:undefined,text:undefined,outcome:'completed'})])
  const page=store.page('one')
  assert.deepEqual(page.events.slice(0,transcriptKinds.length).map(item=>item.kind),[...transcriptKinds])
  assert.equal(page.events.at(-2)!.disposition,'gap');assert.equal(page.events.at(-1)!.outcome,'unknown')
  const reopened=new TranscriptStore(root)
  assert.equal(reopened.append([event('finish',{operation:'finish',offset:undefined,text:undefined,outcome:'completed'})]).length,0)
  assert.equal(reopened.page('one').events.at(-1)!.outcome,'unknown')
  assert.equal(reopened.page('one').info.reasoning,'published-summary')
  assert.equal(projectTranscriptPage(reopened.page('one')).at(-1)!.text,'λ')
})

test('every terminal outcome resists late notices, replacement text and kind changes before and after restart',()=>{
  for(const outcome of ['completed','interrupted','failed','unknown'] as const) {
    const {root,store}=fixture()
    store.append([event('done',{operation:'snapshot',text:'Confirmed final',outcome})])
    const late=store.append([
      event('notice',{operation:'notice',text:'Late replacement',outcome:'streaming'}),
      event('different-kind',{kind:'status',operation:'notice',text:'Other kind',outcome:'streaming'}),
      event('snapshot-late',{operation:'snapshot',text:'Replacement snapshot',outcome:'completed'}),
    ])
    assert.ok(late.every(item=>item.disposition==='late'))
    for(const source of [store,new TranscriptStore(root)]) {
      const page=source.page('one'),projection=projectTranscriptPage(page)
      assert.equal(projection.length,1);assert.equal(projection[0].text,'Confirmed final');assert.equal(projection[0].outcome,outcome)
      assert.equal(page.info.interrupted,false)
    }
  }
})

test('pages and identity lookups exclude checksum-valid records rejected by recovery ownership and order',()=>{
  const {root,store}=fixture()
  const originalEvents=[event('a',{text:'A'}),event('b',{offset:1,text:'B'})]
  store.append(originalEvents)
  const file=join(root,'one','events-00000001.jsonl'),records=readFileSync(file,'utf8').trimEnd().split('\n')
  const foreign=JSON.parse(records[1]);foreign.event.provider='claude';foreign.event.text='FOREIGN'
  foreign.checksum=createHash('sha256').update(JSON.stringify(foreign.event)).digest('hex')
  writeFileSync(file,[records[0],JSON.stringify(foreign),records[1],records[0]].join('\n')+'\n')
  const corrupted=readFileSync(file),reopened=new TranscriptStore(root),page=reopened.page('one')
  assert.equal(page.info.events,2);assert.match(page.info.error!,/corrupt/)
  assert.deepEqual(page.events.map(item=>item.sequence),[1,2]);assert.equal(projectTranscriptPage(page)[0].text,'AB')
  assert.deepEqual(reopened.page('one',2).events.map(item=>item.sequence),[1])
  assert.equal(reopened.page('one',1).events.length,0)
  assert.equal(reopened.append(originalEvents).length,0) // The rejected same-ID foreign row must not poison lookup.
  assert.deepEqual(readFileSync(file),corrupted)
})
