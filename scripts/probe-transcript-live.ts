import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { SessionSupervisor } from '../src/main/sessions/supervisor'
import { TranscriptClient } from '../src/main/sessions/transcript-client'
import { SessionRecoveryStore } from '../src/main/sessions/recovery'
import type { AgentId } from '../src/shared/agents'
import type { TranscriptEvent } from '../src/shared/transcript'

// Explicitly invoked only: authenticated, read-only turns in a fresh temporary project.
async function main():Promise<void>{
const root=await mkdtemp(join(tmpdir(),'localino-live-transcript-'))
const marker='LOCALINO_READONLY_006 λ🌍'
await writeFile(join(root,'localino-probe.txt'),marker,'utf8')
const store=new TranscriptClient(resolve('out/main/transcript-worker.js'),join(root,'transcripts'))
const supervisor=new SessionSupervisor(undefined,undefined,new SessionRecoveryStore(join(root,'recovery.json')),store)
const events:TranscriptEvent[]=[];store.on('events',batch=>events.push(...batch))
const wait=()=>new Promise(resolveWait=>setTimeout(resolveWait,100))
const selected=(process.argv.slice(2).length?process.argv.slice(2):['codex','claude','pi']) as AgentId[]
const reports:unknown[]=[]
try{
  await supervisor.refreshCapabilities()
  for(const agent of selected){
    const started=Date.now(),result=await supervisor.start(agent,root),id=result.sessionId
    if(!result.ok||!id){reports.push({agent,result:'unavailable'});continue}
    const current=()=>supervisor.state.sessions.find(session=>session.id===id)!
    while(!['idle','ready','error','stopped','unknown'].includes(current().status)&&Date.now()-started<30000)await wait()
    if(['idle','ready'].includes(current().status)){
      await supervisor.send(id,'Read only the file localino-probe.txt in this working directory using a read-only tool. Do not modify files, run writes, or use the network. Reply with its exact contents followed by two short sentences explaining that this was a read-only check.')
      while(Date.now()-started<150000){await wait();const state=current();if(state.deliveries[0]?.status!=='sending'&&['idle','error','stopped','waiting'].includes(state.status))break}
    }
    await new Promise(resolveWait=>setTimeout(resolveWait,200))
    const own=events.filter(event=>event.sessionId===id),state=current()
    const page=await store.page(id)
    const report={agent,version:supervisor.state.capabilities[agent].version,status:state.status,outcome:state.lastTurnOutcome,delivery:state.deliveries[0]?.status,eventCount:own.length,kinds:[...new Set(own.map(event=>event.kind))],assistantDeltas:own.filter(event=>event.kind==='assistant'&&event.operation==='append').length,hasMarker:own.some(event=>event.text?.includes(marker)),storedEvents:page.info.events,errors:own.filter(event=>event.kind==='error').map(event=>({label:event.label,text:event.text?.slice(0,160)})),unknownLabels:[...new Set(own.filter(event=>event.kind==='unknown').map(event=>event.label))],elapsedMs:Date.now()-started,fixtureUnchanged:await readFile(join(root,'localino-probe.txt'),'utf8')===marker}
    reports.push(report);console.log(JSON.stringify(report))
    await supervisor.stop(id)
  }
}finally{await supervisor.dispose();await store.dispose()}
await writeFile(resolve(`.theoneloop/evidence/LIVE-TRANSCRIPT-006-${selected.join('-')}.json`),JSON.stringify({date:new Date().toISOString(),reports},null,2),'utf8')
}
void main().catch(()=>{console.error('Live transcript probe failed.');process.exitCode=1})
