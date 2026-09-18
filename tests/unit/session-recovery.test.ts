import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRecoveryStore } from '../../src/main/sessions/recovery'
import { SessionSupervisor } from '../../src/main/sessions/supervisor'
import type { LiveSession } from '../../src/shared/sessions'

function session(projectPath:string):LiveSession{return {id:'local-one',agent:'codex',protocol:'codex-app-server',projectPath,projectName:'project',providerSessionId:'provider-one',status:'running',createdAt:1,turnStartedAt:null,turnElapsedMs:null,lastTurnOutcome:null,updatedAt:1,error:null,draft:'riga uno\nemoji 🧪',deliveries:[{id:'delivery-one',text:'messaggio\n🌍',createdAt:2,status:'queued',error:null}]}}

test('drafts and unresolved deliveries survive restart as suspended without changing text',()=>{
  const directory=mkdtempSync(join(tmpdir(),'localino-recovery-')),file=join(directory,'sessions.json'),store=new SessionRecoveryStore(file),original=session(directory)
  assert.equal(store.save(original),true)
  const restored=new SessionRecoveryStore(file).state[0]
  assert.equal(restored.draft,original.draft)
  assert.equal(restored.deliveries[0].text,original.deliveries[0].text)
  assert.equal(restored.deliveries[0].status,'suspended')
  const restarted=new SessionSupervisor(undefined,undefined,new SessionRecoveryStore(file))
  assert.equal(restarted.state.sessions.length,0)
  assert.equal(restarted.state.recovered[0].deliveries[0].status,'suspended')
})

test('a corrupt recovery file is preserved and reported instead of overwritten',()=>{
  const directory=mkdtempSync(join(tmpdir(),'localino-recovery-corrupt-')),file=join(directory,'sessions.json')
  writeFileSync(file,'{broken','utf8');const store=new SessionRecoveryStore(file)
  assert.match(store.error!,/preserved/);assert.equal(store.save(session(directory)),false);assert.equal(readFileSync(file,'utf8'),'{broken')
})

test('definitively delivered text is removed from the recovery store',()=>{
  const directory=mkdtempSync(join(tmpdir(),'localino-recovery-sent-')),file=join(directory,'sessions.json'),store=new SessionRecoveryStore(file),value=session(directory)
  value.draft='';value.deliveries[0].status='sent';assert.equal(store.save(value),true)
  assert.deepEqual(new SessionRecoveryStore(file).state,[])
})
