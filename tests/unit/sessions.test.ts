import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { SessionSupervisor } from '../../src/main/sessions/supervisor'
import type { AgentId } from '../../src/shared/agents'

class FakeChild extends EventEmitter {
  stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();exitCode:number|null=null
  constructor(){super();this.stdin.once('finish',()=>queueMicrotask(()=>this.kill()))}
  kill():boolean{if(this.exitCode!==null)return false;this.exitCode=0;this.emit('exit',0,null);return true}
}
const wait=()=>new Promise(resolve=>setTimeout(resolve,0))
const line=(child:FakeChild,value:unknown)=>child.stdout.write(`${JSON.stringify(value)}\n`)

function fixture(){
  const children:FakeChild[]=[],calls:{command:string;args:string[];options:SpawnOptionsWithoutStdio}[]=[]
  const spawnProcess=(command:string,args:string[],options:SpawnOptionsWithoutStdio):ChildProcessWithoutNullStreams=>{
    const child=new FakeChild();children.push(child);calls.push({command,args,options});queueMicrotask(()=>child.emit('spawn'));return child as unknown as ChildProcessWithoutNullStreams
  }
  const resolver=async(agent:AgentId)=>({path:`${agent}.fixture`,version:`${agent} 1.0.0`})
  return {children,calls,supervisor:new SessionSupervisor(spawnProcess,resolver)}
}

test('capability discovery keeps missing binaries distinct and does not start them',async()=>{
  const {supervisor}=fixture()
  const missing=new SessionSupervisor(()=>{throw Error('must not spawn')},async agent=>agent==='pi'?null:{path:`${agent}.fixture`,version:null})
  const state=await missing.refreshCapabilities()
  assert.equal(state.capabilities.pi.status,'missing')
  assert.equal(state.capabilities.codex.status,'available')
  const result=await missing.start('pi',mkdtempSync(join(tmpdir(),'localino-session-')))
  assert.deepEqual(result,{ok:false,error:'pi binary is unavailable.'})
  await supervisor.dispose();await missing.dispose()
})

test('Codex App Server handshake creates one isolated session and maps turn lifecycle',async()=>{
  const {supervisor,children,calls}=fixture();await supervisor.refreshCapabilities()
  const project=mkdtempSync(join(tmpdir(),'localino-codex-')),result=await supervisor.start('codex',project);assert.equal(result.ok,true)
  await wait();const child=children[0],written:string[]=[];child.stdin.on('data',chunk=>written.push(String(chunk)))
  // The initialize write happens before this listener, so use the stable request IDs.
  line(child,{id:1,result:{}});await wait();line(child,{id:2,result:{thread:{id:'thread-one'}}});await wait()
  assert.deepEqual(calls[0].args,['app-server','--stdio'])
  assert.equal(calls[0].options.cwd,project)
  assert.equal(supervisor.state.sessions[0].providerSessionId,'thread-one')
  assert.equal(supervisor.state.sessions[0].status,'idle')
  line(child,{method:'turn/started',params:{turn:{id:'turn-one',startedAt:123}}});await wait()
  assert.equal(supervisor.state.sessions[0].status,'running')
  assert.equal(supervisor.state.sessions[0].turnStartedAt,123000)
  line(child,{method:'turn/completed',params:{turn:{id:'turn-one'}}});await wait()
  assert.equal(supervisor.state.sessions[0].status,'idle')
  assert.equal(supervisor.state.sessions[0].turnStartedAt,null)
  assert.ok(supervisor.state.sessions[0].turnElapsedMs!>=0)
  assert.equal(written.join('').includes('thread/start'),true)
  await supervisor.dispose()
})

test('Pi and Claude use machine protocols without a terminal and stop independently',async()=>{
  const {supervisor,children,calls}=fixture();await supervisor.refreshCapabilities();const project=mkdtempSync(join(tmpdir(),'localino-cli-'))
  const pi=await supervisor.start('pi',project),claude=await supervisor.start('claude',project);await wait()
  assert.equal(pi.ok,true);assert.equal(claude.ok,true)
  assert.deepEqual(calls[0].args.slice(0,3),['--mode','rpc','--no-approve'])
  assert.ok(calls[1].args.includes('stream-json'))
  line(children[0],{id:1,type:'response',command:'get_state',success:true,data:{sessionId:'pi-one'}});await wait()
  assert.equal(supervisor.state.sessions.find(session=>session.agent==='pi')?.status,'idle')
  assert.equal(supervisor.state.sessions.find(session=>session.agent==='claude')?.status,'idle')
  await supervisor.stop(pi.sessionId!);children[0].kill();await wait()
  assert.equal(supervisor.state.sessions.find(session=>session.agent==='pi')?.status,'stopped')
  assert.equal(supervisor.state.sessions.find(session=>session.agent==='claude')?.status,'idle')
  await supervisor.dispose()
})

test('OpenCode owns an authenticated loopback server and creates its session',async()=>{
  const {supervisor,calls}=fixture();const originalFetch=globalThis.fetch
  globalThis.fetch=async input=>{
    const url=String(input)
    if(url.endsWith('/global/health'))return Response.json({healthy:true,version:'1.0.0'})
    if(url.endsWith('/session'))return Response.json({id:'open-one'})
    if(url.endsWith('/instance/dispose'))return Response.json(true)
    return Response.json({})
  }
  try{
    await supervisor.refreshCapabilities();const result=await supervisor.start('opencode',mkdtempSync(join(tmpdir(),'localino-open-')));await wait();await wait()
    assert.equal(result.ok,true)
    assert.equal(calls[0].args[0],'serve');assert.equal(calls[0].args[1],'--hostname');assert.equal(calls[0].args[2],'127.0.0.1')
    const session=supervisor.state.sessions[0];assert.equal(session.providerSessionId,'open-one');assert.equal(session.status,'idle')
  }finally{await supervisor.dispose();globalThis.fetch=originalFetch}
})
