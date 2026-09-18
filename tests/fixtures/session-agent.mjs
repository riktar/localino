#!/usr/bin/env node
import readline from 'node:readline'

if(process.argv.includes('--version')){process.stdout.write('localino-session-fixture 1.0.0\n');process.exit(0)}
const codex=process.argv.includes('app-server'),pi=process.argv.includes('--mode')&&process.argv.includes('rpc'),claude=process.argv.includes('--input-format')
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
const send=value=>process.stdout.write(`${JSON.stringify(value)}\n`)
input.on('line',line=>{
  let value;try{value=JSON.parse(line)}catch{return}
  if(codex){
    if(value.method==='initialize')send({id:value.id,result:{userAgent:'fixture'}})
    else if(value.method==='thread/start')send({id:value.id,result:{thread:{id:'fixture-codex-thread'}}})
    else if(value.method==='turn/start'){send({id:value.id,result:{turn:{id:'fixture-turn'}}});send({method:'turn/started',params:{threadId:'fixture-codex-thread',turn:{id:'fixture-turn',startedAt:Date.now()/1000}}});setTimeout(()=>send({method:'turn/completed',params:{threadId:'fixture-codex-thread',turn:{id:'fixture-turn',status:'completed'}}}),150)}
  }else if(pi){
    if(value.type==='get_state')send({id:value.id,type:'response',command:'get_state',success:true,data:{sessionId:'fixture-pi-session'}})
    else if(value.type==='prompt'){send({id:value.id,type:'response',command:'prompt',success:true});send({type:'agent_start'});setTimeout(()=>send({type:'agent_settled'}),150)}
  }else if(claude&&value.type==='user'){
    send({type:'system',subtype:'init',session_id:'fixture-claude-session'});send({type:'user',message:value.message});send({type:'assistant',message:{role:'assistant',content:[]}});setTimeout(()=>send({type:'result',subtype:'success',session_id:'fixture-claude-session'}),150)
  }
})
input.on('close',()=>process.exit(0))
process.on('SIGTERM',()=>process.exit(0))
