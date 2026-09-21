import { ProviderTranscript, array, contentText, id, object, observableArguments, string } from './provider-transcript'
import type { TranscriptKind, TranscriptOutcome } from '../../shared/transcript'

interface PiBlock {itemId:string;kind:TranscriptKind}
export class PiTranscript extends ProviderTranscript {
  private messageTimestamp?:number
  private lastTimestamp=-1
  private outcome:TranscriptOutcome='completed'
  private readonly blocks=new Map<number,PiBlock>()
  override beginDelivery(deliveryId:string):void {super.beginDelivery(deliveryId);this.messageTimestamp=undefined;this.blocks.clear();this.outcome='completed'}
  protected record(value:Record<string,unknown>):void {
    const type=string(value.type)
    if(type==='extension_ui_request'){
      const requestId=id(value.id),method=string(value.method)
      if(!requestId||!method)throw Error('Invalid Pi UI request.')
      if(['select','confirm','input','editor'].includes(method))this.emit(`request:${requestId}`,method==='confirm'?'approval':'input','start',{text:[string(value.title),string(value.message)].filter(Boolean).join('\n'),label:'Action required — unsupported in Localino'})
      else this.emit(`ui:${requestId}`,'status','notice',{text:method==='notify'?string(value.message)??'Notification':method,outcome:'completed'})
      return
    }
    if(type==='response'||!this.context.turnId)return
    if(type==='message_start'){
      const message=object(value.message)
      if(message?.role!=='assistant')return
      const timestamp=message.timestamp
      if(typeof timestamp!=='number'||!Number.isFinite(timestamp))throw Error('Pi assistant message has no valid identity.')
      if(timestamp===this.messageTimestamp)return
      if(timestamp<=this.lastTimestamp){this.messageTimestamp=undefined;this.blocks.clear();this.markGap('Pi reused an earlier message timestamp. Its output was not assigned to the current response.');return}
      this.lastTimestamp=timestamp;this.messageTimestamp=timestamp;this.blocks.clear();return
    }
    if(type==='message_update'){
      const event=object(value.assistantMessageEvent),snapshot=object(value.message)
      if(snapshot?.timestamp!==undefined&&snapshot.timestamp!==this.messageTimestamp)return
      if(!event||this.messageTimestamp===undefined)return
      const index=event.contentIndex
      if(!Number.isSafeInteger(index)||Number(index)<0)throw Error('Invalid Pi content index.')
      const blockType=string(event.type)??'',number=Number(index)
      if(blockType.endsWith('_start')){
        if(this.blocks.has(number))return
        const kind:TranscriptKind=blockType==='text_start'?'assistant':blockType==='thinking_start'?'reasoning-summary':blockType==='toolcall_start'?'tool':'unknown'
        const itemId=kind==='tool'?id(event.id):`${this.messageTimestamp}:${number}`
        if(!itemId)throw Error('Pi tool call has no identity.')
        this.blocks.set(number,{itemId,kind})
        if(kind==='unknown')this.unknown(blockType,itemId)
        else this.emit(itemId,kind,'start',{label:kind==='tool'?`Tool ${string(event.toolName)??'unknown'}`:kind==='reasoning-summary'?'Published thinking':kind})
        return
      }
      const block=this.blocks.get(number)
      if(!block)throw Error('Pi delta arrived without a content block.')
      if(blockType==='text_delta'||blockType==='thinking_delta')this.emit(block.itemId,block.kind,'append',{text:this.requireText(event.delta)})
      else if(blockType==='text_end'||blockType==='thinking_end')this.emit(block.itemId,block.kind,'snapshot',{text:this.requireText(event.content)})
      else if(blockType==='toolcall_end'){
        const call=object(event.toolCall)
        if(call?.id!==block.itemId)throw Error('Pi changed a tool call identity.')
        this.emit(block.itemId,'tool','snapshot',{text:observableArguments(call.arguments),label:`Tool ${string(call.name)??'unknown'}`})
      } else if(blockType!=='toolcall_delta')this.unknown(blockType)
      return
    }
    if(type==='message_end'){
      const message=object(value.message)
      if(message?.role!=='assistant'||message.timestamp!==this.messageTimestamp)return
      for(const [index,entry] of array(message.content).entries()){
        const content=object(entry);if(!content)throw Error('Invalid Pi message content.')
        const kind:TranscriptKind=content.type==='text'?'assistant':content.type==='thinking'?'reasoning-summary':content.type==='toolCall'?'tool':'unknown'
        const itemId=kind==='tool'?id(content.id):`${this.messageTimestamp}:${index}`
        if(!itemId)throw Error('Pi tool call has no identity.')
        if(kind==='unknown'){this.unknown(String(content.type),itemId);continue}
        this.emit(itemId,kind,'snapshot',{text:kind==='assistant'?this.requireText(content.text):kind==='reasoning-summary'?this.requireText(content.thinking):observableArguments(content.arguments),outcome:kind==='tool'?'streaming':message.stopReason==='error'?'failed':message.stopReason==='aborted'?'interrupted':'completed',label:kind==='reasoning-summary'?'Published thinking':kind==='tool'?`Tool ${string(content.name)??'unknown'}`:kind})
      }
      return
    }
    if(type?.startsWith('tool_execution_')){
      const toolId=id(value.toolCallId);if(!toolId)throw Error('Pi tool execution has no identity.')
      const known=this.known(toolId)
      if(type==='tool_execution_start'){
        if(known?.done)return
        this.emit(toolId,'tool','snapshot',{text:observableArguments(value.args),label:`Tool ${string(value.toolName)??'unknown'}`});return
      }
      if(!known||known.done)return
      const result=object(type==='tool_execution_update'?value.partialResult:value.result)
      if(!result)throw Error('Invalid Pi tool result.')
      const complete=type==='tool_execution_end',outcome=complete?value.isError===true?'failed':'completed':'streaming'
      this.emit(`${toolId}:output`,'output','snapshot',{text:contentText(result.content),outcome,label:'Tool output'})
      if(complete)this.emit(toolId,'tool','finish',{outcome})
      return
    }
    if(type==='agent_settled'){this.finishTurn(this.outcome);this.messageTimestamp=undefined;this.blocks.clear();return}
    if(type==='turn_end'){
      const message=object(value.message)
      this.outcome=message?.stopReason==='error'?'failed':message?.stopReason==='aborted'?'interrupted':'completed'
      return
    }
    if(['agent_start','agent_end','turn_start','queue_update'].includes(type??''))return
    if(type)this.unknown(type)
  }
}
