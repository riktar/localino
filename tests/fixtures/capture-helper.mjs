#!/usr/bin/env node
// Test-only protocol fixture; never installs a hook or reads another application.
import {createInterface} from 'node:readline'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
if(process.argv[2]==='--focus'){process.stdout.write('focused\n');process.exit(0)}
const send=value=>process.stdout.write(JSON.stringify(value)+'\n')
let active=false,id=0;send({type:'ready'})
createInterface({input:process.stdin}).on('line',line=>{
  if(line==='enable'||line==='disable')send({type:'status',enabled:line==='enable',error:''})
  else if(line==='capture'){
    if(active){send({type:'raise'});return}active=true;id++;send({type:'begin',id})
    let empty=false;try{empty=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'mode.txt'),'utf8')==='empty'}catch{}
    send({type:'result',id,text:empty?'':'Prova Localino 🌱\nSeconda riga è 漢字',reason:empty?'empty':'ok',ms:5})
  }else if(line.startsWith('visible:'))send({type:'timing',id,ms:42})
  else if(line==='cancel'||line==='finish')active=false
}).on('close',()=>process.exit(0))
