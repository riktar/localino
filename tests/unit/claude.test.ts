import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,appendFile,mkdir,rename,unlink,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { readClaude } from '../../src/main/agents/claude'
import { aggregate,blankMetrics,dayKey } from '../../src/main/agents/aggregate'

const now=Date.parse('2026-09-16T12:00:00Z')
test('Claude latest contract: streamed copies and forks count original input/cache once, no provisional output or cache subtotal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-claude-'))
  const records=JSON.parse(await readFile(resolve('tests/fixtures/claude-history.json'),'utf8'))
  const text=records.map(record=>JSON.stringify(record)).join('\n')+'\n'
  const file=join(root,'session.jsonl');await writeFile(file,text)
  const data=await readClaude(root,'all',now)
  assert.deepEqual(data.totals,{input:107,output:null,cacheRead:20,cacheWrite:33,reasoning:null,total:null,cost:null})
  assert.equal(data.records,2);assert.equal(data.sessions,2);assert.equal(data.issues,0);assert.equal(data.partial,true)
  assert.equal(data.days.reduce((total,day)=>total+(day.input??0),0),107)
  assert.equal(await readFile(file,'utf8'),text)
  await mkdir(join(root,'subagents'));await rename(file,join(root,'subagents','renamed.jsonl'))
  assert.deepEqual((await readClaude(root,'all',now)).totals,data.totals)
})
test('Claude rebuilding retries incomplete tails and handles truncation, deletion, unknown schema and missing identity',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-claude-tail-')),file=join(root,'session.jsonl')
  const rows=JSON.parse(await readFile(resolve('tests/fixtures/claude-history.json'),'utf8'))
  await writeFile(file,JSON.stringify(rows[0])+'\n'+JSON.stringify(rows[3]).slice(0,-2))
  let data=await readClaude(root,'all',now);assert.equal(data.totals.input,100);assert.equal(data.issues,1)
  await appendFile(file,'}}\n');data=await readClaude(root,'all',now);assert.equal(data.totals.input,107);assert.equal(data.issues,0)
  await writeFile(file,'broken\n'+JSON.stringify({...rows[3],message:{...rows[3].message,id:undefined}})+'\n')
  data=await readClaude(root,'all',now);assert.equal(data.records,0);assert.equal(data.issues,2);assert.equal(data.totals.input,null)
  await writeFile(file,'{"type":"future-format","usage":{"input":42}}\n')
  await assert.rejects(readClaude(root,'all',now),{kind:'unsupported'})
  await unlink(file);assert.equal((await readClaude(root,'all',now)).totals.input,0)
  await assert.rejects(readClaude(join(root,'missing'),'all',now),{code:'ENOENT'})
})
test('local calendar windows respect local midnight and DST; unsafe or missing metrics never become exact totals',()=>{
  const saved=process.env.TZ;process.env.TZ='Europe/Rome'
  try{
    const metrics={...blankMetrics(),input:1,total:1}
    const times=['2026-03-28T23:30:00Z','2026-03-22T23:30:00Z','2026-03-22T22:30:00Z']
    const data=aggregate(times.map((date,index)=>({id:String(index),session:'s',time:Date.parse(date),metrics})),'7',0,Date.parse('2026-03-29T12:00:00Z'))
    assert.equal(data.records,2);assert.deepEqual(data.days.map(d=>d.date),['2026-03-23','2026-03-29'])
    assert.equal(dayKey(Date.parse(times[0])),'2026-03-29')
    const overflow=aggregate([1,2].map(id=>({id:String(id),session:'s',time:now,metrics:{...metrics,input:Number.MAX_SAFE_INTEGER}})),'all',0,now)
    assert.equal(overflow.totals.input,null)
  }finally{if(saved===undefined)delete process.env.TZ;else process.env.TZ=saved}
})

test('ambiguous identities excluded; equal independent responses retained; links outside selected root never followed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'localino-claude-identity-')),outside=await mkdtemp(join(tmpdir(),'localino-outside-'))
  const [sample]=JSON.parse(await readFile(resolve('tests/fixtures/claude-history.json'),'utf8'))
  const copy=JSON.parse(JSON.stringify(sample));copy.message.id='independent'
  const conflict=JSON.parse(JSON.stringify(sample));conflict.message.usage.input_tokens=99
  await writeFile(join(root,'a.jsonl'),[sample,copy,conflict,sample].map(row=>JSON.stringify(row)).join('\n'))
  await writeFile(join(outside,'never-read.jsonl'),JSON.stringify(copy))
  await symlink(outside,join(root,'linked'),'junction')
  const data=await readClaude(root,'all',now)
  assert.equal(data.records,1);assert.equal(data.totals.input,100);assert.equal(data.issues,2)
})
