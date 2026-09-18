import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { agentIds, type AgentId } from '../../shared/agents'
import { initialLiveSessions, sessionProtocols, type LiveSession, type LiveSessionsState, type SessionCapability, type SessionDelivery, type SessionResult } from '../../shared/sessions'

type SpawnAgent = (command:string,args:string[],options:SpawnOptionsWithoutStdio)=>ChildProcessWithoutNullStreams
type ResolveAgent = (agent:AgentId)=>Promise<{path:string;version:string|null}|null>

interface ManagedSession {
  view: LiveSession
  child: ChildProcessWithoutNullStreams
  buffer: JsonlBuffer
  requestSequence: number
  pending: Map<number,string>
  endpoint?: string
  authorization?: string
  poll?: NodeJS.Timeout
  health?: NodeJS.Timeout
  deadline?: NodeJS.Timeout
  lastContactAt: number
  generation: number
  pollingGeneration?: number
  resumeStatus?: LiveSession['status']
  piTurnOutcome?: LiveSession['lastTurnOutcome']
  stopping: boolean
}

const executableNames:Record<AgentId,string>={codex:'codex',claude:'claude',pi:'pi',opencode:'opencode'}

export class JsonlBuffer {
  private readonly decoder=new StringDecoder('utf8')
  private pending=''
  push(chunk:Buffer|string,onLine:(line:string)=>void):void {
    this.pending+=typeof chunk==='string'?chunk:this.decoder.write(chunk)
    for(let index=this.pending.indexOf('\n');index>=0;index=this.pending.indexOf('\n')){
      let line=this.pending.slice(0,index);this.pending=this.pending.slice(index+1)
      if(line.endsWith('\r'))line=line.slice(0,-1)
      if(line)onLine(line)
    }
  }
  end(onLine:(line:string)=>void):void {
    this.pending+=this.decoder.end()
    let line=this.pending;this.pending=''
    if(line.endsWith('\r'))line=line.slice(0,-1)
    if(line)onLine(line)
  }
}

function spawnAgent(command:string,args:string[],options:SpawnOptionsWithoutStdio):ChildProcessWithoutNullStreams {
  const batch=process.platform==='win32'&&/\.(cmd|bat)$/i.test(command)
  if(batch){
    if(/["\r\n]/.test(command)||args.some(arg=>!/^[-\w.:/]+$/.test(arg)))throw Error('Unsafe batch invocation.')
    const line=`"${command}" ${args.map(arg=>`"${arg}"`).join(' ')}`
    return spawn(line,[],{...options,shell:true,windowsHide:true})
  }
  return spawn(command,args,{...options,windowsHide:true})
}

function readVersion(command:string):ReturnType<typeof spawnSync>{
  if(process.platform==='win32'&&/\.(cmd|bat)$/i.test(command)){
    if(/["\r\n]/.test(command))return {status:1,stdout:'',stderr:''} as ReturnType<typeof spawnSync>
    return spawnSync(`"${command}"`,['--version'],{encoding:'utf8',shell:true,windowsHide:true,timeout:5000})
  }
  return spawnSync(command,['--version'],{encoding:'utf8',windowsHide:true,timeout:5000})
}

function sanitizedVersion(output:string):string|null {
  const line=output.split(/\r?\n/,1)[0]?.trim()
  return line&&line.length<=160&&!/[\\/]/.test(line)?line:null
}

export async function resolveAgentBinary(agent:AgentId):Promise<{path:string;version:string|null}|null> {
  const override=process.env[`LOCALINO_${agent.toUpperCase()}_PATH`]
  let candidate=override&&existsSync(override)?resolve(override):null
  if(!candidate){
    const locator=process.platform==='win32'?'where.exe':'which'
    const found=spawnSync(locator,[executableNames[agent]],{encoding:'utf8',windowsHide:true,timeout:5000})
    const matches=found.status===0?found.stdout.split(/\r?\n/).map(value=>value.trim()).filter(value=>value&&!/\.ps1$/i.test(value)&&existsSync(value)):[]
    if(process.platform==='win32')matches.sort((a,b)=>Number(!/\.(exe|com)$/i.test(a))-Number(!/\.(exe|com)$/i.test(b))||Number(!/\.(cmd|bat)$/i.test(a))-Number(!/\.(cmd|bat)$/i.test(b)))
    candidate=matches[0]??null
  }
  if(!candidate)return null
  const version=readVersion(candidate)
  return {path:candidate,version:version.status===0?sanitizedVersion(`${version.stdout??''}\n${version.stderr??''}`):null}
}

function commandFor(agent:AgentId,providerSessionId?:string):string[] {
  if(agent==='codex')return ['app-server','--stdio']
  if(agent==='claude')return ['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--replay-user-messages','--include-hook-events','--permission-mode','manual','--session-id',providerSessionId!]
  if(agent==='pi')return ['--mode','rpc','--no-approve','--session-id',randomUUID()]
  return []
}

async function freePort():Promise<number>{
  return new Promise((resolvePort,reject)=>{const server=createServer();server.unref();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();const port=typeof address==='object'&&address?address.port:0;server.close(error=>error?reject(error):resolvePort(port))})})
}

const copyState=(capabilities:Record<AgentId,SessionCapability>,sessions:Map<string,ManagedSession>):LiveSessionsState=>({
  capabilities:Object.fromEntries(agentIds.map(id=>[id,{...capabilities[id]}])) as Record<AgentId,SessionCapability>,
  sessions:[...sessions.values()].map(item=>({...item.view,deliveries:item.view.deliveries.map(delivery=>({...delivery}))})).sort((a,b)=>a.createdAt-b.createdAt),
})

export class SessionSupervisor extends EventEmitter {
  private readonly capabilities=initialLiveSessions().capabilities
  private readonly binaries=new Map<AgentId,string>()
  private readonly sessions=new Map<string,ManagedSession>()
  private disposed=false
  constructor(private readonly spawnProcess:SpawnAgent=spawnAgent,private readonly resolver:ResolveAgent=resolveAgentBinary){super()}
  get state():LiveSessionsState{return copyState(this.capabilities,this.sessions)}
  async refreshCapabilities():Promise<LiveSessionsState>{
    await Promise.all(agentIds.map(async agent=>{
      try{
        const resolved=await this.resolver(agent)
        if(resolved){this.binaries.set(agent,resolved.path);this.capabilities[agent]={agent,status:'available',protocol:sessionProtocols[agent],version:resolved.version,error:null}}
        else{this.binaries.delete(agent);this.capabilities[agent]={agent,status:'missing',protocol:sessionProtocols[agent],version:null,error:'Binary not found.'}}
      }catch{this.binaries.delete(agent);this.capabilities[agent]={agent,status:'error',protocol:sessionProtocols[agent],version:null,error:'Could not inspect binary.'}}
    }))
    this.changed();return this.state
  }
  async start(agent:AgentId,projectPath:string):Promise<SessionResult>{
    if(this.disposed)return {ok:false,error:'Session supervisor is shutting down.'}
    let directory:string
    try{directory=resolve(projectPath);if(!statSync(directory).isDirectory())throw Error()}
    catch{return {ok:false,error:'Choose an existing project folder.'}}
    if(this.capabilities[agent].status==='checking')await this.refreshCapabilities()
    const binary=this.binaries.get(agent)
    if(!binary)return {ok:false,error:`${executableNames[agent]} binary is unavailable.`}
    const id=randomUUID(),now=Date.now(),providerSessionId=agent==='claude'?randomUUID():null
    const view:LiveSession={id,agent,protocol:sessionProtocols[agent],projectPath:directory,projectName:basename(directory)||directory,providerSessionId,status:'starting',createdAt:now,turnStartedAt:null,turnElapsedMs:null,lastTurnOutcome:null,updatedAt:now,error:null,deliveries:[]}
    try{
      const port=agent==='opencode'?await freePort():null
      const password=agent==='opencode'?randomBytes(24).toString('base64url'):null
      const args=agent==='opencode'?['serve','--hostname','127.0.0.1','--port',String(port)]:commandFor(agent,providerSessionId??undefined)
      const env=agent==='opencode'?{...process.env,OPENCODE_SERVER_USERNAME:'localino',OPENCODE_SERVER_PASSWORD:password!}:process.env
      const child=this.spawnProcess(binary,args,{cwd:directory,env,stdio:['pipe','pipe','pipe']})
      const managed:ManagedSession={view,child,buffer:new JsonlBuffer(),requestSequence:0,pending:new Map(),lastContactAt:now,generation:0,stopping:false,...(port&&password?{endpoint:`http://127.0.0.1:${port}`,authorization:`Basic ${Buffer.from(`localino:${password}`).toString('base64')}`}:{})}
      this.sessions.set(id,managed);this.attach(managed);this.changed()
      return {ok:true,sessionId:id}
    }catch{return {ok:false,error:'Could not start the agent process.'}}
  }
  async stop(id:string):Promise<SessionResult>{
    const session=this.sessions.get(id);if(!session)return {ok:false,error:'Session not found.'}
    if(session.view.status==='stopped')return {ok:true,sessionId:id}
    const wasRunning=session.view.status==='running'||session.view.status==='waiting'
    session.stopping=true;session.generation++;this.clearTimers(session);this.update(session,{status:'stopping',error:null})
    if(session.poll)clearInterval(session.poll)
    try{
      if(session.view.agent==='pi'&&wasRunning)this.write(session,{type:'abort'})
      if(session.view.agent==='opencode'&&session.endpoint)void this.request(session,'/instance/dispose',{method:'POST'}).catch(()=>{})
      session.child.stdin.end()
      const forced=setTimeout(()=>{if(session.child.exitCode===null)session.child.kill()},1500);forced.unref()
      return {ok:true,sessionId:id}
    }catch{session.child.kill();return {ok:true,sessionId:id}}
  }
  async send(id:string,text:string):Promise<SessionResult>{
    const session=this.sessions.get(id);if(!session)return {ok:false,error:'Session not found.'}
    const clean=text.trim();if(!clean)return {ok:false,error:'Message is empty.'}
    if(text.length>100_000)return {ok:false,error:'Message is too large.'}
    if(['stopped','stopping','error','unknown','starting'].includes(session.view.status))return {ok:false,error:'Session is not ready.'}
    const delivery:SessionDelivery={id:randomUUID(),text,createdAt:Date.now(),status:session.view.status==='idle'||session.view.status==='ready'?'sending':'queued',error:null}
    session.view.deliveries=[...session.view.deliveries,delivery];session.view.updatedAt=Date.now();this.changed()
    if(delivery.status==='sending')void this.dispatch(session,delivery)
    return {ok:true,sessionId:delivery.id}
  }
  cancel(sessionId:string,deliveryId:string):SessionResult{
    const session=this.sessions.get(sessionId);if(!session)return {ok:false,error:'Session not found.'}
    const delivery=session.view.deliveries.find(item=>item.id===deliveryId)
    if(!delivery||delivery.status!=='queued')return {ok:false,error:'Only queued messages can be cancelled.'}
    delivery.status='cancelled';session.view.updatedAt=Date.now();this.changed();return {ok:true,sessionId:deliveryId}
  }
  suspend():void{
    for(const session of this.sessions.values()){
      if(session.stopping||['stopped','stopping','error'].includes(session.view.status))continue
      session.resumeStatus=session.view.status;session.generation++;this.clearTimers(session)
      this.update(session,{status:'unknown',error:'Session state will be reconciled after resume.'})
    }
  }
  resume():void{
    for(const session of this.sessions.values()){
      if(session.stopping||session.view.status!=='unknown')continue
      if(session.child.exitCode!==null||session.child.stdin.destroyed||!session.child.stdin.writable){this.update(session,{status:'unknown',error:'Agent process is unreachable.'});continue}
      if(session.view.agent==='codex'||session.view.agent==='pi')this.sendHealthCheck(session,true)
      else if(session.view.agent==='opencode')void this.pollOpenCode(session,true)
      else if(session.resumeStatus==='idle'||session.resumeStatus==='ready')this.update(session,{status:session.resumeStatus,error:null})
      session.resumeStatus=undefined;this.armHealth(session)
    }
  }
  async dispose():Promise<void>{
    this.disposed=true
    await Promise.all([...this.sessions.keys()].map(id=>this.stop(id)))
    await Promise.all([...this.sessions.values()].map(session=>new Promise<void>(resolveDone=>{if(session.child.exitCode!==null)return resolveDone();const timeout=setTimeout(resolveDone,2000);session.child.once('exit',()=>{clearTimeout(timeout);resolveDone()})})))
  }
  private attach(session:ManagedSession):void{
    session.deadline=setTimeout(()=>{
      if(session.view.status!=='starting'||session.stopping)return
      this.update(session,{status:'unknown',error:'Agent protocol did not respond within 15 seconds.'})
      session.child.kill()
    },15_000);session.deadline.unref()
    session.child.stdout.on('data',chunk=>session.buffer.push(chunk,line=>this.record(session,line)))
    session.child.stdout.on('end',()=>session.buffer.end(line=>this.record(session,line)))
    session.child.stderr.on('data',()=>{/* Provider stderr can contain prompts, paths or credentials and is never surfaced. */})
    session.child.once('error',()=>this.fail(session,'Agent process could not be started.'))
    session.child.once('exit',code=>{
      session.generation++;this.clearTimers(session)
      for(const delivery of session.view.deliveries){if(delivery.status==='sending')delivery.status='unknown';else if(delivery.status==='queued')delivery.status='cancelled'}
      const terminal=session.view.status==='error'||session.view.status==='unknown'
      this.update(session,{status:terminal?session.view.status:session.stopping||code===0?'stopped':'error',turnStartedAt:null,error:terminal?session.view.error:session.stopping||code===0?null:'Agent process exited unexpectedly.'})
    })
    session.child.once('spawn',()=>{
      if(session.view.agent==='codex'){
        const requestId=++session.requestSequence
        this.write(session,{id:requestId,method:'initialize',params:{clientInfo:{name:'localino',title:'Localino',version:'0.1.0'},capabilities:{experimentalApi:false}}})
        session.pending.set(requestId,'initialize')
      }else if(session.view.agent==='pi'){
        const requestId=++session.requestSequence;session.pending.set(requestId,'initialize');this.write(session,{id:requestId,type:'get_state'})
      }else if(session.view.agent==='claude'){
        if(session.deadline)clearTimeout(session.deadline)
        const generation=session.generation
        session.deadline=setTimeout(()=>{
          session.deadline=undefined
          if(!session.stopping&&generation===session.generation&&session.child.exitCode===null&&session.child.stdin.writable)this.update(session,{status:'ready'})
        },250);session.deadline.unref()
      }
      else void this.startOpenCode(session)
      this.armHealth(session)
    })
  }
  private record(session:ManagedSession,line:string):void{
    if(session.stopping||session.view.status==='stopped'||session.view.status==='stopping')return
    let value:Record<string,unknown>;try{value=JSON.parse(line) as Record<string,unknown>}catch{return}
    session.lastContactAt=Date.now();if(session.view.status!=='starting'&&session.deadline){clearTimeout(session.deadline);session.deadline=undefined}
    if(session.view.agent==='codex')this.codexRecord(session,value)
    else if(session.view.agent==='pi')this.piRecord(session,value)
    else if(session.view.agent==='claude')this.claudeRecord(session,value)
  }
  private codexRecord(session:ManagedSession,value:Record<string,unknown>):void{
    if(typeof value.id==='number'){
      const pending=session.pending.get(value.id);session.pending.delete(value.id)
      if(pending==='initialize'){
        if(value.error)return this.fail(session,'Codex App Server handshake failed.')
        this.write(session,{method:'initialized',params:{}})
        const id=++session.requestSequence;session.pending.set(id,'thread');this.write(session,{id,method:'thread/start',params:{cwd:session.view.projectPath,approvalPolicy:'on-request',sandbox:'workspace-write'}})
      }else if(pending==='thread'){
        const result=value.result as {thread?:{id?:unknown}}|undefined,id=result?.thread?.id
        if(typeof id!=='string')return this.fail(session,'Codex did not create a session.')
        this.update(session,{providerSessionId:id,status:'idle'})
      }else if(pending==='health'){
        const result=value.result as {thread?:{status?:{type?:unknown}}}|undefined,type=result?.thread?.status?.type
        if(value.error||typeof type!=='string')this.update(session,{status:'unknown',error:'Codex session state is unavailable.'})
        else if(type==='active')this.update(session,{status:'running',turnStartedAt:session.view.turnStartedAt,lastTurnOutcome:null,error:null})
        else if(type==='systemError')this.update(session,{status:'idle',lastTurnOutcome:'failed',error:'The last Codex turn failed.'})
        else this.idle(session,session.view.lastTurnOutcome)
      }else if(pending?.startsWith('delivery:')){
        const delivery=this.delivery(session,pending.slice(9));if(value.error&&delivery){delivery.status='failed';delivery.error='Codex rejected the message.';this.update(session,{status:'idle',turnStartedAt:null})}
        else if(delivery){delivery.status='sent';this.touch(session)}
      }
    }
    const params=value.params as Record<string,unknown>|undefined
    if(value.method==='turn/started')this.update(session,{status:'running',turnStartedAt:this.codexStartedAt(params),turnElapsedMs:null,lastTurnOutcome:null,error:null})
    if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput','item/permissions/requestApproval'].includes(String(value.method)))this.update(session,{status:'waiting'})
    if(value.method==='serverRequest/resolved'&&session.view.status==='waiting')this.update(session,{status:'running'})
    if(value.method==='turn/completed'){
      const turn=params?.turn as {status?:unknown}|undefined,status=turn?.status
      this.idle(session,status==='failed'?'failed':status==='interrupted'?'interrupted':'completed')
    }
    if(value.method==='turn/interrupted')this.idle(session,'interrupted')
  }
  private codexStartedAt(params:Record<string,unknown>|undefined):number|null{
    const turn=params?.turn as {startedAt?:unknown}|undefined,value=turn?.startedAt
    if(typeof value!=='number'||!Number.isFinite(value))return null
    const timestamp=value<10_000_000_000?value*1000:value
    return timestamp>0&&timestamp<=Date.now()+5000?timestamp:null
  }
  private piRecord(session:ManagedSession,value:Record<string,unknown>):void{
    if(value.type==='response'){
      const key=typeof value.id==='number'?value.id:null,pending=key===null?undefined:session.pending.get(key)
      if(key!==null)session.pending.delete(key)
      if(pending==='initialize'){
        const data=value.data as {sessionId?:unknown}|undefined
        if(value.success!==true||typeof data?.sessionId!=='string')return this.fail(session,'Pi RPC handshake failed.')
        this.update(session,{providerSessionId:data.sessionId,status:'idle'})
      }else if(pending==='health'){
        const data=value.data as {sessionId?:unknown;isStreaming?:unknown}|undefined
        if(value.success!==true||data?.sessionId!==session.view.providerSessionId)this.update(session,{status:'unknown',error:'Pi session state is unavailable.'})
        else if(data.isStreaming===true)this.update(session,{status:'running',turnStartedAt:session.view.turnStartedAt,lastTurnOutcome:null,error:null})
        else this.idle(session,session.piTurnOutcome??session.view.lastTurnOutcome)
      }else if(pending?.startsWith('delivery:')){
        const delivery=this.delivery(session,pending.slice(9));if(delivery){delivery.status=value.success===true?'sent':'failed';delivery.error=value.success===true?null:'Pi rejected the message.';this.touch(session)}
      }
    }
    if(value.type==='agent_start'){session.piTurnOutcome=undefined;this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})}
    if(value.type==='turn_end'){
      const message=value.message as {stopReason?:unknown}|undefined
      session.piTurnOutcome=message?.stopReason==='error'?'failed':message?.stopReason==='aborted'?'interrupted':'completed'
    }
    if(value.type==='agent_settled')this.idle(session,session.piTurnOutcome??'completed')
    if(value.type==='extension_ui_request'&&['select','confirm','input','editor'].includes(String(value.method)))this.update(session,{status:'waiting'})
  }
  private claudeRecord(session:ManagedSession,value:Record<string,unknown>):void{
    if(value.type==='system'&&value.subtype==='init'){
      if(value.session_id!==session.view.providerSessionId)return this.fail(session,'Claude returned a different session identity.')
      if(session.view.status==='starting'||session.view.status==='unknown')this.update(session,{status:'idle',error:null})
    }
    if(value.type==='user'){
      const delivery=session.view.deliveries.find(item=>item.status==='sending');if(delivery){delivery.status='sent';this.touch(session)}
    }
    if(value.type==='assistant'&&session.view.status!=='running')this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})
    if(value.type==='result')this.idle(session,value.subtype==='success'&&value.is_error!==true?'completed':value.subtype==='interrupted'?'interrupted':'failed')
    if(value.type==='control_request')this.update(session,{status:'waiting'})
  }
  private async startOpenCode(session:ManagedSession):Promise<void>{
    const generation=session.generation
    try{
      const deadline=Date.now()+10_000
      while(Date.now()<deadline){
        if(session.stopping||generation!==session.generation)return
        try{const health=await this.request(session,'/global/health');if((health as {healthy?:unknown}).healthy===true)break}catch{/* Server is still starting. */}
        await new Promise(resolveWait=>setTimeout(resolveWait,100))
      }
      if(session.stopping||generation!==session.generation)return
      const created=await this.request(session,'/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:`Localino · ${session.view.projectName}`})}) as {id?:unknown}
      if(session.stopping||generation!==session.generation)return
      if(typeof created.id!=='string')throw Error()
      this.update(session,{providerSessionId:created.id,status:'idle'})
      session.poll=setInterval(()=>void this.pollOpenCode(session),2000);session.poll.unref()
    }catch{if(!session.stopping&&generation===session.generation){this.fail(session,'OpenCode server handshake failed.');session.child.kill()}}
  }
  private async pollOpenCode(session:ManagedSession,reconcile=false):Promise<void>{
    if(session.stopping||!session.view.providerSessionId)return
    const generation=session.generation
    if(session.pollingGeneration===generation)return
    session.pollingGeneration=generation
    try{
      const statuses=await this.request(session,'/session/status') as Record<string,{type?:unknown}>
      if(session.stopping||generation!==session.generation||session.view.status==='stopped'||session.view.status==='stopping')return
      session.lastContactAt=Date.now()
      const type=statuses[session.view.providerSessionId]?.type
      if(type==='busy'||type==='retry'){if(session.view.status!=='running')this.update(session,{status:'running',turnStartedAt:reconcile?null:Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})}
      else if(type==='idle'||type===undefined)this.idle(session,session.view.lastTurnOutcome)
      if(reconcile&&!session.poll&&!session.stopping&&generation===session.generation){session.poll=setInterval(()=>void this.pollOpenCode(session),2000);session.poll.unref()}
    }catch{if(!session.stopping&&generation===session.generation)this.update(session,{status:'unknown',error:'OpenCode status is unavailable.'})}
    finally{if(session.pollingGeneration===generation)session.pollingGeneration=undefined}
  }
  private async dispatch(session:ManagedSession,delivery:SessionDelivery):Promise<void>{
    try{
      if(session.view.agent==='codex'){
        const id=++session.requestSequence;session.pending.set(id,`delivery:${delivery.id}`);this.write(session,{id,method:'turn/start',params:{threadId:session.view.providerSessionId,input:[{type:'text',text:delivery.text}]}})
      }else if(session.view.agent==='pi'){
        const id=++session.requestSequence;session.pending.set(id,`delivery:${delivery.id}`);this.write(session,{id,type:'prompt',message:delivery.text})
      }else if(session.view.agent==='claude'){
        this.write(session,{type:'user',message:{role:'user',content:[{type:'text',text:delivery.text}]},parent_tool_use_id:null,session_id:session.view.providerSessionId??''})
        delivery.status='sent';this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null})
      }else{
        const provider=session.view.providerSessionId;if(!provider)throw Error()
        await this.request(session,`/session/${encodeURIComponent(provider)}/prompt_async`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageID:delivery.id,parts:[{type:'text',text:delivery.text}]}),expectNoContent:true})
        delivery.status='sent';this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null})
      }
    }catch{delivery.status='unknown';delivery.error='Delivery outcome is unknown.';this.update(session,{status:'unknown',error:'Connection to the agent was lost.'})}
  }
  private idle(session:ManagedSession,outcome:LiveSession['lastTurnOutcome']='completed'):void{
    this.update(session,{status:'idle',turnStartedAt:null,lastTurnOutcome:outcome,error:outcome==='failed'?'The last agent turn failed.':null})
    const queued=session.view.deliveries.find(item=>item.status==='queued')
    if(queued){queued.status='sending';this.touch(session);void this.dispatch(session,queued)}
  }
  private armHealth(session:ManagedSession):void{
    if(session.health||session.stopping)return
    session.health=setInterval(()=>{
      if(session.stopping||['starting','stopped','stopping','error'].includes(session.view.status))return
      if(session.child.exitCode!==null||session.child.stdin.destroyed||!session.child.stdin.writable){this.update(session,{status:'unknown',error:'Agent process is unreachable.'});return}
      if(session.view.agent==='claude'&&(session.view.status==='running'||session.view.status==='waiting')&&Date.now()-session.lastContactAt>=15_000){this.update(session,{status:'unknown',error:'Claude stream is not responding.'});return}
      if((session.view.agent==='codex'||session.view.agent==='pi')&&Date.now()-session.lastContactAt>=10_000&&!session.deadline)this.sendHealthCheck(session,false)
    },5000);session.health.unref()
  }
  private sendHealthCheck(session:ManagedSession,reconcile:boolean):void{
    if(session.stopping||session.deadline)return
    try{
      const id=++session.requestSequence;session.pending.set(id,'health')
      if(session.view.agent==='codex'){
        if(!session.view.providerSessionId)throw Error()
        this.write(session,{id,method:'thread/read',params:{threadId:session.view.providerSessionId,includeTurns:false}})
      }else this.write(session,{id,type:'get_state'})
      const generation=session.generation
      session.deadline=setTimeout(()=>{
        session.deadline=undefined
        if(session.stopping||generation!==session.generation)return
        this.update(session,{status:'unknown',error:reconcile?'Session could not be reconciled after resume.':'Agent protocol is not responding.'})
      },reconcile?15_000:Math.max(1000,15_000-(Date.now()-session.lastContactAt)));session.deadline.unref()
    }catch{this.update(session,{status:'unknown',error:'Agent protocol is not responding.'})}
  }
  private clearTimers(session:ManagedSession):void{
    if(session.poll){clearInterval(session.poll);session.poll=undefined}
    if(session.health){clearInterval(session.health);session.health=undefined}
    if(session.deadline){clearTimeout(session.deadline);session.deadline=undefined}
  }
  private request(session:ManagedSession,path:string,init:RequestInit&{expectNoContent?:boolean}={}):Promise<unknown>{
    if(!session.endpoint||!session.authorization)return Promise.reject(Error())
    const {expectNoContent,...request}=init
    return fetch(`${session.endpoint}${path}`,{...request,headers:{authorization:session.authorization,...request.headers},signal:AbortSignal.timeout(5000)}).then(async response=>{
      if(!response.ok)throw Error()
      if(expectNoContent||response.status===204)return null
      return response.json()
    })
  }
  private write(session:ManagedSession,value:unknown):void{
    if(!session.child.stdin.writable)throw Error('Agent input is closed.')
    session.child.stdin.write(`${JSON.stringify(value)}\n`)
  }
  private delivery(session:ManagedSession,id:string):SessionDelivery|undefined{return session.view.deliveries.find(item=>item.id===id)}
  private fail(session:ManagedSession,error:string):void{this.update(session,{status:'error',turnStartedAt:null,error})}
  private touch(session:ManagedSession):void{session.view.updatedAt=Date.now();this.changed()}
  private update(session:ManagedSession,change:Partial<Pick<LiveSession,'providerSessionId'|'status'|'turnStartedAt'|'turnElapsedMs'|'lastTurnOutcome'|'error'>>):void{
    const active=session.view.status==='running'||session.view.status==='waiting',next=change.status??session.view.status
    if(active&&next!=='running'&&next!=='waiting'&&session.view.turnStartedAt!==null&&change.turnElapsedMs===undefined)session.view.turnElapsedMs=Math.max(0,Date.now()-session.view.turnStartedAt)
    if(session.view.status==='starting'&&next!=='starting'&&session.deadline){clearTimeout(session.deadline);session.deadline=undefined}
    Object.assign(session.view,change,{updatedAt:Date.now()});this.changed()
  }
  private changed():void{this.emit('change',this.state)}
}
