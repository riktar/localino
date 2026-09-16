import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {fixture} from '../fixtures/opencode.mjs'
import {readOpenCode} from '../../src/main/agents/opencode'
import {openCodeSource} from '../../src/main/agents/opencode-source'
const now=Date.parse('2026-09-16T12:00:00Z')
const source=async()=>join(await mkdtemp(join(tmpdir(),'localino-opencode-')),'archivio è.db')

test('latest native schema counters match SQL/stats oracle; rolling boundary, forks and deletion follow session counters',async()=>{
  const path=await source(),{db,add}=fixture(path,now)
  add('fork',now);db.prepare('INSERT INTO message VALUES(?,?,?,?,?)').run('copy','fork',now,now,'PRIVATE-SENTINEL: tokens1000000')
  let data=await readOpenCode(path,'7',now)
  assert.deepEqual(data.totals,{input:100,output:20,reasoning:3,cacheRead:7,cacheWrite:5,total:135,cost:0.42})
  assert.equal(data.sessions,2);assert.deepEqual(data.days,[]);assert.equal(data.semantics,'updated_sessions');assert.equal(data.issues,0)
  add('boundary',now-7*86400000,1);add('outside',now-7*86400000-1,2)
  assert.equal((await readOpenCode(path,'7',now)).totals.input,101)
  assert.equal((await readOpenCode(path,'30',now)).totals.input,103)
  db.exec("UPDATE session SET tokens_output=2 WHERE id='fork'; DELETE FROM session WHERE id='boundary'")
  assert.equal((await readOpenCode(path,'all',now)).totals.total,152)
  db.close();const before=await readFile(path)
  data=await readOpenCode(path,'all',now);assert.ok(!JSON.stringify(data).includes('PRIVATE-SENTINEL'));assert.deepEqual(await readFile(path),before)
})

test('WAL reader sees committed snapshot, lock is bounded/recoverable, read-only source survives',async()=>{
  const path=await source(),{db}=fixture(path,now)
  db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; UPDATE session SET tokens_input=999')
  assert.equal((await readOpenCode(path,'7',now)).totals.input,100)
  db.exec('COMMIT');assert.equal((await readOpenCode(path,'7',now)).totals.input,999)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE')
  const start=Date.now();await assert.rejects(readOpenCode(path,'all',now),{kind:'busy'});assert.ok(Date.now()-start<1500)
  db.exec('ROLLBACK');db.close();assert.equal((await readOpenCode(path,'all',now)).records,2)
})

test('missing, corrupt, incompatible, replaced and empty SQLite sources have distinct outcomes',async()=>{
  const path=await source()
  await assert.rejects(readOpenCode(path,'all'),{code:'ENOENT'})
  await writeFile(path,'not SQLite');await assert.rejects(readOpenCode(path,'all'),{kind:'invalid'})
  await rename(path,path+'.broken');let db=new DatabaseSync(path);db.exec('CREATE TABLE future(id TEXT)');db.close()
  await assert.rejects(readOpenCode(path,'all'),{kind:'unsupported'})
  await rename(path,path+'.future');db=fixture(path,now).db;db.exec('DELETE FROM session');db.close()
  const empty=await readOpenCode(path,'all');assert.equal(empty.totals.total,0);assert.equal(empty.totals.cost,0);assert.equal(empty.partial,false)
})

test('invalid counters, fractional tokens and aggregate overflow retain known components with partial coverage',async()=>{
  const path=await source(),{db}=fixture(path,now)
  db.exec("UPDATE session SET tokens_input=9223372036854775807,cost=-1 WHERE id='recent'")
  let data=await readOpenCode(path,'all',now);assert.equal(data.totals.input,null);assert.equal(data.totals.total,null);assert.equal(data.totals.cost,null);assert.equal(data.partial,true)
  db.exec(`UPDATE session SET tokens_input=${Number.MAX_SAFE_INTEGER},cost=0`)
  data=await readOpenCode(path,'all',now);assert.equal(data.totals.input,null);assert.ok(data.issues>0)
  db.exec('UPDATE session SET tokens_input=0.5');data=await readOpenCode(path,'all',now);assert.equal(data.totals.input,null);assert.equal(data.partial,true);db.close()
})

test('default discovery respects explicit OPENCODE_DB and requires a choice when multiple databases exist',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'localino-opencode-discover-'))
  assert.equal(await openCodeSource(dir,''),join(dir,'opencode.db'))
  await writeFile(join(dir,'opencode.db'),'');await writeFile(join(dir,'opencode-beta.db'),'')
  await assert.rejects(openCodeSource(dir,''),/Multiple OpenCode databases/)
  assert.equal(await openCodeSource(dir,'custom.db'),join(dir,'custom.db'))
  await assert.rejects(openCodeSource(dir,':memory:'),/in-memory/)
})
