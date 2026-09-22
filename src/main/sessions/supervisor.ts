import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { agentIds, type AgentId } from '../../shared/agents'
import { initialLiveSessions, sessionProtocols, type LiveSession, type LiveSessionsState, type SessionCapability, type SessionDelivery, type SessionInteraction, type SessionInteractionQuestion, type SessionInteractionResponse, type SessionResult } from '../../shared/sessions'
import { terminalText } from '../../shared/terminal'
import { SessionRecoveryStore } from './recovery'
import type { TranscriptClient } from './transcript-client'
import { array, CodexTranscript, ProviderTranscript, object, string } from './provider-transcript'
import { ClaudeTranscript } from './claude-transcript'
import { PiTranscript } from './pi-transcript'
import { OpenCodeTranscript } from './opencode-transcript'
import { TranscriptPump } from './transcript-pump'
import { boundedJson, readProviderEvents } from './provider-http'

type SpawnAgent = (command:string,args:string[],options:SpawnOptionsWithoutStdio)=>ChildProcessWithoutNullStreams
type ResolveAgent = (agent:AgentId)=>Promise<{path:string;version:string|null}|null>

interface ManagedSession {
  output:ProviderTranscript
  pump:TranscriptPump
  stream?:AbortController
  streamTask?:Promise<void>
  lastPiRunTimestamp:number
  view: LiveSession
  child: ChildProcessWithoutNullStreams
  buffer: JsonlBuffer
  requestSequence: number
  pending: Map<number,string>
  interactions: Map<string,ProviderInteraction>
  endpoint?: string
  authorization?: string
  poll?: NodeJS.Timeout
  health?: NodeJS.Timeout
  deadline?: NodeJS.Timeout
  deliveryDeadlines: Map<string,NodeJS.Timeout>
  lastContactAt: number
  generation: number
  pollingGeneration?: number
  resumeStatus?: LiveSession['status']
  piTurnOutcome?: LiveSession['lastTurnOutcome']
  awaitingPiDelivery?: string
  activePiRun?: string
  completedPiRuns: Set<string>
  piCanSettle: boolean
  activeClaudeMessage?: string
  completedClaudeMessages: Set<string>
  completedClaudeResults: Set<string>
  activeCodexTurn?: string
  completedCodexTurns: Set<string>
  stopping: boolean
}

type InteractionProviderKind = 'codex-approval'|'codex-input'|'claude-approval'|'pi-confirm'|'pi-value'|'opencode-permission'|'opencode-permission-v2'|'opencode-question'
interface ProviderInteraction {
  view: SessionInteraction
  providerKind: InteractionProviderKind|'unsupported'
  providerRequestId: string|number
  providerSessionId: string|null
  providerKey: string
  timer?: NodeJS.Timeout
}

interface InteractionDraft {
  providerKind: ProviderInteraction['providerKind']
  providerRequestId: string|number
  providerKey: string
  kind: SessionInteraction['kind']
  title: string
  detail?: string
  target?: string
  questions?: SessionInteractionQuestion[]
  cancelable?: boolean
  timeout?: number
}

const executableNames:Record<AgentId,string>={codex:'codex',claude:'claude',pi:'pi',opencode:'opencode'}

export class JsonlBuffer {
  private readonly decoder=new TextDecoder('utf-8',{fatal:true})
  private pending=''
  constructor(private readonly maxBytes=2*1024*1024){}
  push(chunk:Buffer|string,onLine:(line:string)=>void):void {
    this.pending+=typeof chunk==='string'?chunk:this.decoder.decode(chunk,{stream:true})
    for(let index=this.pending.indexOf('\n');index>=0;index=this.pending.indexOf('\n')){
      let line=this.pending.slice(0,index);this.pending=this.pending.slice(index+1)
      if(Buffer.byteLength(line)>this.maxBytes)throw Error('Provider event exceeds 2 MiB.')
      if(line.endsWith('\r'))line=line.slice(0,-1)
      if(line)onLine(line)
    }
    if(Buffer.byteLength(this.pending)>this.maxBytes)throw Error('Provider event exceeds 2 MiB.')
  }
  end(onLine:(line:string)=>void):void {
    this.pending+=this.decoder.decode()
    let line=this.pending;this.pending=''
    if(Buffer.byteLength(line)>this.maxBytes)throw Error('Provider event exceeds 2 MiB.')
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

function displayText(value:unknown,fallback='Unavailable',limit=4000):string {
  const text=typeof value==='string'&&value.trim()?terminalText(value.trim()):fallback
  return text.length<=limit?text:`${text.slice(0,limit-1)}…`
}

function questionId(value:unknown,fallback:string):string {
  return typeof value==='string'&&/^[\w-]{1,128}$/.test(value)?value:fallback
}

function questionOptions(value:unknown):SessionInteractionQuestion['options'] {
  return array(value).slice(0,32).flatMap(entry=>{
    if(typeof entry==='string')return [{label:displayText(entry,'Option',200),description:''}]
    const option=object(entry),label=string(option?.label)
    return label?[{label:displayText(label,'Option',200),description:displayText(option?.description,'',500)}]:[]
  })
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
  if(agent==='claude')return ['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--replay-user-messages','--include-hook-events','--permission-mode','manual','--session-id',providerSessionId!]
  if(agent==='pi')return ['--mode','rpc','--no-approve','--session-id',randomUUID()]
  return []
}

async function freePort():Promise<number>{
  return new Promise((resolvePort,reject)=>{const server=createServer();server.unref();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();const port=typeof address==='object'&&address?address.port:0;server.close(error=>error?reject(error):resolvePort(port))})})
}

const copyState=(capabilities:Record<AgentId,SessionCapability>,sessions:Map<string,ManagedSession>,recovery:SessionRecoveryStore):LiveSessionsState=>({
  capabilities:Object.fromEntries(agentIds.map(id=>[id,{...capabilities[id]}])) as Record<AgentId,SessionCapability>,
  sessions:[...sessions.values()].map(item=>({...item.view,deliveries:item.view.deliveries.map(delivery=>({...delivery})),interactions:item.view.interactions.map(interaction=>({...interaction,questions:interaction.questions.map(question=>({...question,options:question.options.map(option=>({...option}))}))}))})).sort((a,b)=>a.createdAt-b.createdAt),
  recovered:recovery.state.filter(item=>!sessions.has(item.id)),
  persistenceError:recovery.error,
})

export class SessionSupervisor extends EventEmitter {
  private readonly capabilities=initialLiveSessions().capabilities
  private readonly binaries=new Map<AgentId,string>()
  private readonly sessions=new Map<string,ManagedSession>()
  private disposed=false
  constructor(private readonly spawnProcess:SpawnAgent=spawnAgent,private readonly resolver:ResolveAgent=resolveAgentBinary,private readonly recovery=new SessionRecoveryStore(),private readonly transcripts?:Pick<TranscriptClient,'create'|'append'>){super()}
  get state():LiveSessionsState{return copyState(this.capabilities,this.sessions,this.recovery)}
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
    const view:LiveSession={id,agent,protocol:sessionProtocols[agent],projectPath:directory,projectName:basename(directory)||directory,providerSessionId,status:'starting',createdAt:now,turnStartedAt:null,turnElapsedMs:null,lastTurnOutcome:null,updatedAt:now,error:null,deliveries:[],interactions:[],draft:''}
    try{
      await this.transcripts?.create({sessionId:id,provider:agent,projectPath:directory,projectName:view.projectName})
      if(this.disposed)return {ok:false,error:'Session supervisor is shutting down.'}
      const port=agent==='opencode'?await freePort():null
      const password=agent==='opencode'?randomBytes(24).toString('base64url'):null
      const args=agent==='opencode'?['serve','--hostname','127.0.0.1','--port',String(port)]:commandFor(agent,providerSessionId??undefined)
      const env=agent==='opencode'?{...process.env,OPENCODE_SERVER_USERNAME:'localino',OPENCODE_SERVER_PASSWORD:password!}:process.env
      const child=this.spawnProcess(binary,args,{cwd:directory,env,stdio:['pipe','pipe','pipe']})
      const pump=new TranscriptPump(this.transcripts,message=>this.outputFailure(managed,message))
      const Adapter={codex:CodexTranscript,claude:ClaudeTranscript,pi:PiTranscript,opencode:OpenCodeTranscript}[agent]
      const output=new Adapter(id,agent,events=>pump.push(events))
      const managed:ManagedSession={view,child,output,pump,lastPiRunTimestamp:-1,buffer:new JsonlBuffer(),requestSequence:0,pending:new Map(),interactions:new Map(),deliveryDeadlines:new Map(),lastContactAt:now,generation:0,completedPiRuns:new Set(),piCanSettle:false,completedClaudeMessages:new Set(),completedClaudeResults:new Set(),completedCodexTurns:new Set(),stopping:false,...(port&&password?{endpoint:`http://127.0.0.1:${port}`,authorization:`Basic ${Buffer.from(`localino:${password}`).toString('base64')}`}:{})}
      this.sessions.set(id,managed);this.attach(managed);this.changed()
      return {ok:true,sessionId:id}
    }catch{return {ok:false,error:'Could not start the agent process.'}}
  }
  async stop(id:string):Promise<SessionResult>{
    const session=this.sessions.get(id);if(!session)return {ok:false,error:'Session not found.'}
    if(session.view.status==='stopped')return {ok:true,sessionId:id}
    const wasRunning=session.view.status==='running'||session.view.status==='waiting'
    session.stopping=true;session.generation++;this.expireInteractions(session,'Session stopped.');this.clearTimers(session);this.update(session,{status:'stopping',error:null})
    session.stream?.abort();session.output.terminate('Session stopped by user.','interrupted')
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
    const hasPending=session.view.deliveries.some(item=>item.status==='sending')
    const delivery:SessionDelivery={id:randomUUID(),text,createdAt:Date.now(),status:!hasPending&&(session.view.status==='idle'||session.view.status==='ready')?'sending':'queued',error:null}
    const draft=session.view.draft
    session.view.deliveries=[...session.view.deliveries,delivery];session.view.draft='';session.view.updatedAt=Date.now()
    if(!this.persist(session)){session.view.deliveries=session.view.deliveries.filter(item=>item.id!==delivery.id);session.view.draft=draft;this.changed();return {ok:false,error:this.recovery.error??'Could not save the message safely.'}}
    this.changed()
    if(delivery.status==='sending')void this.dispatch(session,delivery)
    return {ok:true,sessionId:delivery.id}
  }
  setDraft(id:string,text:string):SessionResult{
    const session=this.sessions.get(id);if(!session)return {ok:false,error:'Session not found.'}
    if(text.length>100_000)return {ok:false,error:'Draft is too large.'}
    session.view.draft=text;session.view.updatedAt=Date.now();const saved=this.persist(session);this.changed()
    return saved?{ok:true,sessionId:id}:{ok:false,error:this.recovery.error??'Could not save the draft.'}
  }
  discardRecovered(id:string):SessionResult{
    if(!this.recovery.state.some(item=>item.id===id))return {ok:false,error:'Recovered session not found.'}
    const saved=this.recovery.discard(id);this.changed();return saved?{ok:true,sessionId:id}:{ok:false,error:this.recovery.error??'Could not discard recovered text.'}
  }
  cancel(sessionId:string,deliveryId:string):SessionResult{
    const session=this.sessions.get(sessionId);if(!session)return {ok:false,error:'Session not found.'}
    const delivery=session.view.deliveries.find(item=>item.id===deliveryId)
    if(!delivery||delivery.status!=='queued')return {ok:false,error:'Only queued messages can be cancelled.'}
    delivery.status='cancelled';session.view.updatedAt=Date.now();const saved=this.persist(session);this.changed();return saved?{ok:true,sessionId:deliveryId}:{ok:false,error:this.recovery.error??'Could not save the cancellation.'}
  }
  async respond(value:SessionInteractionResponse):Promise<SessionResult>{
    const session=this.sessions.get(value.sessionId)
    if(!session)return {ok:false,error:'Session not found.'}
    const pending=session.interactions.get(value.interactionId),view=pending?.view
    if(!pending||!view||view.status!=='pending')return {ok:false,error:'Request expired.'}
    if(session.stopping||session.view.status==='stopped'||pending.providerSessionId!==session.view.providerSessionId)return this.staleInteraction(session,pending,'Request expired.')
    if(view.kind==='unsupported'||pending.providerKind==='unsupported')return {ok:false,error:'This request is unsupported in Localino.'}
    if(view.kind==='approval'&&!['approve','deny'].includes(value.action))return {ok:false,error:'Invalid decision.'}
    if(view.kind==='input'&&!['submit','cancel'].includes(value.action))return {ok:false,error:'Invalid response.'}
    if(value.action==='cancel'&&!view.cancelable)return {ok:false,error:'This request cannot be cancelled safely.'}
    let ordered:string[][]=[]
    if(value.action==='submit'){
      const answers=value.answers??{}
      if(Object.keys(answers).some(id=>!view.questions.some(question=>question.id===id)))return {ok:false,error:'Invalid answer.'}
      ordered=view.questions.map(question=>answers[question.id]??[])
      for(let index=0;index<view.questions.length;index++){
        const question=view.questions[index],answer=ordered[index]
        if(!answer.length||(!question.multiple&&answer.length!==1))return {ok:false,error:'Answer every question.'}
        if(!question.allowOther&&question.options.length&&answer.some(item=>!question.options.some(option=>option.label===item)))return {ok:false,error:'Choose a listed option.'}
      }
    }
    view.status='submitting';view.error=null;this.touch(session)
    try{
      const approve=value.action==='approve',deny=value.action==='deny',cancel=value.action==='cancel'
      if(pending.providerKind==='codex-approval')this.write(session,{id:pending.providerRequestId,result:{decision:approve?'accept':'decline'}})
      else if(pending.providerKind==='codex-input')this.write(session,{id:pending.providerRequestId,result:{answers:Object.fromEntries(view.questions.map((question,index)=>[question.id,{answers:ordered[index]}]))}})
      else if(pending.providerKind==='claude-approval')this.write(session,{type:'control_response',response:{subtype:'success',request_id:pending.providerRequestId,response:approve?{behavior:'allow'}:{behavior:'deny',message:'Denied in Localino.'}}})
      else if(pending.providerKind==='pi-confirm')this.write(session,{type:'extension_ui_response',id:pending.providerRequestId,...(cancel?{cancelled:true}:{confirmed:approve})})
      else if(pending.providerKind==='pi-value')this.write(session,{type:'extension_ui_response',id:pending.providerRequestId,...(cancel?{cancelled:true}:{value:ordered[0][0]})})
      else if(pending.providerKind==='opencode-permission'||pending.providerKind==='opencode-permission-v2'){
        const path=pending.providerKind==='opencode-permission'?`/session/${encodeURIComponent(session.view.providerSessionId!)}/permissions/${encodeURIComponent(String(pending.providerRequestId))}`:`/permission/${encodeURIComponent(String(pending.providerRequestId))}/reply`
        const body=pending.providerKind==='opencode-permission'?{response:approve?'once':'reject'}:{reply:approve?'once':'reject'}
        await this.request(session,path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
      }else if(pending.providerKind==='opencode-question'){
        const path=`/question/${encodeURIComponent(String(pending.providerRequestId))}/${cancel?'reject':'reply'}`
        await this.request(session,path,{method:'POST',...(cancel?{}:{headers:{'content-type':'application/json'},body:JSON.stringify({answers:ordered})})})
      }
      if(view.status!=='submitting')return {ok:false,error:'Request expired.'}
      this.finishInteraction(session,pending,cancel?'cancelled':approve?'approved':deny?'denied':'submitted')
      return {ok:true,sessionId:view.id}
    }catch{
      if(view.status==='submitting'){view.status='failed';view.error='Response outcome is unknown. It was not retried.';this.touch(session)}
      return {ok:false,error:view.error??'Request expired.'}
    }
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
    await Promise.all([...this.sessions.values()].map(session=>session.pump.flush()))
  }
  private attach(session:ManagedSession):void{
    session.deadline=setTimeout(()=>{
      if(session.view.status!=='starting'||session.stopping)return
      this.update(session,{status:'unknown',error:'Agent protocol did not respond within 15 seconds.'})
      session.child.kill()
    },15_000);session.deadline.unref()
    session.child.stdout.on('data',chunk=>{if(session.view.agent==='opencode')return;try{session.buffer.push(chunk,line=>this.record(session,line))}catch{this.outputFailure(session,'Invalid or oversized provider stream. The session was stopped; output may be incomplete.')}})
    session.child.stdout.on('end',()=>{if(session.view.agent==='opencode')return;try{session.buffer.end(line=>this.record(session,line))}catch{this.outputFailure(session,'Provider stream ended with an invalid record. Output may be incomplete.')}})
    session.child.stderr.on('data',()=>{/* Provider stderr can contain prompts, paths or credentials and is never surfaced. */})
    session.child.once('error',()=>this.fail(session,'Agent process could not be started.'))
    session.child.once('exit',code=>{
      session.stream?.abort()
      if(!session.stopping&&(session.view.status==='running'||session.view.status==='waiting'))session.output.terminate('Provider process ended before the turn completed.')
      session.generation++;this.clearTimers(session)
      for(const delivery of session.view.deliveries){if(delivery.status==='sending'){delivery.status='unknown';delivery.error='Delivery outcome is unknown.'}else if(delivery.status==='queued')delivery.status='suspended'}
      this.persist(session)
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
    const value=object(JSON.parse(line));if(!value)throw Error('Invalid provider record.')
    session.lastContactAt=Date.now();if(session.view.status!=='starting'&&session.deadline){clearTimeout(session.deadline);session.deadline=undefined}
    const terminal=value.method==='turn/completed'||value.type==='result'||value.type==='agent_settled'
    const acceptedTerminal=value.type!=='agent_settled'||Boolean(session.activePiRun&&session.piCanSettle)
    if(terminal&&acceptedTerminal)this.outputRecord(session,value)
    if(session.stopping)return
    if(session.view.agent==='codex')this.codexRecord(session,value)
    else if(session.view.agent==='pi')this.piRecord(session,value)
    else if(session.view.agent==='claude')this.claudeRecord(session,value)
    if(terminal&&acceptedTerminal)this.expireInteractions(session,'The turn ended before a response was sent.')
    if(!terminal&&!session.stopping)this.outputRecord(session,value)
  }
  private outputRecord(session:ManagedSession,value:Record<string,unknown>):void {
    session.output.ingest(value,{providerSessionId:session.view.providerSessionId,turnId:session.view.agent==='codex'?session.activeCodexTurn:session.view.agent==='pi'?session.activePiRun:undefined})
  }
  private outputFailure(session:ManagedSession,message:string):void {
    if(session.stopping&&session.view.status==='error')return
    session.output.terminate(message);session.stopping=true;session.generation++;this.clearTimers(session);session.stream?.abort()
    this.update(session,{status:'error',turnStartedAt:null,error:message});session.child.kill()
  }
  private codexRecord(session:ManagedSession,value:Record<string,unknown>):void{
    if(typeof value.id==='number'&&value.method===undefined){
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
        const delivery=this.delivery(session,pending.slice(9));if(value.error&&delivery){this.confirmDelivery(session,delivery,false,'Codex rejected the message.');this.update(session,{status:'idle',turnStartedAt:null})}
        else if(delivery){const result=value.result as {turn?:{id?:unknown}}|undefined;if(typeof result?.turn?.id==='string')session.activeCodexTurn=result.turn.id;this.confirmDelivery(session,delivery,true)}
      }
    }
    const params=value.params as Record<string,unknown>|undefined
    if(value.method==='turn/started'){
      const turn=params?.turn as {id?:unknown}|undefined,id=turn?.id
      if(params?.threadId!==session.view.providerSessionId||typeof id!=='string'||session.completedCodexTurns.has(id)||session.activeCodexTurn&&session.activeCodexTurn!==id)return
      session.activeCodexTurn=id;this.confirmSendingFromLifecycle(session);this.update(session,{status:'running',turnStartedAt:this.codexStartedAt(params),turnElapsedMs:null,lastTurnOutcome:null,error:null})
    }
    if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput','item/permissions/requestApproval'].includes(String(value.method)))this.codexInteraction(session,value)
    if(value.method==='serverRequest/resolved'){
      const requestId=object(value.params)?.requestId
      if(typeof requestId==='string'||typeof requestId==='number')this.providerResolved(session,`codex:${requestId}`)
    }
    if(value.method==='turn/completed'){
      const turn=params?.turn as {id?:unknown;status?:unknown}|undefined,id=turn?.id,status=turn?.status
      if(params?.threadId!==session.view.providerSessionId||typeof id!=='string'||session.activeCodexTurn!==id||session.completedCodexTurns.has(id))return
      session.completedCodexTurns.add(id);if(session.completedCodexTurns.size>32)session.completedCodexTurns.delete(session.completedCodexTurns.values().next().value!);session.activeCodexTurn=undefined;this.confirmSendingFromLifecycle(session)
      this.idle(session,status==='failed'?'failed':status==='interrupted'?'interrupted':'completed')
    }
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
        const delivery=this.delivery(session,pending.slice(9));if(delivery){this.confirmDelivery(session,delivery,value.success===true,value.success===true?undefined:'Pi rejected the message.');if(value.success!==true&&session.awaitingPiDelivery===delivery.id)session.awaitingPiDelivery=undefined}
      }
    }
    if(value.type==='agent_start')this.update(session,{status:'running',turnStartedAt:session.view.turnStartedAt??Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})
    if(value.type==='message_start'){
      const message=value.message as {role?:unknown;content?:unknown;timestamp?:unknown}|undefined,delivery=session.awaitingPiDelivery?this.delivery(session,session.awaitingPiDelivery):undefined
      const content=typeof message?.content==='string'?message.content:Array.isArray(message?.content)?message.content.filter((item):item is {type:'text';text:string}=>Boolean(item)&&typeof item==='object'&&(item as {type?:unknown}).type==='text'&&typeof (item as {text?:unknown}).text==='string').map(item=>item.text).join(''):''
      const key=typeof message?.timestamp==='number'&&Number.isFinite(message.timestamp)?String(message.timestamp):null
      if(message?.role==='user'&&delivery?.status==='sent'&&content===delivery.text&&key&&!session.completedPiRuns.has(key)){
        if(Number(key)<=session.lastPiRunTimestamp){session.output.markGap('Pi reused a previous run timestamp. The current turn could not be identified.');this.update(session,{status:'unknown',error:'Pi run identity is ambiguous.'});return}
        session.lastPiRunTimestamp=Number(key);session.activePiRun=key;session.awaitingPiDelivery=undefined;session.piCanSettle=false
      }
    }
    if(value.type==='turn_start'&&session.activePiRun){
      session.piCanSettle=false;session.piTurnOutcome=undefined;this.update(session,{status:'running',turnStartedAt:session.view.turnStartedAt??Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})
    }
    if(value.type==='turn_end'&&session.activePiRun){
      const message=value.message as {stopReason?:unknown}|undefined
      session.piCanSettle=true;session.piTurnOutcome=message?.stopReason==='error'?'failed':message?.stopReason==='aborted'?'interrupted':'completed'
    }
    if(value.type==='agent_settled'&&session.activePiRun&&session.piCanSettle){session.completedPiRuns.add(session.activePiRun);if(session.completedPiRuns.size>32)session.completedPiRuns.delete(session.completedPiRuns.values().next().value!);session.activePiRun=undefined;session.piCanSettle=false;this.idle(session,session.piTurnOutcome??'completed')}
    if(value.type==='extension_ui_request'&&['select','confirm','input','editor'].includes(String(value.method)))this.piInteraction(session,value)
  }
  private claudeRecord(session:ManagedSession,value:Record<string,unknown>):void{
    if(value.type==='system'&&value.subtype==='init'){
      if(value.session_id!==session.view.providerSessionId)return this.fail(session,'Claude returned a different session identity.')
      if(session.view.status==='starting'||session.view.status==='unknown')this.update(session,{status:'idle',error:null})
    }
    if(!['system','control_request','control_cancel_request'].includes(String(value.type))&&value.session_id!==session.view.providerSessionId)return
    if(value.type==='user'&&value.session_id===session.view.providerSessionId){
      const delivery=session.view.deliveries.find(item=>item.status==='sending'),message=value.message as {content?:unknown}|undefined
      const content=Array.isArray(message?.content)?message.content:[],text=content.filter((item):item is {type:'text';text:string}=>Boolean(item)&&typeof item==='object'&&(item as {type?:unknown}).type==='text'&&typeof (item as {text?:unknown}).text==='string').map(item=>item.text).join('')
      if(delivery&&text===delivery.text)this.confirmDelivery(session,delivery,true)
    }
    if(value.type==='assistant'){
      const message=value.message as {id?:unknown}|undefined,id=message?.id;if(typeof id!=='string'||session.completedClaudeMessages.has(id))return
      session.activeClaudeMessage=id;if(session.view.status!=='running')this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})
    }
    if(value.type==='result'){
      const id=value.uuid;if(typeof id!=='string'||session.completedClaudeResults.has(id)||!session.activeClaudeMessage)return
      session.completedClaudeResults.add(id);session.completedClaudeMessages.add(session.activeClaudeMessage);if(session.completedClaudeResults.size>32)session.completedClaudeResults.delete(session.completedClaudeResults.values().next().value!);if(session.completedClaudeMessages.size>32)session.completedClaudeMessages.delete(session.completedClaudeMessages.values().next().value!);session.activeClaudeMessage=undefined
      this.idle(session,value.subtype==='success'&&value.is_error!==true?'completed':value.subtype==='interrupted'?'interrupted':'failed')
    }
    if(value.type==='control_request')this.claudeInteraction(session,value)
    if(value.type==='control_cancel_request'){
      const requestId=value.request_id;if(typeof requestId==='string')this.providerResolved(session,`claude:${requestId}`)
    }
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
      session.stream=new AbortController()
      session.streamTask=this.streamOpenCode(session)
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
      else if((type==='idle'||type===undefined)&&(!session.view.deliveries.length||(session.output as OpenCodeTranscript).settled))this.idle(session,(session.output as OpenCodeTranscript).outcome)
      if(reconcile&&!session.poll&&!session.stopping&&generation===session.generation){session.poll=setInterval(()=>void this.pollOpenCode(session),2000);session.poll.unref()}
    }catch{if(!session.stopping&&generation===session.generation)this.update(session,{status:'unknown',error:'OpenCode status is unavailable.'})}
    finally{if(session.pollingGeneration===generation)session.pollingGeneration=undefined}
  }
  private async streamOpenCode(session:ManagedSession):Promise<void>{
    const signal=session.stream!.signal,output=session.output as OpenCodeTranscript
    let reconnect=false
    while(!signal.aborted&&!session.stopping){
      let response:Response|undefined
      try{
        response=await fetch(`${session.endpoint}/event`,{headers:{authorization:session.authorization!},signal})
        if(reconnect){
          const messages=await this.request(session,`/session/${encodeURIComponent(session.view.providerSessionId!)}/message?limit=100`)
          if(!Array.isArray(messages))throw Error('Invalid recovery page.')
          output.reconcile(messages,{providerSessionId:session.view.providerSessionId})
          const statuses=object(await this.request(session,'/session/status'))
          if(!statuses)throw Error('Invalid recovery status.')
          const status=object(statuses[session.view.providerSessionId!])?.type
          if(status===undefined||status==='idle'){
            output.recoveredIdle()
            if(!signal.aborted&&!session.stopping)this.idle(session,output.outcome)
          }
        }
        await readProviderEvents(response,event=>{
          if(signal.aborted||session.stopping)return
          session.lastContactAt=Date.now();this.openCodeInteraction(session,event);this.outputRecord(session,event)
          if(output.settled)this.idle(session,output.outcome)
        })
        if(!signal.aborted)throw Error('Event stream ended.')
      }catch{
        if(signal.aborted||session.stopping)return
        output.disconnected();this.update(session,{status:'unknown',error:'OpenCode output disconnected. Recovering from the same owned server.'});reconnect=true
        await new Promise<void>(resolveWait=>{const done=():void=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolveWait()},timer=setTimeout(done,500);signal.addEventListener('abort',done,{once:true})})
      }finally{await response?.body?.cancel().catch(()=>{})}
    }
  }
  private addInteraction(session:ManagedSession,draft:InteractionDraft):void {
    if([...session.interactions.values()].some(item=>item.providerKey===draft.providerKey))return
    const id=randomUUID(),view:SessionInteraction={id,kind:draft.kind,status:draft.providerKind==='unsupported'?'unsupported':'pending',title:displayText(draft.title,'Action required',200),detail:displayText(draft.detail,'Review this request before continuing.'),target:displayText(draft.target,session.view.projectPath),createdAt:Date.now(),questions:draft.questions??[],cancelable:draft.cancelable===true,resolution:null,error:draft.providerKind==='unsupported'?'Action required — unsupported in Localino':null}
    const pending:ProviderInteraction={view,providerKind:draft.providerKind,providerRequestId:draft.providerRequestId,providerSessionId:session.view.providerSessionId,providerKey:draft.providerKey}
    session.interactions.set(id,pending);session.view.interactions.push(view)
    while(session.view.interactions.length>20){
      const removable=session.view.interactions.findIndex(item=>!['pending','submitting','unsupported'].includes(item.status));if(removable<0)break
      const [removed]=session.view.interactions.splice(removable,1);const stored=session.interactions.get(removed.id);if(stored?.timer)clearTimeout(stored.timer);session.interactions.delete(removed.id)
    }
    if(draft.timeout&&Number.isSafeInteger(draft.timeout)&&draft.timeout>0){
      pending.timer=setTimeout(()=>this.providerResolved(session,draft.providerKey,'Request timed out.'),Math.min(draft.timeout,60*60*1000));pending.timer.unref()
    }
    this.update(session,{status:'waiting',error:null})
  }
  private finishInteraction(session:ManagedSession,pending:ProviderInteraction,resolution:Exclude<SessionInteraction['resolution'],null>):void {
    if(pending.timer){clearTimeout(pending.timer);pending.timer=undefined}
    pending.view.status='resolved';pending.view.resolution=resolution;pending.view.error=null
    if(session.view.status==='waiting'&&!this.hasBlockingInteraction(session))this.update(session,{status:'running',error:null})
    else this.touch(session)
  }
  private staleInteraction(session:ManagedSession,pending:ProviderInteraction,message:string):SessionResult {
    if(pending.timer){clearTimeout(pending.timer);pending.timer=undefined}
    pending.view.status='stale';pending.view.error=message
    if(session.view.status==='waiting'&&!this.hasBlockingInteraction(session))this.update(session,{status:'running',error:null})
    else this.touch(session)
    return {ok:false,error:message}
  }
  private providerResolved(session:ManagedSession,providerKey:string,message='Request was resolved elsewhere.'):void {
    const pending=[...session.interactions.values()].find(item=>item.providerKey===providerKey)
    if(pending&&['pending','submitting','unsupported'].includes(pending.view.status))this.staleInteraction(session,pending,message)
  }
  private expireInteractions(session:ManagedSession,message:string):void {
    let changed=false
    for(const pending of session.interactions.values())if(['pending','submitting','unsupported'].includes(pending.view.status)){
      if(pending.timer){clearTimeout(pending.timer);pending.timer=undefined}
      pending.view.status='stale';pending.view.error=message;changed=true
    }
    if(changed)this.touch(session)
  }
  private hasBlockingInteraction(session:ManagedSession):boolean {
    return session.view.interactions.some(item=>['pending','submitting','unsupported'].includes(item.status))
  }
  private codexInteraction(session:ManagedSession,value:Record<string,unknown>):void {
    const method=string(value.method),params=object(value.params),requestId=value.id
    if(!method||!params||(typeof requestId!=='string'&&typeof requestId!=='number')||params.threadId!==session.view.providerSessionId)return
    if(typeof params.turnId==='string'&&session.activeCodexTurn&&params.turnId!==session.activeCodexTurn)return
    const key=`codex:${requestId}`
    if(method==='item/permissions/requestApproval'){
      this.addInteraction(session,{providerKind:'unsupported',providerRequestId:requestId,providerKey:key,kind:'unsupported',title:'Permission grant',detail:'This Codex permission grant has no safe one-time deny contract.',target:session.view.projectPath});return
    }
    if(method==='item/tool/requestUserInput'){
      const raw=array(params.questions).slice(0,32),secret=raw.some(entry=>object(entry)?.isSecret===true)
      const questions=raw.flatMap((entry,index)=>{const question=object(entry);if(!question)return [];const options=questionOptions(question.options);return [{id:questionId(question.id,`question-${index+1}`),label:displayText(question.header,`Question ${index+1}`,100),prompt:displayText(question.question,'Input required'),control:options.length?'choice':'text',options,multiple:false,allowOther:question.isOther===true}] satisfies SessionInteractionQuestion[]})
      if(secret||!questions.length){this.addInteraction(session,{providerKind:'unsupported',providerRequestId:requestId,providerKey:key,kind:'unsupported',title:secret?'Secret input':'Unsupported input request',detail:secret?'Secret prompts are not collected by Localino.':'The request has no supported questions.',target:session.view.projectPath});return}
      this.addInteraction(session,{providerKind:'codex-input',providerRequestId:requestId,providerKey:key,kind:'input',title:'Input requested',detail:'Codex is waiting for your response.',target:displayText(params.itemId,session.view.projectPath),questions});return
    }
    const command=string(params.command),cwd=string(params.cwd),grantRoot=string(params.grantRoot),host=string(object(params.networkApprovalContext)?.host)
    this.addInteraction(session,{providerKind:'codex-approval',providerRequestId:requestId,providerKey:key,kind:'approval',title:method==='item/fileChange/requestApproval'?'File change approval':'Command approval',detail:displayText(params.reason,method==='item/fileChange/requestApproval'?'The model wants to change files.':'The model wants to run a command.'),target:[command,grantRoot,cwd,host].filter(Boolean).map(item=>displayText(item,'')).join('\n')||session.view.projectPath})
  }
  private claudeInteraction(session:ManagedSession,value:Record<string,unknown>):void {
    const requestId=value.request_id,request=object(value.request),subtype=string(request?.subtype)
    if(typeof requestId!=='string'||!request||!subtype)return
    const key=`claude:${requestId}`
    if(subtype!=='can_use_tool'){
      this.addInteraction(session,{providerKind:'unsupported',providerRequestId:requestId,providerKey:key,kind:'unsupported',title:'Claude dialog',detail:'Action required — unsupported in Localino',target:displayText(subtype,'Unknown dialog')});return
    }
    const input=object(request.input),safeTarget=['command','path','file_path','filePath','url'].flatMap(name=>typeof input?.[name]==='string'?[displayText(input[name],'')]:[])
    this.addInteraction(session,{providerKind:'claude-approval',providerRequestId:requestId,providerKey:key,kind:'approval',title:`Use ${displayText(request.tool_name,'tool',100)}`,detail:displayText(request.decision_reason,'Claude is asking to use a tool.'),target:[displayText(request.blocked_path,'',1000),...safeTarget].filter(Boolean).join('\n')||session.view.projectPath})
  }
  private piInteraction(session:ManagedSession,value:Record<string,unknown>):void {
    const requestId=value.id,method=string(value.method)
    if(typeof requestId!=='string'||!method)return
    const key=`pi:${requestId}`,timeout=typeof value.timeout==='number'?value.timeout:undefined,title=displayText(value.title,method==='confirm'?'Approval requested':'Input requested',200)
    if(method==='confirm'){
      this.addInteraction(session,{providerKind:'pi-confirm',providerRequestId:requestId,providerKey:key,kind:'approval',title,detail:displayText(value.message,'Pi is asking for confirmation.'),target:session.view.projectPath,cancelable:true,timeout});return
    }
    const options=method==='select'?questionOptions(value.options):[],question:SessionInteractionQuestion={id:'value',label:title,prompt:method==='editor'?'Enter multiline text.':method==='input'?displayText(value.placeholder,'Enter a value.'):displayText(value.title,'Choose an option.'),control:method==='editor'?'multiline':options.length?'choice':'text',options,multiple:false,allowOther:false}
    this.addInteraction(session,{providerKind:'pi-value',providerRequestId:requestId,providerKey:key,kind:'input',title,detail:'Pi is waiting for your response.',target:session.view.projectPath,questions:[question],cancelable:true,timeout})
  }
  private openCodeInteraction(session:ManagedSession,value:Record<string,unknown>):void {
    const type=string(value.type),properties=object(value.properties)
    if(!type||!properties||properties.sessionID!==session.view.providerSessionId)return
    if(['permission.replied','permission.v2.replied'].includes(type)){const id=string(properties.requestID);if(id)this.providerResolved(session,`open:permission:${id}`);return}
    if(['question.replied','question.rejected','question.v2.replied','question.v2.rejected'].includes(type)){const id=string(properties.requestID);if(id)this.providerResolved(session,`open:question:${id}`);return}
    if(type==='session.idle'){this.expireInteractions(session,'The turn ended before a response was sent.');return}
    if(type==='session.status'&&object(properties.status)?.type==='idle'){this.expireInteractions(session,'The turn ended before a response was sent.');return}
    const requestId=string(properties.id);if(!requestId)return
    if(type==='permission.asked'||type==='permission.v2.asked'){
      const action=string(properties.permission)??string(properties.action)??'permission',resources=array(properties.patterns).length?array(properties.patterns):array(properties.resources)
      this.addInteraction(session,{providerKind:type==='permission.v2.asked'?'opencode-permission-v2':'opencode-permission',providerRequestId:requestId,providerKey:`open:permission:${requestId}`,kind:'approval',title:`Allow ${displayText(action,'permission',100)}`,detail:'OpenCode is requesting one-time permission.',target:resources.filter((item):item is string=>typeof item==='string').slice(0,32).map(item=>displayText(item,'')).join('\n')||session.view.projectPath});return
    }
    if(type==='question.asked'||type==='question.v2.asked'){
      const questions=array(properties.questions).slice(0,32).flatMap((entry,index)=>{const item=object(entry);if(!item)return [];const options=questionOptions(item.options);return [{id:`question-${index+1}`,label:displayText(item.header,`Question ${index+1}`,100),prompt:displayText(item.question,'Input required'),control:options.length?'choice':'text',options,multiple:item.multiple===true,allowOther:item.custom===true}] satisfies SessionInteractionQuestion[]})
      if(!questions.length){this.addInteraction(session,{providerKind:'unsupported',providerRequestId:requestId,providerKey:`open:question:${requestId}`,kind:'unsupported',title:'OpenCode question',detail:'The request has no supported questions.',target:session.view.projectPath});return}
      this.addInteraction(session,{providerKind:'opencode-question',providerRequestId:requestId,providerKey:`open:question:${requestId}`,kind:'input',title:'Input requested',detail:'OpenCode is waiting for your response.',target:session.view.projectPath,questions,cancelable:true})
    }
  }
  private async dispatch(session:ManagedSession,delivery:SessionDelivery):Promise<void>{
    const generation=session.generation
    try{
      // Keep the prior turn's final output ahead of the next prompt on disk.
      await session.pump.flush()
      if(session.stopping||this.disposed||generation!==session.generation)return
      if(this.transcripts) {
        try { await this.transcripts.append([{eventId:`prompt:${delivery.id}`,sessionId:session.view.id,provider:session.view.agent,providerSessionId:session.view.providerSessionId,turnId:delivery.id,itemId:delivery.id,kind:'prompt',operation:'snapshot',text:delivery.text,outcome:'completed'}]) }
        catch { if(session.stopping||this.disposed||generation!==session.generation)return;delivery.status='failed';delivery.error='Message was not sent because the transcript could not be saved.';this.persist(session);this.update(session,{status:'error',error:delivery.error});return }
      }
      if(session.stopping||this.disposed||generation!==session.generation||delivery.status!=='sending')return
      for(const [id,interaction] of session.interactions)if(!['pending','submitting','unsupported'].includes(interaction.view.status)){if(interaction.timer)clearTimeout(interaction.timer);session.interactions.delete(id)}
      session.view.interactions=session.view.interactions.filter(interaction=>['pending','submitting','unsupported'].includes(interaction.status))
      session.output.beginDelivery(delivery.id)
      if(session.view.agent==='codex'){
        const id=++session.requestSequence;session.pending.set(id,`delivery:${delivery.id}`);this.write(session,{id,method:'turn/start',params:{threadId:session.view.providerSessionId,input:[{type:'text',text:delivery.text}]}});this.awaitReceipt(session,delivery);this.update(session,{status:'running',turnStartedAt:null,turnElapsedMs:null,lastTurnOutcome:null,error:null})
      }else if(session.view.agent==='pi'){
        session.activePiRun=undefined;session.awaitingPiDelivery=delivery.id;session.piCanSettle=false;const id=++session.requestSequence;session.pending.set(id,`delivery:${delivery.id}`);this.write(session,{id,type:'prompt',message:delivery.text});this.awaitReceipt(session,delivery);this.update(session,{status:'running',turnStartedAt:null,turnElapsedMs:null,lastTurnOutcome:null,error:null})
      }else if(session.view.agent==='claude'){
        session.activeClaudeMessage=undefined
        this.write(session,{type:'user',uuid:delivery.id,message:{role:'user',content:[{type:'text',text:delivery.text}]},parent_tool_use_id:null,session_id:session.view.providerSessionId??''})
        this.awaitReceipt(session,delivery);this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})
      }else{
        const provider=session.view.providerSessionId;if(!provider)throw Error()
        await this.request(session,`/session/${encodeURIComponent(provider)}/prompt_async`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageID:delivery.id,parts:[{type:'text',text:delivery.text}]}),expectNoContent:true})
        if(session.stopping||generation!==session.generation)return
        this.confirmDelivery(session,delivery,true)
        if((session.output as OpenCodeTranscript).settled)this.idle(session,(session.output as OpenCodeTranscript).outcome)
        else this.update(session,{status:'running',turnStartedAt:Date.now(),turnElapsedMs:null,lastTurnOutcome:null,error:null})
      }
    }catch{this.clearDeliveryDeadline(session,delivery.id);delivery.status='unknown';delivery.error='Delivery outcome is unknown.';this.persist(session);this.update(session,{status:'unknown',error:'Connection to the agent was lost.'})}
  }
  private idle(session:ManagedSession,outcome:LiveSession['lastTurnOutcome']='completed'):void{
    if(session.view.deliveries.some(item=>item.status==='sending'))return
    this.update(session,{status:'idle',turnStartedAt:null,lastTurnOutcome:outcome,error:outcome==='failed'?'The last agent turn failed.':null})
    const queued=session.view.deliveries.find(item=>item.status==='queued')
    if(queued){queued.status='sending';this.persist(session);this.touch(session);void this.dispatch(session,queued)}
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
    for(const timer of session.deliveryDeadlines.values())clearTimeout(timer)
    session.deliveryDeadlines.clear()
    for(const interaction of session.interactions.values())if(interaction.timer){clearTimeout(interaction.timer);interaction.timer=undefined}
  }
  private request(session:ManagedSession,path:string,init:RequestInit&{expectNoContent?:boolean}={}):Promise<unknown>{
    if(!session.endpoint||!session.authorization)return Promise.reject(Error())
    const {expectNoContent,...request}=init
    return fetch(`${session.endpoint}${path}`,{...request,headers:{authorization:session.authorization,...request.headers},signal:AbortSignal.timeout(5000)}).then(async response=>{
      if(!response.ok)throw Error()
      if(expectNoContent||response.status===204)return null
      return boundedJson(response)
    })
  }
  private write(session:ManagedSession,value:unknown):void{
    if(!session.child.stdin.writable)throw Error('Agent input is closed.')
    session.child.stdin.write(`${JSON.stringify(value)}\n`)
  }
  private delivery(session:ManagedSession,id:string):SessionDelivery|undefined{return session.view.deliveries.find(item=>item.id===id)}
  private awaitReceipt(session:ManagedSession,delivery:SessionDelivery):void{
    const generation=session.generation,timer=setTimeout(()=>{
      session.deliveryDeadlines.delete(delivery.id)
      if(session.stopping||generation!==session.generation||delivery.status!=='sending')return
      delivery.status='unknown';delivery.error='Delivery receipt was not received; Localino will not retry.';this.persist(session);this.update(session,{status:'unknown',error:'Message delivery is unknown. It was not retried.'})
    },15_000)
    timer.unref();session.deliveryDeadlines.set(delivery.id,timer)
  }
  private clearDeliveryDeadline(session:ManagedSession,id:string):void{const timer=session.deliveryDeadlines.get(id);if(timer)clearTimeout(timer);session.deliveryDeadlines.delete(id)}
  private confirmDelivery(session:ManagedSession,delivery:SessionDelivery,accepted:boolean,error?:string):void{
    if(delivery.status!=='sending')return
    this.clearDeliveryDeadline(session,delivery.id);delivery.status=accepted?'sent':'failed';delivery.error=accepted?null:error??'The agent rejected the message.';this.persist(session);this.touch(session)
  }
  private confirmSendingFromLifecycle(session:ManagedSession):void{const delivery=session.view.deliveries.find(item=>item.status==='sending');if(delivery)this.confirmDelivery(session,delivery,true)}
  private persist(session:ManagedSession):boolean{return this.recovery.save(session.view)}
  private fail(session:ManagedSession,error:string):void{this.update(session,{status:'error',turnStartedAt:null,error})}
  private touch(session:ManagedSession):void{session.view.updatedAt=Date.now();this.changed()}
  private update(session:ManagedSession,change:Partial<Pick<LiveSession,'providerSessionId'|'status'|'turnStartedAt'|'turnElapsedMs'|'lastTurnOutcome'|'error'>>):void{
    const active=session.view.status==='running'||session.view.status==='waiting'
    if(change.status==='running'&&this.hasBlockingInteraction(session))change={...change,status:'waiting'}
    const next=change.status??session.view.status
    if(next!=='running'&&next!=='waiting')for(const pending of session.interactions.values())if(['pending','submitting','unsupported'].includes(pending.view.status)){
      if(pending.timer){clearTimeout(pending.timer);pending.timer=undefined}
      pending.view.status='stale';pending.view.error='Request expired.'
    }
    if(active&&next!=='running'&&next!=='waiting'&&session.view.turnStartedAt!==null&&change.turnElapsedMs===undefined)session.view.turnElapsedMs=Math.max(0,Date.now()-session.view.turnStartedAt)
    if(session.view.status==='starting'&&next!=='starting'&&session.deadline){clearTimeout(session.deadline);session.deadline=undefined}
    Object.assign(session.view,change,{updatedAt:Date.now()})
    if(next==='unknown'){
      session.awaitingPiDelivery=undefined;session.activePiRun=undefined
      for(const delivery of session.view.deliveries){if(delivery.status==='sending'){this.clearDeliveryDeadline(session,delivery.id);delivery.status='unknown';delivery.error='Delivery outcome is unknown.'}else if(delivery.status==='queued')delivery.status='suspended'}
      this.persist(session)
    }
    this.changed()
  }
  private changed():void{this.emit('change',this.state)}
}
