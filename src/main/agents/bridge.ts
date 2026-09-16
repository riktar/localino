import { EventEmitter } from 'node:events'
import { access, copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, delimiter, isAbsolute } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { BridgeState } from '../../shared/agents'
import type { QuotaBucket } from '../../shared/contracts'
import { object } from './jsonl'

interface Config { enabled:boolean;generation:string;settingsPath:string;cachePath:string;hadPrevious:boolean;previous:unknown;installed:Record<string,unknown>;shell:string;shellKind:'bash'|'powershell' }
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const absent=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
const ps=(value:string)=>`'${value.replaceAll("'","''")}'`
const exists=async(path:string)=>{try{await access(path);return true}catch{return false}}
export async function updateBridgeSettings(helper:string,path:string,expected:string,statusLine:unknown):Promise<void> {
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(helper,['--settings-cas'],{windowsHide:true,stdio:['pipe','ignore','ignore']})
    const timer=setTimeout(()=>{child.kill();reject(Error('Aggiornamento impostazioni scaduto; nessuna transazione incompleta viene applicata.'))},5000)
    child.on('error',()=>{clearTimeout(timer);reject(Error('Helper impostazioni non disponibile.'))})
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error(code===2?'Impostazioni modificate contemporaneamente: nessuna sovrascrittura, riprova.':'Aggiornamento atomico non disponibile: verifica permessi, file occupato e volume NTFS locale. Nessuna modifica parziale applicata.'))})
    child.stdin.on('error',()=>{})
    child.stdin.end(JSON.stringify({path,expectedHash:createHash('sha256').update(expected,'utf8').digest('hex'),remove:statusLine===undefined,statusLine:statusLine??null}))
  })
}
async function atomic(path:string,value:unknown):Promise<void> {
  const temp=`${path}.${randomUUID()}.tmp`
  try {const file=await open(temp,'wx');try{await file.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await file.sync()}finally{await file.close()};await rename(temp,path)}
  finally{await unlink(temp).catch(()=>{})}
}
async function document(path:string,missing=false):Promise<{text:string;value:Record<string,unknown>}> {
  let text:string
  try{text=await readFile(path,'utf8')}catch(error){if(missing&&absent(error))return {text:'',value:{}};throw Error('File non accessibile.')}
  try{const value=object(JSON.parse(text.replace(/^\uFEFF/,'')));if(!value)throw Error();return {text,value}}catch{throw Error('JSON non valido: correggi il file prima di riprovare.')}
}
export function bridgeCommand(helper:string,config:string):string {
  // Encoded PowerShell is accepted by both official Windows dispatch shells.
  // Forward stdin/stdout as bytes, avoiding PowerShell pipeline transcoding.
  const script=`$p=New-Object System.Diagnostics.Process;$p.StartInfo.FileName=${ps(helper)};$p.StartInfo.Arguments=${ps('"'+config+'"')};$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.RedirectStandardInput=$true;$p.StartInfo.RedirectStandardOutput=$true;[void]$p.Start();$o=$p.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput());try{[Console]::OpenStandardInput().CopyTo($p.StandardInput.BaseStream)}catch{};$p.StandardInput.Close();$p.WaitForExit();[void]$o.GetAwaiter().GetResult();exit $p.ExitCode`
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`
}
async function previousShell():Promise<{shell:string;shellKind:'bash'|'powershell'}> {
  const configured=process.env.CLAUDE_CODE_GIT_BASH_PATH
  if(configured) {if(!isAbsolute(configured)||!await exists(configured))throw Error('CLAUDE_CODE_GIT_BASH_PATH non valido.');return {shell:configured,shellKind:'bash'}}
  for(const dir of (process.env.PATH??'').split(delimiter).filter(p=>isAbsolute(p))) {
    if(await exists(join(dir,'git.exe')))for(const path of [join(dir,'bash.exe'),join(dir,'..','bin','bash.exe')])if(await exists(path))return {shell:path,shellKind:'bash'}
  }
  for(const path of [join(process.env.ProgramFiles??'C:\\Program Files','Git','bin','bash.exe'),join(process.env.LOCALAPPDATA??'','Programs','Git','bin','bash.exe')])if(isAbsolute(path)&&await exists(path))return {shell:path,shellKind:'bash'}
  for(const dir of (process.env.PATH??'').split(delimiter).filter(p=>isAbsolute(p)))if(await exists(join(dir,'pwsh.exe')))return {shell:join(dir,'pwsh.exe'),shellKind:'powershell'}
  return {shell:join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),shellKind:'powershell'}
}

export class ClaudeBridge extends EventEmitter {
  state:BridgeState
  readonly configPath:string
  private config:Config|null=null
  private busy=false
  private reading=false
  private timer:ReturnType<typeof setInterval>|null=null
  constructor(private directory:string,settingsPath:string,private helperSource:string,private managedPaths:string[]=[]) {
    super();this.configPath=join(directory,'control.json')
    this.state={enabled:false,effective:false,error:null,sessionId:null,cost:null,receivedAt:null,settingsPath,quotas:{data:null,lastSuccessAt:null,refreshing:false,stale:false,error:null}}
  }
  async start():Promise<void> {
    try {
      if(await exists(this.configPath)) {
        const value=(await document(this.configPath)).value as unknown as Config
        if(typeof value.enabled!=='boolean'||typeof value.generation!=='string'||value.settingsPath!==this.state.settingsPath||value.cachePath!==join(this.directory,'snapshot.json')||!object(value.installed))throw Error('Configurazione bridge non valida. Ripristino automatico sospeso.')
        this.config=value;this.state.enabled=value.enabled
      }
    }catch(error){this.state.error=(error as Error).message}
    await this.refresh();this.timer=setInterval(()=>{void this.refresh()},250)
  }
  dispose():void {if(this.timer)clearInterval(this.timer);this.timer=null}
  private publish():void {this.emit('change',this.state)}
  private clear():void {this.state={...this.state,effective:false,sessionId:null,cost:null,receivedAt:null,quotas:{data:null,lastSuccessAt:null,refreshing:false,stale:false,error:null}}}
  async diagnose(project?:string):Promise<string> {
    const paths=[...this.managedPaths,...(project?[join(project,'.claude','settings.json'),join(project,'.claude','settings.local.json')]:[])]
    const overrides:string[]=[]
    for(const path of paths)if(await exists(path)) {
      try{if(Object.hasOwn((await document(path)).value,'statusLine'))overrides.push(path)}catch{overrides.push(`${path} (non leggibile o non valido)`)}
    }
    return overrides.length?`Override rilevato: ${overrides.join('; ')}. Localino non lo modifica. Verifica la fonte effettiva con /status in Claude.`:'Nessun override nei file esaminati. Policy remote, flag di avvio e altri progetti possono prevalere: verifica /status in Claude. Il collegamento Ã¨ confermato solo quando arriva un payload.'
  }
  async setEnabled(enabled:boolean):Promise<{ok:boolean;error?:string}> {
    if(this.busy)return {ok:false,error:'Operazione bridge in corso.'}
    this.busy=true;let gate:Awaited<ReturnType<typeof open>>|undefined
    try {
      if(this.state.error&&!this.config&&await exists(this.configPath))throw Error(this.state.error)
      await mkdir(this.directory,{recursive:true});await mkdir(dirname(this.state.settingsPath),{recursive:true})
      const deadline=Date.now()+500
      while(!gate){try{gate=await open(this.configPath+'.lock','a+')}catch(error){if(Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,20))}}
      if(!enabled&&this.config){this.config.enabled=false;this.config.generation=randomUUID();await atomic(this.configPath,this.config);this.state.enabled=false;this.clear();await unlink(this.config.cachePath).catch(error=>{if(!absent(error))throw error})}
      const settings=await document(this.state.settingsPath,true)
      if(enabled) {
        for(const path of this.managedPaths)if(await exists(path)&&Object.hasOwn((await document(path)).value,'statusLine'))throw Error(`Una policy gestita imposta statusLine in ${path}. Localino non la sovrascrive.`)
        if(this.config&&equal(settings.value.statusLine,this.config.installed)) {
          if(!this.config.enabled){await unlink(this.config.cachePath).catch(error=>{if(!absent(error))throw error});const next={...this.config,generation:randomUUID(),enabled:true};await atomic(this.configPath,next);this.config=next;this.state.enabled=true;this.state.error=null;this.clear()}
          return {ok:true}
        }
        if(this.config?.enabled) {
          if(!equal(settings.value.statusLine,this.config.installed))throw Error('statusLine Ã¨ stata modificata dopo il collegamento. Disattiva il bridge prima di configurarlo di nuovo.')
          return {ok:true}
        }
        const previous=settings.value.statusLine
        if(previous!==undefined&&(!object(previous)||object(previous)?.type!=='command'||typeof object(previous)?.command!=='string'))throw Error('statusLine precedente non supportata: nessuna modifica effettuata.')
        const helper=join(this.directory,'Localino.StatusLine.exe')
        await copyFile(this.helperSource,helper)
        const installed={...(object(previous)??{}),type:'command',command:bridgeCommand(helper,this.configPath)}
        const config:Config={enabled:false,generation:randomUUID(),settingsPath:this.state.settingsPath,cachePath:join(this.directory,'snapshot.json'),hadPrevious:previous!==undefined,previous:previous??null,installed,...await previousShell()}
        await atomic(this.configPath,config);this.config=config
        if((await document(this.state.settingsPath,true)).text!==settings.text)throw Error('Impostazioni cambiate durante il collegamento: riprova. Nessuna sovrascrittura effettuata.')
        await updateBridgeSettings(this.helperSource,this.state.settingsPath,settings.text,installed)
        await unlink(config.cachePath).catch(error=>{if(!absent(error))throw error})
        const next={...config,enabled:true};await atomic(this.configPath,next);this.config=next;this.state.enabled=true;this.state.error=null;this.clear()
      }else {
        const config=this.config
        if(!config){this.state.enabled=false;this.state.error=null;this.clear();return {ok:true}}
        config.enabled=false;await atomic(this.configPath,config);this.state.enabled=false;this.clear();await unlink(config.cachePath).catch(error=>{if(!absent(error))throw error})
        if(!equal(settings.value.statusLine,config.installed)) {
          if(equal(settings.value.statusLine,config.hadPrevious?config.previous:undefined)){this.state.error=null;return {ok:true}}
          throw Error('Raccolta disattivata. statusLine Ã¨ stata modificata: conservata la modifica utente, senza ripristinarla. Il backup della sola statusLine resta disponibile nella cartella bridge di Localino.')
        }
        const restored={...settings.value};if(config.hadPrevious)restored.statusLine=config.previous;else delete restored.statusLine
        if((await document(this.state.settingsPath,true)).text!==settings.text)throw Error('Raccolta disattivata, impostazioni cambiate durante il ripristino: riprova.')
        await updateBridgeSettings(this.helperSource,this.state.settingsPath,settings.text,restored.statusLine);this.state.error=null
      }
      return {ok:true}
    }catch(error){this.state.error=error instanceof Error?error.message:'Operazione bridge non riuscita.';return {ok:false,error:this.state.error}}
    finally{await gate?.close();this.busy=false;this.publish()}
  }
  async refresh(now=Date.now()):Promise<void> {
    if(this.busy||this.reading||!this.state.enabled||!this.config)return
    this.reading=true;const before=JSON.stringify(this.state),generation=this.config.generation
    try {
      const raw=object(JSON.parse(await readFile(this.config.cachePath,'utf8')))
      if(!raw||typeof raw.sessionId!=='string'||!raw.sessionId||raw.sessionId.length>256||typeof raw.receivedAt!=='number'||!Number.isSafeInteger(raw.receivedAt)||raw.receivedAt>now+1000||raw.receivedAt<0||!Array.isArray(raw.windows)||raw.windows.length>3)throw Error()
      const nullable=(n:unknown,max=Number.MAX_VALUE):number|null=>{if(n===null)return null;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)throw Error();return n}
      const buckets:QuotaBucket[]=[],seen=new Set<string>()
      for(const item of raw.windows) {
        const row=object(item),id=row?.id
        if(typeof id!=='string'||!['five_hour','seven_day','spend_limit'].includes(id)||seen.has(id))throw Error()
        seen.add(id);buckets.push({id,name:({five_hour:'5 ore',seven_day:'7 giorni',spend_limit:'Limite di spesa'} as Record<string,string>)[id],windows:[{kind:'primary',durationMins:id==='five_hour'?300:id==='seven_day'?10080:null,usedPercent:nullable(row?.usedPercent,id==='spend_limit'?Number.MAX_VALUE:100),resetsAt:nullable(row?.resetsAt,8.64e15)}]})
      }
      const cost=nullable(raw.cost),stale=now-raw.receivedAt>120000
      if(this.busy||!this.state.enabled||this.config.generation!==generation)return
      this.state={...this.state,effective:!stale,sessionId:raw.sessionId,cost,receivedAt:raw.receivedAt,quotas:{data:{buckets},lastSuccessAt:raw.receivedAt,refreshing:false,stale,error:null}}
    }catch(error) {
      if(this.busy||!this.state.enabled||this.config.generation!==generation)return
      if(!absent(error)){this.state.quotas={...this.state.quotas,error:'invalid',stale:!!this.state.receivedAt};this.state.effective=false}
      if(this.state.receivedAt!==null&&now-this.state.receivedAt>120000){this.state.quotas={...this.state.quotas,stale:true};this.state.effective=false}
    }finally{this.reading=false;if(before!==JSON.stringify(this.state))this.publish()}
  }
}
