import test from 'node:test'
import assert from 'node:assert/strict'
import { CodexTranscript, type ProviderTranscript } from '../../src/main/sessions/provider-transcript'
import { ClaudeTranscript } from '../../src/main/sessions/claude-transcript'
import { PiTranscript } from '../../src/main/sessions/pi-transcript'
import { OpenCodeTranscript } from '../../src/main/sessions/opencode-transcript'
import { TranscriptPump } from '../../src/main/sessions/transcript-pump'
import { boundedJson, readProviderEvents } from '../../src/main/sessions/provider-http'
import { JsonlBuffer } from '../../src/main/sessions/supervisor'
import type { TranscriptInput } from '../../src/shared/transcript'

function fixture<T extends typeof ProviderTranscript>(Adapter:T,provider:TranscriptInput['provider']){
  const events:TranscriptInput[]=[]
  const adapter=new (Adapter as typeof CodexTranscript)('local-one',provider,batch=>events.push(...batch))
  adapter.beginDelivery('delivery-one')
  const ingest=(value:Record<string,unknown>,turnId='turn-one')=>adapter.ingest(value,{providerSessionId:'owned',turnId})
  const text=(item:string)=>{let result='';for(const event of events.filter(event=>event.itemId===item)){if(event.operation==='append')result+=event.text;else if(event.text!==undefined)result=event.text}return result}
  return {adapter,events,ingest,text}
}

test('Codex preserves delta/final, phase, summary, command/file/tool output and owned identities',()=>{
  const f=fixture(CodexTranscript,'codex')
  const send=(method:string,params:Record<string,unknown>)=>f.ingest({id:method==='item/tool/requestUserInput'?2:1,method,params:{threadId:'owned',turnId:'turn-one',...params}})
  send('item/started',{item:{id:'a',type:'agentMessage',text:'',phase:'commentary'}})
  for(const delta of ['λ','🌍','🌍'])send('item/agentMessage/delta',{itemId:'a',delta})
  send('item/agentMessage/delta',{threadId:'foreign',itemId:'a',delta:'FOREIGN'})
  send('item/agentMessage/delta',{turnId:'old',itemId:'a',delta:'STALE'})
  send('item/completed',{item:{id:'a',type:'agentMessage',text:'λ🌍🌍',phase:'final'}})
  send('item/agentMessage/delta',{itemId:'a',delta:'LATE'})
  send('item/reasoning/summaryTextDelta',{itemId:'r',summaryIndex:0,delta:'Public summary'})
  send('item/reasoning/textDelta',{itemId:'r',delta:'PRIVATE'})
  send('item/completed',{item:{id:'r',type:'reasoning',summary:['Public summary'],content:['PRIVATE']}})
  send('item/commandExecution/outputDelta',{itemId:'c',delta:'A'})
  send('item/completed',{item:{id:'c',type:'commandExecution',command:'read file',aggregatedOutput:'AB',status:'completed',env:{TOKEN:'PRIVATE'}}})
  send('item/completed',{item:{id:'f',type:'fileChange',changes:[{path:'a.txt',diff:'+line'}],status:'completed'}})
  send('item/completed',{item:{id:'t',type:'mcpToolCall',tool:'read',arguments:{path:'a.txt',authorization:'PRIVATE'},result:{content:[{type:'text',text:'Tool result'},{type:'image',data:'PRIVATE'}]}}})
  send('item/completed',{item:{id:'dynamic',type:'dynamicToolCall',tool:'read',arguments:{path:'a.txt'},contentItems:[{type:'inputText',text:'Dynamic λ'},{type:'inputImage',imageUrl:'PRIVATE'},{type:'inputText',text:'🌍 output'}],status:'completed',success:true}})
  send('item/commandExecution/requestApproval',{itemId:'c2',command:'read',reason:'Ask'})
  send('item/tool/requestUserInput',{itemId:'q',questions:[{question:'Choose'}]})
  send('turn/completed',{turn:{id:'turn-one',status:'completed'}})
  assert.equal(f.text('a'),'λ🌍🌍');assert.equal(f.text('c:output'),'AB');assert.equal(f.text('t:output'),'Tool result')
  assert.equal(f.text('dynamic:output'),'Dynamic λ🌍 output')
  assert.ok(f.events.some(event=>event.phase==='final'));assert.ok(f.events.some(event=>event.kind==='file'))
  assert.ok(f.events.some(event=>event.kind==='approval'));assert.ok(f.events.some(event=>event.kind==='input'))
  assert.equal(JSON.stringify(f.events).includes('PRIVATE'),false)
  assert.throws(()=>send('item/agentMessage/delta',{itemId:'invalid',delta:{auth:'secret'}}),/invalid text/)
})

test('Claude partial blocks and one-block assistant snapshots share identity without duplicating replay or result',()=>{
  const f=fixture(ClaudeTranscript,'claude');let sequence=0
  const send=(value:Record<string,unknown>)=>f.ingest({session_id:'owned',uuid:`e${++sequence}`,parent_tool_use_id:null,...value})
  const stream=(event:unknown)=>send({type:'stream_event',event})
  send({type:'user',message:{content:[{type:'text',text:'PROMPT REPLAY'}]}})
  stream({type:'message_start',message:{id:'m'}})
  for(const [index,text] of ['First λ','Second 🌍'].entries()){
    stream({type:'content_block_start',index,content_block:{type:'text',text:''}})
    stream({type:'content_block_delta',index,delta:{type:'text_delta',text}})
    stream({type:'content_block_stop',index})
    send({type:'assistant',message:{id:'m',content:[{type:'text',text}]}})
  }
  stream({type:'content_block_start',index:2,content_block:{type:'tool_use',id:'tool',name:'Read',input:{}}})
  stream({type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'PRIVATE'}})
  send({type:'assistant',message:{id:'m',content:[{type:'tool_use',id:'tool',name:'Read',input:{file_path:'a.txt',token:'PRIVATE'}}]}})
  send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool',content:'Tool result'}]}})
  const duplicate={type:'stream_event',uuid:'same',event:{type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'PRIVATE'}}};send(duplicate);send(duplicate)
  f.ingest({type:'control_request',request_id:'request',request:{subtype:'can_use_tool',tool_name:'Read',input:{file_path:'a.txt',auth:'PRIVATE'}}})
  send({type:'result',subtype:'success',result:'First λSecond 🌍'})
  assert.equal(f.text('m:0'),'First λ');assert.equal(f.text('m:1'),'Second 🌍');assert.equal(f.text('tool:output'),'Tool result')
  assert.equal(f.events.filter(event=>event.kind==='assistant'&&event.operation==='snapshot').length,2)
  assert.equal(JSON.stringify(f.events).includes('PRIVATE'),false);assert.equal(JSON.stringify(f.events).includes('PROMPT REPLAY'),false)
  assert.ok(f.events.some(event=>event.kind==='approval'))
  f.adapter.beginDelivery('delivery-two')
  send({type:'assistant',message:{id:'m',content:[{type:'text',text:'STALE REPLAY'}]}})
  assert.equal(JSON.stringify(f.events).includes('STALE REPLAY'),false)
})

test('Pi current RPC uses contentIndex and cumulative tool output; reused timestamps cannot contaminate a new turn',()=>{
  const f=fixture(PiTranscript,'pi'),send=f.ingest
  send({type:'message_start',message:{role:'assistant',timestamp:10}})
  const update=(event:unknown)=>send({type:'message_update',assistantMessageEvent:event})
  update({type:'text_start',contentIndex:0});update({type:'text_delta',contentIndex:0,delta:'λ'});update({type:'text_end',contentIndex:0,content:'λ🌍'})
  update({type:'thinking_start',contentIndex:1});update({type:'thinking_delta',contentIndex:1,delta:'Published'})
  update({type:'toolcall_start',contentIndex:2,id:'tool',toolName:'read'});update({type:'toolcall_delta',contentIndex:2,delta:'PRIVATE'})
  update({type:'toolcall_end',contentIndex:2,toolCall:{id:'tool',name:'read',arguments:{path:'a.txt',token:'PRIVATE'}}})
  send({type:'message_end',message:{role:'assistant',timestamp:10,content:[{type:'text',text:'λ🌍'},{type:'thinking',thinking:'Published',signature:'PRIVATE'},{type:'toolCall',id:'tool',name:'read',arguments:{path:'a.txt'}}]}})
  send({type:'tool_execution_start',toolCallId:'tool',toolName:'read',args:{path:'a.txt'}})
  for(const text of ['A','AB'])send({type:'tool_execution_update',toolCallId:'tool',partialResult:{content:[{type:'text',text}]}})
  send({type:'tool_execution_end',toolCallId:'tool',result:{content:[{type:'text',text:'ABC'}]}})
  send({type:'turn_end',message:{stopReason:'stop'}});send({type:'agent_settled'})
  assert.equal(f.text('10:0'),'λ🌍');assert.equal(f.text('tool:output'),'ABC');assert.equal(JSON.stringify(f.events).includes('PRIVATE'),false)
  f.adapter.beginDelivery('delivery-two');f.ingest({type:'message_start',message:{role:'assistant',timestamp:10}},'turn-two')
  f.ingest({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'STALE'}},'turn-two')
  assert.ok(f.events.some(event=>event.label==='Output gap'));assert.equal(JSON.stringify(f.events).includes('STALE'),false)
})

test('OpenCode fixture SDK 1.18.31 deduplicates source IDs and reconciles snapshots after a gap on the same session',()=>{
  const f=fixture(OpenCodeTranscript,'opencode'),adapter=f.adapter as OpenCodeTranscript;let n=0
  const send=(type:string,properties:Record<string,unknown>,source?:string)=>f.ingest({id:source??`e${++n}`,type,properties:{sessionID:'owned',...properties}})
  send('message.updated',{info:{sessionID:'owned',id:'u',role:'user'}})
  send('message.part.updated',{part:{sessionID:'owned',messageID:'u',id:'user-part',type:'text',text:'REPLAY'}})
  send('message.updated',{info:{sessionID:'owned',id:'a',role:'assistant',parentID:'delivery-one'}})
  send('session.status',{status:{type:'busy'}})
  const part={sessionID:'owned',messageID:'a',id:'p',type:'text',text:''}
  send('message.part.updated',{part})
  send('message.part.delta',{messageID:'a',partID:'p',field:'text',delta:'λ'},'dup')
  send('message.part.delta',{messageID:'a',partID:'p',field:'text',delta:'λ'},'dup')
  assert.equal(f.text('p'),'λ')
  adapter.disconnected()
  adapter.reconcile([{info:{sessionID:'owned',id:'a',role:'assistant',parentID:'delivery-one'},parts:[{...part,text:'λ🌍'}]}],{providerSessionId:'owned'})
  send('message.part.delta',{messageID:'a',partID:'p',field:'text',delta:'QUEUED'})
  send('message.part.updated',{part:{...part,text:'λ🌍 final',time:{end:20}}})
  send('message.part.updated',{part:{sessionID:'owned',messageID:'a',id:'tool',type:'tool',tool:'read',state:{status:'completed',input:{path:'a',token:'PRIVATE'},output:'Read result',metadata:{auth:'PRIVATE'}}}})
  send('message.part.delta',{sessionID:'foreign',messageID:'a',partID:'p',field:'text',delta:'FOREIGN'})
  send('session.status',{status:{type:'idle'}})
  assert.equal(f.text('p'),'λ🌍 final');assert.equal(f.text('tool:output'),'Read result');assert.equal(adapter.settled,true)
  assert.equal(f.events.findLast(event=>event.itemId==='p')?.outcome,'unknown')
  for(const denied of ['PRIVATE','REPLAY','FOREIGN','QUEUED'])assert.equal(JSON.stringify(f.events).includes(denied),false)
})

test('SSE parser handles split Unicode, multiline data, malformed and oversized HTTP/event bodies',async()=>{
  const parser=new JsonlBuffer(),lines:string[]=[]
  for(const byte of Buffer.from('{"text":"λ🌍"}\n'))parser.push(Buffer.of(byte),line=>lines.push(line))
  parser.end(line=>lines.push(line));assert.deepEqual(lines,['{"text":"λ🌍"}'])
  assert.throws(()=>new JsonlBuffer().push(Buffer.of(0xff),()=>{}),/encoded data/)
  const bytes=Buffer.from('data: {"type":"test",\r\ndata: "text":"λ🌍"}\r\n\r\n'),events:unknown[]=[]
  const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close()}})
  await readProviderEvents(new Response(stream,{headers:{'content-type':'text/event-stream'}}),event=>events.push(event))
  assert.deepEqual(events,[{type:'test',text:'λ🌍'}])
  await assert.rejects(()=>readProviderEvents(new Response('data: nope\n\n',{headers:{'content-type':'text/event-stream'}}),()=>{}))
  await assert.rejects(()=>readProviderEvents(new Response(`data: ${'a'.repeat(2*1024*1024+1)}`,{headers:{'content-type':'text/event-stream'}}),()=>{}),/Oversized/)
  await assert.rejects(()=>boundedJson(new Response(JSON.stringify({text:'a'.repeat(200)})),100),/Oversized/)
  for(const invalid of [Buffer.concat([Buffer.from('{"text":"'),Buffer.of(0xff),Buffer.from('"}')]),Buffer.concat([Buffer.from('{"text":"'),Buffer.of(0xf0,0x9f)])])await assert.rejects(()=>boundedJson(new Response(invalid)),/encoded data/)
  const valid=new ReadableStream({start(controller){for(const byte of Buffer.from('{"text":"λ🌍"}'))controller.enqueue(Uint8Array.of(byte));controller.close()}})
  assert.deepEqual(await boundedJson(new Response(valid)),{text:'λ🌍'})
})

test('transcript pump batches ordered output, bounds pending bytes, and exposes storage failure',async()=>{
  const calls:TranscriptInput[][]=[],errors:string[]=[]
  const pump=new TranscriptPump({append:async events=>{calls.push(events);return []}},message=>errors.push(message))
  const input=(i:number):TranscriptInput=>({eventId:String(i),sessionId:'s',provider:'codex',providerSessionId:'p',turnId:'t',itemId:'a',kind:'assistant',operation:'append',text:'λ',offset:i})
  for(let i=0;i<1000;i++)pump.push([input(i)])
  await pump.flush();assert.equal(calls.length,8);assert.deepEqual(calls.flat().map(event=>event.eventId),Array.from({length:1000},(_,i)=>String(i)));assert.deepEqual(errors,[])
  const failed=new TranscriptPump({append:async()=>{throw Error('PRIVATE disk path')}},message=>errors.push(message));failed.push([input(0)]);await failed.flush()
  assert.match(errors[0],/storage failed/);assert.equal(errors[0].includes('PRIVATE'),false)
  const full=new TranscriptPump({append:async()=>[]},message=>errors.push(message));full.push([{...input(0),text:'a'.repeat(9*1024*1024)}]);assert.match(errors[1],/queue is full/)
})
