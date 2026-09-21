import { ProviderTranscript, array, id, object, observableArguments, string, type OutputContext } from './provider-transcript'
import type { TranscriptKind } from '../../shared/transcript'
import type { TurnOutcome } from '../../shared/sessions'

export class OpenCodeTranscript extends ProviderTranscript {
  private parent?:string
  private readonly parents=new Set<string>()
  private readonly messages=new Map<string,string>()
  private readonly userMessages=new Set<string>()
  private readonly parts=new Map<string,{messageId:string;kind:TranscriptKind}>()
  private busy=false
  private snapshotsOnly=false
  settled=false
  outcome:TurnOutcome|null=null
  override beginDelivery(deliveryId:string):void {super.beginDelivery(deliveryId);this.parent=deliveryId;this.parents.add(deliveryId);this.busy=false;this.settled=false;this.snapshotsOnly=false;this.outcome=null}
  disconnected():void {this.snapshotsOnly=true;this.context={...this.context,turnId:this.parent};this.markGap('OpenCode event stream disconnected. Recovered snapshots may omit intermediate activity.')}
  recoveredIdle():void {if(this.snapshotsOnly){this.context={...this.context,turnId:this.parent};this.settle('completed')}}
  reconcile(messages:unknown[],context:OutputContext):void {
    for(const entry of messages){const value=object(entry),info=object(value?.info);if(!info)throw Error('Invalid OpenCode recovery message.')
      this.ingest({type:'message.updated',properties:{sessionID:info.sessionID,info}},context)
      for(const part of array(value?.parts))this.ingest({type:'message.part.updated',properties:{sessionID:info.sessionID,part}},context)
    }
  }
  protected record(value:Record<string,unknown>):void {
    const type=string(value.type),properties=object(value.properties)
    if(type==='server.connected'||type==='server.heartbeat')return
    if(!type||!properties)throw Error('Invalid OpenCode event.')
    if(properties.sessionID!==this.context.providerSessionId)return
    this.context={...this.context,turnId:this.parent}
    if(type==='message.updated'){
      const info=object(properties.info),messageId=id(info?.id)
      if(!info||!messageId||info.sessionID!==this.context.providerSessionId)throw Error('Invalid OpenCode message identity.')
      if(info.role==='user'){this.userMessages.add(messageId);return}
      const parent=id(info.parentID)
      if(info.role!=='assistant'||!parent||!this.parents.has(parent))return
      this.messages.set(messageId,parent)
      if(info.error)this.emit(`message-error:${messageId}`,'error','notice',{text:string(object(info.error)?.message)??'OpenCode message failed',outcome:'failed'},parent)
      return
    }
    if(type==='message.part.updated'){
      const part=object(properties.part),partId=id(part?.id),messageId=id(part?.messageID)
      if(!part||!partId||!messageId||part.sessionID!==this.context.providerSessionId)throw Error('Invalid OpenCode part identity.')
      const parent=this.messages.get(messageId)
      if(!parent){if(!this.userMessages.has(messageId))this.markGap('OpenCode part arrived without a known owned assistant message.');return}
      this.context={...this.context,turnId:parent}
      const kind:TranscriptKind=part.type==='text'?'assistant':part.type==='reasoning'?'reasoning-summary':part.type==='tool'?'tool':part.type==='patch'||part.type==='file'?'file':['step-start','step-finish','compaction','retry'].includes(String(part.type))?'status':'unknown'
      const previous=this.parts.get(partId)
      if(previous&&(previous.messageId!==messageId||previous.kind!==kind))throw Error('OpenCode changed a part identity.')
      this.parts.set(partId,{messageId,kind})
      if(kind==='assistant'||kind==='reasoning-summary'){
        this.emit(partId,kind,'snapshot',{text:this.requireText(part.text),outcome:typeof object(part.time)?.end==='number'?'completed':'streaming',label:kind==='reasoning-summary'?'Published thinking':kind});return
      }
      if(kind==='tool'){
        const state=object(part.state),status=state?.status
        if(!state||!['pending','running','completed','error'].includes(String(status)))throw Error('Invalid OpenCode tool state.')
        const outcome=status==='error'?'failed':status==='completed'?'completed':'streaming'
        this.emit(partId,'tool','snapshot',{text:observableArguments(state.input),label:`Tool ${string(part.tool)??'unknown'}`,outcome})
        if(typeof state.output==='string'||typeof state.error==='string')this.emit(`${partId}:output`,'output','snapshot',{text:string(state.output)??string(state.error)??'',outcome,label:'Tool output'})
        return
      }
      if(kind==='file'){this.emit(partId,'file','snapshot',{text:part.type==='patch'?array(part.files).filter((value):value is string=>typeof value==='string').join('\n'):string(part.filename)??'File attachment',outcome:'completed',label:'Files'});return}
      if(kind==='status'){this.emit(partId,'status','notice',{text:String(part.type),outcome:'completed'});return}
      this.unknown(String(part.type),partId);return
    }
    if(type==='message.part.delta'){
      if(this.snapshotsOnly)return
      const partId=id(properties.partID),messageId=id(properties.messageID),part=partId?this.parts.get(partId):undefined
      if(!part||part.messageId!==messageId){this.markGap('OpenCode delta arrived without its owned part.');return}
      const parent=this.messages.get(part.messageId);if(!parent)return
      this.context={...this.context,turnId:parent}
      if(properties.field==='text'&&(part.kind==='assistant'||part.kind==='reasoning-summary'))this.emit(partId!,part.kind,'append',{text:this.requireText(properties.delta)})
      else this.unknown(`part delta ${string(properties.field)??'unknown'}`)
      return
    }
    if(type==='session.status'){
      const status=object(properties.status)?.type
      if(status==='busy'||status==='retry'){this.busy=true;this.emit(`status:${this.source}`,'status','notice',{text:String(status),outcome:'completed'})}
      else if(status==='idle'&&this.busy)this.settle('completed')
      return
    }
    if(type==='session.idle'){if(this.busy)this.settle('completed');return}
    if(type==='session.error'){this.emit(`error:${this.source}`,'error','notice',{text:string(object(properties.error)?.message)??'OpenCode session error',outcome:'failed'});this.settle('failed');return}
    if(type==='permission.asked'||type==='question.asked'){
      const requestId=id(properties.id);if(!requestId)throw Error('OpenCode request has no identity.')
      this.emit(`request:${requestId}`,type==='permission.asked'?'approval':'input','start',{text:[string(properties.permission),...array(properties.patterns).filter((entry):entry is string=>typeof entry==='string'),...array(properties.questions).map(entry=>string(object(entry)?.question))].filter(Boolean).join('\n'),label:'Action required — unsupported in Localino'});return
    }
    if(['permission.replied','question.replied','question.rejected'].includes(type))return
    this.unknown(type)
  }
  private settle(outcome:TurnOutcome):void {this.finishTurn(outcome);this.busy=false;this.settled=true;this.outcome=this.snapshotsOnly?null:outcome}
}
