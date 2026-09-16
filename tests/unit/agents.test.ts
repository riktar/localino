import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPreferences } from '../../src/main/agents/preferences'
import { HistoryResource, HistoryFailure } from '../../src/main/agents/history-resource'
import type { HistoryData } from '../../src/shared/agents'

const data:HistoryData={totals:{input:1,output:2,total:3,cacheRead:null,cacheWrite:null,reasoning:null,cost:null},days:[],sessions:1,records:1,issues:0,partial:false,sampledAt:10,period:'7',semantics:'events'}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve))
test('agent preferences survive restart; corrupt input is preserved until explicit recovery',()=>{
  const root=mkdtempSync(join(tmpdir(),'localino-agents-')), file=join(root,'agents.json')
  const prefs=new AgentPreferences(file)
  assert.ok(Object.values(prefs.state.sources).every(source=>!source.enabled))
  prefs.select('pi');prefs.source('pi',{enabled:true,path:root})
  assert.deepEqual(new AgentPreferences(file).state,prefs.state)
  writeFileSync(file,'broken')
  const broken=new AgentPreferences(file)
  assert.throws(()=>broken.select('claude'));assert.equal(readFileSync(file,'utf8'),'broken')
  broken.recover();assert.equal(broken.state.selected,'codex')
  assert.equal(readFileSync(join(root,readdirSync(root).find(name=>name.endsWith('.preserved'))!),'utf8'),'broken')
})
test('local resources opt in, coalesce, preserve failed same-source data, cancel obsolete reads and stop hidden polling',async()=>{
  let now=0,tick=()=>{},calls=0,fail=false
  const resource=new HistoryResource('pi',async()=>{calls++;if(fail)throw new HistoryFailure('busy');return data},{now:()=>now,every:fn=>{tick=fn;return ()=>{}}})
  try {
    tick();await resource.refresh();assert.equal(calls,0)
    resource.configure({enabled:true,path:'source-a'});await resource.refresh();assert.equal(calls,1)
    assert.equal(resource.state.data,data)
    now=70_000;tick();await turn();assert.equal(calls,1)
    resource.setActive(true);await resource.refresh();assert.equal(calls,2)
    fail=true;await resource.refresh();assert.equal(resource.state.error,'busy');assert.equal(resource.state.data,data);assert.equal(resource.state.stale,true)
    resource.setActive(false);now+=70_000;tick();await turn();assert.equal(calls,3)
    resource.configure({enabled:false,path:'source-a'});assert.equal(resource.state.data,null)
  }finally{resource.dispose()}
  const requests:{path:string;resolve:(value:HistoryData)=>void;signal:AbortSignal}[]=[]
  const slow=new HistoryResource('claude',(path,_period,signal)=>new Promise(resolve=>requests.push({path,resolve,signal})))
  try{
    slow.configure({enabled:true,path:'old'});await turn()
    const pending=slow.refresh();assert.equal(pending,slow.refresh())
    slow.configure({enabled:true,path:'new'});await turn()
    assert.equal(requests[0].signal.aborted,true)
    requests[0].resolve(data);await turn();assert.equal(slow.state.data,null)
    requests[1].resolve({...data,records:2});await slow.refresh();assert.equal(slow.state.data?.records,2)
    slow.configure({enabled:false,path:'new'});assert.equal(slow.state.data,null)
  }finally{slow.dispose()}
})
