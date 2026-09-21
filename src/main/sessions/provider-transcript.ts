import { createHash } from 'node:crypto'
import type { AgentId } from '../../shared/agents'
import type { TranscriptInput, TranscriptKind, TranscriptOutcome } from '../../shared/transcript'

export const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined
export const string=(value:unknown):string|undefined=>typeof value==='string'?value:undefined
export const id=(value:unknown):string|undefined=>typeof value==='string'&&value.length>0&&value.length<=256?value:undefined
export const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[]
export const contentText=(value:unknown):string=>typeof value==='string'?value:array(value).map(entry=>{const item=object(entry);return item?.type==='text'?string(item.text)??'':''}).join('')
export function observableArguments(value:unknown):string {
  const input=object(value)
  if(!input)return ''
  return ['command','path','file_path','filePath','pattern','query','description','url'].flatMap(key=>typeof input[key]==='string'?[`${key}: ${input[key]}`]:[]).join('\n')
}
export interface OutputContext { providerSessionId:string|null; turnId?:string; deliveryId?:string }
interface OutputItem { kind:TranscriptKind; offset:number; done:boolean }

/** One adapter belongs to exactly one owned process. It never consumes stderr or auth envelopes. */
export abstract class ProviderTranscript {
  protected context:OutputContext={providerSessionId:null}
  protected source=''
  protected readonly items=new Map<string,OutputItem>()
  private counter=0
  private gap=false
  private readonly seen=new Set<string>()
  private buffered:TranscriptInput[]=[]
  constructor(readonly sessionId:string,readonly provider:AgentId,private readonly publish:(events:TranscriptInput[])=>void){}
  beginDelivery(deliveryId:string):void {if(!id(deliveryId))throw Error('Invalid delivery identity.');this.gap=false;this.context={...this.context,turnId:deliveryId}}
  markGap(message:string):void {
    this.gap=true;this.buffered=[];this.source=`local-${++this.counter}`
    this.emit(`gap:${this.source}`,'error','notice',{text:message,outcome:'unknown',label:'Output gap'})
    if(this.buffered.length)this.publish(this.buffered);this.buffered=[]
  }
  terminate(message:string,outcome:TranscriptOutcome='unknown'):void {if(outcome==='unknown')this.markGap(message);this.buffered=[];this.source=`local-${++this.counter}`;this.finishTurn(outcome);if(this.buffered.length)this.publish(this.buffered);this.buffered=[]}
  ingest(value:Record<string,unknown>,context:OutputContext):void {
    this.context=context;this.buffered=[]
    const source=id(value.uuid)??(this.provider==='opencode'?id(value.id):undefined)
    if(source&&this.seen.has(source))return
    if(source)this.seen.add(source)
    this.source=source?`provider:${source}`:`local-${++this.counter}`
    this.record(value)
    if(this.buffered.length)this.publish(this.buffered)
  }
  protected abstract record(value:Record<string,unknown>):void
  protected emit(itemId:string,kind:TranscriptKind,operation:TranscriptInput['operation'],options:Partial<Pick<TranscriptInput,'text'|'outcome'|'phase'|'label'>>={},turnId=this.context.turnId??null):void {
    if(!this.context.providerSessionId)return
    const key=JSON.stringify([turnId,itemId]),previous=this.items.get(key)
    if(previous?.done)return
    if(this.gap&&options.outcome==='completed')options={...options,outcome:'unknown'}
    const state=previous??{kind,offset:0,done:false}
    if(previous&&previous.kind!==kind)throw Error('Provider changed an item type within a turn.')
    const offset=state.offset
    if(operation==='append')state.offset+=(options.text??'').length
    else if(options.text!==undefined)state.offset=options.text.length
    if(operation==='finish'||options.outcome&&options.outcome!=='streaming')state.done=true
    this.items.set(key,state)
    const eventId=createHash('sha256').update(JSON.stringify([this.source,turnId,itemId,operation,this.buffered.length])).digest('hex')
    this.buffered.push({eventId,sessionId:this.sessionId,provider:this.provider,providerSessionId:this.context.providerSessionId,turnId,itemId,kind,operation,...options,...(operation==='append'?{offset,text:options.text??''}:{})})
  }
  protected known(itemId:string,turnId=this.context.turnId??null):OutputItem|undefined{return this.items.get(JSON.stringify([turnId,itemId]))}
  protected finishTurn(outcome:TranscriptOutcome):void {
    const turn=this.context.turnId??null
    if(turn===null)return
    for(const [key,state] of this.items) {
      const [itemTurn,itemId]=JSON.parse(key) as [string|null,string]
      if(itemTurn===turn&&!state.done)this.emit(itemId,state.kind,'finish',{outcome})
    }
    this.emit(`turn:${turn}`, 'status','notice',{label:`Turn ${outcome}`,outcome,text:`Turn ${outcome}`})
  }
  protected unknown(label:string,itemId=`unknown:${this.source}`):void {this.emit(itemId,'unknown','notice',{label:`Unsupported event: ${label}`,outcome:'unknown'})}
  protected requireText(value:unknown):string {if(typeof value!=='string')throw Error('Provider emitted invalid text.');return value}
}

export class CodexTranscript extends ProviderTranscript {
  protected record(value:Record<string,unknown>):void {
    const method=string(value.method),params=object(value.params)
    if(!method||!params)return
    if(params.threadId!==this.context.providerSessionId)return
    const turn=object(params.turn),turnId=id(params.turnId)??id(turn?.id)
    if(turnId&&turnId!==this.context.turnId)return
    if(method==='turn/started'){this.emit(`turn-start:${turnId}`,'status','notice',{text:'Turn started',outcome:'completed'});return}
    if(method==='turn/completed'){
      const status=turn?.status
      this.finishTurn(status==='completed'?'completed':status==='interrupted'?'interrupted':status==='failed'?'failed':'unknown');return
    }
    const item=object(params.item),itemId=id(params.itemId)??id(item?.id)
    if(method==='item/reasoning/textDelta')return // This is raw reasoning, not the published summary channel.
    if(method==='item/agentMessage/delta'&&itemId){this.emit(itemId,'assistant','append',{text:this.requireText(params.delta)});return}
    if(method==='item/reasoning/summaryTextDelta'&&itemId){
      const index=params.summaryIndex
      if(!Number.isSafeInteger(index)||Number(index)<0)throw Error('Invalid reasoning summary block.')
      this.emit(`${itemId}:summary:${index}`,'reasoning-summary','append',{text:this.requireText(params.delta),label:'Published reasoning summary'});return
    }
    if(method==='item/reasoning/summaryPartAdded')return
    if(method==='item/commandExecution/outputDelta'&&itemId){this.emit(`${itemId}:output`,'output','append',{text:this.requireText(params.delta),label:'Command output'});return}
    if(method==='item/fileChange/outputDelta'&&itemId){this.emit(`${itemId}:output`,'output','append',{text:this.requireText(params.delta),label:'File change output'});return}
    if(method==='turn/diff/updated'){this.emit(`diff:${this.source}`,'file','snapshot',{text:this.requireText(params.diff),label:'Turn diff',outcome:'completed'});return}
    if(method==='turn/plan/updated'){this.emit(`plan:${this.source}`,'status','notice',{text:array(params.plan).map(step=>{const entry=object(step);return `${string(entry?.status)??'unknown'}: ${string(entry?.step)??''}`}).join('\n'),label:'Plan',outcome:'completed'});return}
    if(method==='error'){const error=object(params.error);this.emit(`error:${this.source}`,'error','notice',{text:string(error?.message)??'Provider error',outcome:'failed'});return}
    if(method.endsWith('/requestApproval')||method==='item/tool/requestUserInput'){
      if(typeof value.id!=='number'&&!id(value.id))throw Error('Approval request has no identity.')
      const request=String(value.id)
      this.emit(`request:${request}`,method.endsWith('/requestApproval')?'approval':'input','start',{text:[string(params.command),string(params.reason),...array(params.questions).map(question=>string(object(question)?.question))].filter(Boolean).join('\n'),label:'Action required — unsupported in Localino'});return
    }
    if((method==='item/started'||method==='item/completed')&&item&&itemId){
      const complete=method==='item/completed',outcome:TranscriptOutcome=item.status==='failed'?'failed':item.status==='declined'?'interrupted':complete?'completed':'streaming'
      if(!complete&&this.known(itemId))return
      switch(item.type){
        case 'userMessage':return // Local prompt already exists; receipt is not another prompt.
        case 'agentMessage':this.emit(itemId,'assistant','snapshot',{text:this.requireText(item.text),phase:item.phase==='commentary'||item.phase==='final'?item.phase:undefined,outcome});return
        case 'reasoning':array(item.summary).forEach((text,index)=>this.emit(`${itemId}:summary:${index}`,'reasoning-summary','snapshot',{text:this.requireText(text),outcome,label:'Published reasoning summary'}));return
        case 'commandExecution':
          this.emit(itemId,'command','snapshot',{text:string(item.command)??'',outcome,label:'Command'})
          if(typeof item.aggregatedOutput==='string')this.emit(`${itemId}:output`,'output','snapshot',{text:item.aggregatedOutput,outcome,label:'Command output'})
          return
        case 'fileChange':this.emit(itemId,'file','snapshot',{text:array(item.changes).map(change=>{const v=object(change);return `${string(v?.path)??''}\n${string(v?.diff)??''}`}).join('\n'),outcome,label:'File changes'});return
        case 'mcpToolCall':
          this.emit(itemId,'tool','snapshot',{text:observableArguments(item.arguments),outcome,label:`Tool ${string(item.tool)??'unknown'}`})
          if(complete)this.emit(`${itemId}:output`,'output','snapshot',{text:contentText(object(item.result)?.content)||string(object(item.error)?.message)||'',outcome,label:'Tool output'})
          return
        case 'dynamicToolCall':this.emit(itemId,'tool','snapshot',{text:observableArguments(item.arguments),outcome,label:`Tool ${string(item.tool)??'unknown'}`});if(complete)this.emit(`${itemId}:output`,'output','snapshot',{text:contentText(item.contentItems),outcome,label:'Tool output'});return
        case 'functionCallOutput':this.emit(itemId,'output','snapshot',{text:typeof item.output==='string'?item.output:contentText(item.output),outcome,label:`Tool output ${string(item.name)??''}`});return
        case 'plan':this.emit(itemId,'status','snapshot',{text:string(item.text)??'',outcome,label:'Plan'});return
        case 'webSearch':this.emit(itemId,'tool','snapshot',{text:string(item.query)??'',outcome,label:'Web search'});return
        default:this.unknown(String(item.type),itemId);return
      }
    }
    if(method==='item/mcpToolCall/progress'&&itemId){this.emit(`${itemId}:progress:${this.source}`,'output','notice',{text:string(params.message)??'',outcome:'completed',label:'Tool progress'});return}
    if(method==='serverRequest/resolved'||method==='thread/status/changed')return
    if(this.context.turnId)this.unknown(method)
  }
}
