import { dirname, isAbsolute } from 'node:path'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAgentId } from '../../shared/agents'
import type { LiveSession, RecoveredSession, SessionDelivery } from '../../shared/sessions'

const retainedStatuses=new Set(['queued','sending','failed','unknown','suspended'])

function delivery(value:unknown):SessionDelivery|null{
  if(!value||typeof value!=='object')return null
  const item=value as Partial<SessionDelivery>
  if(typeof item.id!=='string'||!item.id||typeof item.text!=='string'||!item.text.trim()||item.text.length>100_000||!Number.isSafeInteger(item.createdAt)||item.createdAt!<0||typeof item.status!=='string'||!retainedStatuses.has(item.status))return null
  return {id:item.id,text:item.text,createdAt:item.createdAt!,status:item.status==='queued'||item.status==='sending'?'suspended':item.status as SessionDelivery['status'],error:typeof item.error==='string'?item.error:null}
}

function recovered(value:unknown):RecoveredSession|null{
  if(!value||typeof value!=='object')return null
  const item=value as Partial<RecoveredSession>
  if(typeof item.id!=='string'||!item.id||!isAgentId(item.agent)||typeof item.projectPath!=='string'||!isAbsolute(item.projectPath)||typeof item.projectName!=='string'||!item.projectName||item.providerSessionId!==null&&typeof item.providerSessionId!=='string'||!Number.isSafeInteger(item.updatedAt)||item.updatedAt!<0||typeof item.draft!=='string'||item.draft.length>100_000||!Array.isArray(item.deliveries))return null
  const deliveries=item.deliveries.map(delivery)
  if(deliveries.some(entry=>entry===null))return null
  return {id:item.id,agent:item.agent,projectPath:item.projectPath,projectName:item.projectName,providerSessionId:item.providerSessionId,updatedAt:item.updatedAt!,draft:item.draft,deliveries:deliveries as SessionDelivery[]}
}

export class SessionRecoveryStore {
  private records=new Map<string,RecoveredSession>()
  error:string|null=null
  constructor(private readonly file?:string){
    if(!file)return
    try{
      const raw:unknown=JSON.parse(readFileSync(file,'utf8'))
      if(!raw||typeof raw!=='object'||(raw as {version?:unknown}).version!==1||!Array.isArray((raw as {sessions?:unknown}).sessions))throw Error('schema')
      for(const value of (raw as {sessions:unknown[]}).sessions){const item=recovered(value);if(!item||this.records.has(item.id))throw Error('schema');if(item.draft||item.deliveries.length)this.records.set(item.id,item)}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.error='Session recovery file is unreadable. It was preserved.'}
  }
  get state():RecoveredSession[]{return [...this.records.values()].map(item=>({...item,deliveries:item.deliveries.map(entry=>({...entry}))})).sort((a,b)=>b.updatedAt-a.updatedAt)}
  has(id:string):boolean{return this.records.has(id)}
  save(session:LiveSession):boolean{
    const deliveries=session.deliveries.filter(item=>retainedStatuses.has(item.status)).map(item=>({...item,status:item.status==='queued'||item.status==='sending'?'suspended':item.status} as SessionDelivery))
    if(session.draft||deliveries.length)this.records.set(session.id,{id:session.id,agent:session.agent,projectPath:session.projectPath,projectName:session.projectName,providerSessionId:session.providerSessionId,updatedAt:Date.now(),draft:session.draft,deliveries})
    else this.records.delete(session.id)
    return this.flush()
  }
  discard(id:string):boolean{this.records.delete(id);return this.flush()}
  private flush():boolean{
    if(!this.file)return true
    if(this.error)return false
    const temporary=`${this.file}.${randomUUID()}.tmp`
    try{
      mkdirSync(dirname(this.file),{recursive:true})
      writeFileSync(temporary,JSON.stringify({version:1,sessions:this.state}),{encoding:'utf8',mode:0o600,flag:'wx'})
      renameSync(temporary,this.file);return true
    }catch{try{rmSync(temporary,{force:true})}catch{/* Preserve the original recovery file. */}this.error='Could not save session drafts. Text remains in this Localino process.';return false}
  }
}
