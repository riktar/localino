import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { readPi } from '../../src/main/agents/pi'

const time='2026-09-16T10:00:00Z', now=Date.parse('2026-09-16T12:00:00Z')
const usage=(input:number,output:number,cacheRead=0,cacheWrite=0)=>({input,output,cacheRead,cacheWrite,totalTokens:input+output+cacheRead+cacheWrite,cost:{total:(input+output+cacheRead+cacheWrite)/100}})
const header=(id:string,parentSession?:string)=>({type:'session',version:3,id,timestamp:time,cwd:'not-projected',...(parentSession?{parentSession}:{})})
const message=(id:string,parentId:string|null,input=10,output=4,cacheRead=2,cacheWrite=1)=>({type:'message',id,parentId,timestamp:time,message:{role:'assistant',content:'PRIVATE-SENTINEL',usage:usage(input,output,cacheRead,cacheWrite)}})
const write=(file:string,rows:unknown[])=>writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n')

test('fixture emitted by official Pi0.85.1 SessionManager matches its independent original/fork oracle',async()=>{
  const data=await readPi(resolve('tests/fixtures/pi-native'),'all',Date.now())
  assert.equal(data.records,2);assert.equal(data.totals.input,20);assert.equal(data.totals.total,34);assert.ok(Math.abs(data.totals.cost!-0.34)<1e-12);assert.equal(data.issues,0)
})

test('Pi v3 forks, all branches, tool usage, summary usage and unrelated short IDs match independent totals',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-pi-')),source=join(root,'original.jsonl')
  const original=message('11111111',null)
  await write(source,[header('A'),original,message('22222222','11111111')])
  await write(join(root,'fork.jsonl'),[header('F',source),original,
    {type:'message',id:'33333333',parentId:'11111111',timestamp:time,message:{role:'toolResult',usage:usage(1,1)}},
    {type:'compaction',id:'44444444',parentId:'33333333',timestamp:time,usage:usage(3,2),tokensBefore:50000,retainedTail:[original.message]},
    {type:'branch_summary',id:'55555555',parentId:'44444444',timestamp:time,usage:usage(2,1)},
  ])
  await write(join(root,'independent.jsonl'),[header('B'),message('11111111',null,100,10,0,0)])
  const before=await readFile(source,'utf8'),data=await readPi(root,'all',now)
  assert.equal(data.totals.input,126);assert.equal(data.totals.output,22);assert.equal(data.totals.cacheRead,4);assert.equal(data.totals.cacheWrite,2)
  assert.equal(data.totals.total,154);assert.ok(Math.abs(data.totals.cost!-1.54)<1e-12)
  assert.equal(data.records,6);assert.equal(data.sessions,3);assert.equal(data.issues,0)
  assert.equal(JSON.stringify(data).includes('PRIVATE-SENTINEL'),false);assert.equal(await readFile(source,'utf8'),before)
})
test('Pi clones, missing/cyclic parent sessions, conflicts and unsupported versions have explicit coverage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-pi-lineage-')),a=join(root,'a.jsonl'),b=join(root,'b.jsonl')
  await write(a,[header('A',b),message('11111111',null)])
  await write(b,[header('B',a),message('11111111',null)])
  let data=await readPi(root,'all',now);assert.equal(data.records,1);assert.equal(data.issues,1);assert.equal(data.partial,true)
  await write(b,[header('B',join(root,'missing.jsonl')),message('11111111',null)])
  data=await readPi(root,'all',now);assert.equal(data.issues,1);assert.equal(data.records,1)
  await write(b,[header('A',b),message('11111111',null,99)])
  data=await readPi(root,'all',now);assert.equal(data.records,0);assert.ok(data.issues>=2);assert.equal(data.totals.input,null)
  await write(a,[{...header('A'),version:99}]);await write(b,[{type:'future'}])
  await assert.rejects(readPi(root,'all',now),{kind:'unsupported'})
})

test('relocated native absolute parents preserve dedup without reading the former root',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-pi-relocated-'))
  const id='01999999-1111-7111-8111-111111111111',name=`2026-09-16T10-00-00Z_${id}.jsonl`
  const original=message('11111111',null)
  await write(join(root,name),[header(id),original])
  await write(join(root,'fork.jsonl'),[header('F',join(root,'does-not-exist',name)),original,message('22222222','11111111')])
  const data=await readPi(root,'all',now)
  assert.equal(data.records,2);assert.equal(data.totals.total,34);assert.equal(data.issues,0)
})

test('numeric contradictions, negative cost, aggregate overflow and internal parent cycles never look complete',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-pi-invalid-')),file=join(root,'a.jsonl')
  const large=message('11111111',null,Number.MAX_SAFE_INTEGER,0,0,0)
  await write(file,[header('A'),large,{...large,id:'22222222',message:{...large.message,usage:{...large.message.usage,input:1,totalTokens:1,cost:{total:0}}}}])
  let data=await readPi(root,'all',now);assert.equal(data.totals.input,null);assert.equal(data.totals.total,null);assert.equal(data.partial,true);assert.ok(data.issues>0)
  await write(file,[header('A'),{...large,message:{...large.message,usage:{...large.message.usage,output:1,totalTokens:1}}}])
  data=await readPi(root,'all',now);assert.equal(data.totals.total,null);assert.equal(data.partial,true);assert.ok(data.issues>0)
  const invalid=message('11111111','22222222',1,0,0,0);invalid.message.usage.totalTokens=99;invalid.message.usage.cost.total=-1
  await write(file,[header('A'),invalid,message('22222222','11111111',0,0,0,0)])
  data=await readPi(root,'all',now);assert.equal(data.totals.total,null);assert.equal(data.totals.cost,null);assert.equal(data.partial,true);assert.ok(data.issues>=3)
})
