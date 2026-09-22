#!/usr/bin/env node
import readline from 'node:readline'

if(process.argv.includes('--version')){process.stdout.write('localino-session-fixture 1.0.0\n');process.exit(0)}
const codex=process.argv.includes('app-server'),pi=process.argv.includes('--mode')&&process.argv.includes('rpc'),claude=process.argv.includes('--input-format')
const claudeSession=process.argv[process.argv.indexOf('--session-id')+1]
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
const send=value=>process.stdout.write(`${JSON.stringify(value)}\n`)
let claudeTurn=0,codexTurn=0,pendingApproval,pendingInput
input.on('line',line=>{
  let value;try{value=JSON.parse(line)}catch{return}
  if(codex){
    if(value.method==='initialize')send({id:value.id,result:{userAgent:'fixture'}})
    else if(value.method==='thread/start')send({id:value.id,result:{thread:{id:'fixture-codex-thread'}}})
    else if(pendingInput&&value.id===pendingInput.id&&value.result?.answers){
      const pending=pendingInput;pendingInput=undefined
      const text=Object.values(value.result.answers).flatMap(answer=>answer.answers).join(' / ')
      send({method:'item/completed',params:{...pending.params,item:{id:`answer-${codexTurn}`,type:'agentMessage',text:`Answers: ${text}`,phase:'final'}}});send({method:'turn/completed',params:{...pending.params,turn:{id:pending.params.turnId,status:'completed'}}})
    }
    else if(pendingApproval&&value.id===pendingApproval.id&&value.result?.decision){
      const pending=pendingApproval;pendingApproval=undefined
      send({method:'item/completed',params:{...pending.params,item:{id:`answer-${codexTurn}`,type:'agentMessage',text:`Decision: ${value.result.decision}`,phase:'final'}}})
      send({method:'turn/completed',params:{...pending.params,turn:{id:pending.params.turnId,status:'completed'}}})
    }else if(value.method==='turn/start'){
      const turnId=`fixture-turn-${++codexTurn}`,params={threadId:'fixture-codex-thread',turnId}
      send({id:value.id,result:{turn:{id:turnId}}});send({method:'turn/started',params:{...params,turn:{id:turnId,startedAt:Date.now()/1000}}})
      if(value.params.input[0].text==='LOCALINO_APPROVAL_FIXTURE'){
        pendingApproval={id:9000+codexTurn,params};send({id:pendingApproval.id,method:'item/commandExecution/requestApproval',params:{...params,itemId:`command-${codexTurn}`,command:'fixture-safe-command',cwd:process.cwd(),reason:'Fixture requires one-time approval.',startedAtMs:Date.now()}})
      }else if(value.params.input[0].text==='LOCALINO_INPUT_FIXTURE'){
        pendingInput={id:`input-${codexTurn}`,params};send({id:pendingInput.id,method:'item/tool/requestUserInput',params:{...params,itemId:`tool-${codexTurn}`,isBlocking:true,questions:[{id:'mode',header:'Mode',question:'Choose a mode',options:[{label:'Safe',description:'Read only'},{label:'Fast',description:'Fewer checks'}]},{id:'note',header:'Note',question:'Add a note',options:null}]}})
      }else if(value.params.input[0].text==='LOCALINO_STREAM_FIXTURE'){
        let index=0,text='';const started=performance.now();process.stderr.write('PRIVATE_STDERR_AUTH_SENTINEL\n')
        const timer=setInterval(()=>{const target=Math.min(5000,Math.floor(performance.now()-started));while(index<target){
          const itemId=`answer-${Math.floor(index/100)}`,delta=`${'λ'.repeat(520)}🌍\nSEQ${String(index).padStart(6,'0')} AT${Date.now()}\n`
          if(index%100===0){text='';send({method:'item/started',params:{...params,item:{id:itemId,type:'agentMessage',text:''}}})}
          text+=delta;send({method:'item/agentMessage/delta',params:{...params,itemId,delta}})
          if(index%100===99)send({method:'item/completed',params:{...params,item:{id:itemId,type:'agentMessage',text,phase:'final'}}})
          index++
        }if(index===5000){clearInterval(timer);send({method:'turn/completed',params:{...params,turn:{id:turnId,status:'completed'}}})}},10)
      }else setTimeout(()=>{send({method:'item/completed',params:{...params,item:{id:`answer-${codexTurn}`,type:'agentMessage',text:'Model reply',phase:'final'}}});send({method:'turn/completed',params:{...params,turn:{id:turnId,status:'completed'}}})},150)
    }
  }else if(pi){
    if(value.type==='get_state')send({id:value.id,type:'response',command:'get_state',success:true,data:{sessionId:'fixture-pi-session'}})
    else if(value.type==='prompt'){const timestamp=Date.now();send({id:value.id,type:'response',command:'prompt',success:true});send({type:'agent_start'});send({type:'turn_start'});send({type:'message_start',message:{role:'user',content:value.message,timestamp}});setTimeout(()=>{send({type:'turn_end',message:{stopReason:'stop'}});send({type:'agent_settled'})},150)}
  }else if(claude&&value.type==='user'){
    const turn=claudeTurn++;send({type:'system',subtype:'init',session_id:claudeSession});send({type:'user',session_id:claudeSession,message:value.message});send({type:'assistant',session_id:claudeSession,message:{id:`fixture-message-${turn}`,role:'assistant',content:[]}});setTimeout(()=>send({type:'result',subtype:'success',is_error:false,session_id:claudeSession,uuid:`fixture-result-${turn}`}),150)
  }
})
input.on('close',()=>process.exit(0))
process.on('SIGTERM',()=>process.exit(0))
