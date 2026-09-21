import { ProviderTranscript, array, contentText, id, object, observableArguments, string } from './provider-transcript'
import type { TranscriptKind, TranscriptOutcome } from '../../shared/transcript'

interface Block { itemId:string; kind:TranscriptKind; type:string; stopped:boolean; toolId?:string }
export class ClaudeTranscript extends ProviderTranscript {
  private deliveryId?:string
  private messageId?:string
  private readonly messages=new Set<string>()
  private readonly blocks=new Map<number,Block>()
  private readonly completedBlocks=new Set<string>()
  override beginDelivery(deliveryId:string):void {super.beginDelivery(deliveryId);this.deliveryId=deliveryId;this.messageId=undefined;this.blocks.clear()}
  protected record(value:Record<string,unknown>):void {
    const type=string(value.type)
    if(type==='control_request'){
      const request=object(value.request),requestId=id(value.request_id)
      if(!request||!requestId)throw Error('Invalid Claude control request.')
      this.emit(`request:${requestId}`,request.subtype==='can_use_tool'?'approval':'input','start',{text:[string(request.tool_name),observableArguments(request.input),string(request.decision_reason)].filter(Boolean).join('\n'),label:'Action required — unsupported in Localino'},this.deliveryId??null);return
    }
    if(value.session_id!==this.context.providerSessionId)return
    if(value.user_message_uuid!==undefined&&value.user_message_uuid!==this.deliveryId)return
    if(!this.deliveryId)return
    this.context={...this.context,turnId:this.deliveryId}
    // Nested messages have their own identity; preserve them explicitly without attributing their text to the parent assistant.
    if(value.parent_tool_use_id!==undefined&&value.parent_tool_use_id!==null){this.unknown(`subagent ${type??'event'}`);return}
    if(type==='user'){
      const message=object(value.message)
      for(const entry of array(message?.content)) {
        const block=object(entry),toolId=id(block?.tool_use_id)
        if(block?.type==='tool_result'&&toolId)this.emit(`${toolId}:output`,'output','snapshot',{text:contentText(block.content),outcome:block.is_error===true?'failed':'completed',label:'Tool result'})
      }
      return // User replay is the receipt for the already saved local prompt.
    }
    if(type==='stream_event'){
      const event=object(value.event)
      if(!event)throw Error('Invalid Claude stream event.')
      if(event.type==='message_start'){
        const message=object(event.message),messageId=id(message?.id)
        if(!messageId)throw Error('Claude message has no identity.')
        if(this.messages.has(messageId))return
        this.messages.add(messageId);this.messageId=messageId;this.blocks.clear();return
      }
      if(!this.messageId)return
      if(event.type==='content_block_start'){
        const index=event.index,content=object(event.content_block)
        if(!Number.isSafeInteger(index)||Number(index)<0||!content)throw Error('Invalid Claude content block.')
        if(this.blocks.has(Number(index)))return
        const block=this.createBlock(content,`${this.messageId}:${index}`)
        this.blocks.set(Number(index),block)
        this.emit(block.itemId,block.kind,'start',{text:block.kind==='tool'?observableArguments(content.input):block.type==='text'?this.requireText(content.text):block.type==='thinking'?this.requireText(content.thinking):'',label:block.kind==='tool'?`Tool ${string(content.name)??'unknown'}`:block.kind==='reasoning-summary'?'Published thinking':block.kind})
        return
      }
      if(event.type==='content_block_delta'){
        if(!Number.isSafeInteger(event.index)||Number(event.index)<0)throw Error('Invalid Claude block index.')
        const block=this.blocks.get(Number(event.index)),delta=object(event.delta)
        if(!block||block.stopped||!delta)return
        if(delta.type==='text_delta'&&block.type==='text')this.emit(block.itemId,'assistant','append',{text:this.requireText(delta.text)})
        else if(delta.type==='thinking_delta'&&block.type==='thinking')this.emit(block.itemId,'reasoning-summary','append',{text:this.requireText(delta.thinking),label:'Published thinking'})
        else if(delta.type==='input_json_delta')return // Do not persist arbitrary partial tool/auth arguments.
        else if(delta.type!=='signature_delta')this.unknown(String(delta.type))
        return
      }
      if(event.type==='content_block_stop'){const block=this.blocks.get(Number(event.index));if(block)block.stopped=true;return}
      if(event.type==='message_stop'||event.type==='message_delta'||event.type==='ping')return
      this.unknown(`Claude stream ${String(event.type)}`);return
    }
    if(type==='assistant'){
      const message=object(value.message),messageId=id(message?.id)
      if(!messageId)throw Error('Claude assistant message has no identity.')
      if(messageId!==this.messageId&&this.messages.has(messageId))return
      if(messageId!==this.messageId){this.messageId=messageId;this.messages.add(messageId);this.blocks.clear()}
      for(const [index,entry] of array(message?.content).entries()) {
        const content=object(entry);if(!content)throw Error('Invalid Claude completed block.')
        const toolId=id(content.id)
        const candidate=[...this.blocks.values()].find(block=>!this.completedBlocks.has(block.itemId)&&block.type===content.type&&(content.type!=='tool_use'||block.toolId===toolId))
        const block=candidate??this.createBlock(content,`${messageId}:complete:${id(value.uuid)??this.source}:${index}`)
        this.completedBlocks.add(block.itemId)
        const outcome:TranscriptOutcome=value.aborted===true?'interrupted':value.error?'failed':'completed'
        this.emit(block.itemId,block.kind,'snapshot',{text:content.type==='text'?this.requireText(content.text):content.type==='thinking'?this.requireText(content.thinking):observableArguments(content.input),outcome:content.type==='tool_use'?'streaming':outcome,label:content.type==='tool_use'?`Tool ${string(content.name)??'unknown'}`:block.kind==='reasoning-summary'?'Published thinking':block.kind})
      }
      return
    }
    if(type==='result'){
      if(!this.messageId&&typeof value.result==='string')this.emit(`result:${id(value.uuid)??this.source}`,'assistant','snapshot',{text:value.result,outcome:value.is_error===true?'failed':'completed'})
      const outcome=value.subtype==='success'&&value.is_error!==true?'completed':value.subtype==='interrupted'?'interrupted':'failed'
      this.finishTurn(outcome);this.deliveryId=undefined;this.messageId=undefined;this.blocks.clear();return
    }
    if(type==='system'){
      if(value.subtype==='init')return
      this.emit(`status:${this.source}`,'status','notice',{text:string(value.subtype)??'System event',outcome:'completed'});return
    }
    if(type==='tool_progress'){this.emit(`progress:${this.source}`,'output','notice',{text:`${string(value.tool_name)??'Tool'} in progress`,outcome:'completed'});return}
    if(type==='control_cancel_request')return
    if(type)this.unknown(type)
  }
  private createBlock(content:Record<string,unknown>,fallback:string):Block {
    const type=string(content.type)??'unknown',toolId=id(content.id)
    return {itemId:type==='tool_use'&&toolId?toolId:fallback,kind:type==='text'?'assistant':type==='thinking'?'reasoning-summary':type==='tool_use'?'tool':'unknown',type,toolId,stopped:false}
  }
}
