import { EventEmitter } from 'node:events'
import { readFile,writeFile,rename,unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { bindingsError,canonicalKey,defaultBindings,isCommand,type Binding,type CommandId,type ShortcutResult,type ShortcutState } from '../shared/commands'

interface Registrar {register:(key:string,callback:()=>void)=>boolean;unregister:(key:string)=>void}
export class Shortcuts extends EventEmitter {
  state:ShortcutState
  private registered=new Set<string>()
  private queue:Promise<unknown>=Promise.resolve()
  constructor(private file:string,private os:Registrar,private run:(id:CommandId)=>void,private platform=process.platform){super();this.state={bindings:defaultBindings(platform)}}
  private register(key:string):boolean {
    if(this.registered.has(key))return true
    try {if(!this.os.register(key,()=>{const b=this.state.bindings.find(b=>b.scope==='global'&&b.key===key&&b.active);if(b)this.run(b.id)}))return false}
    catch{return false}
    this.registered.add(key);return true
  }
  async init():Promise<void>{
    try {
      const raw=JSON.parse(await readFile(this.file,'utf8')) as {version?:unknown;bindings?:unknown}
      if((raw.version!==1&&raw.version!==2)||!Array.isArray(raw.bindings))throw Error('schema')
      const defaults=defaultBindings(this.platform)
      // Add known new commands without requiring old preference files to contain them.
      const additions=new Set(['selectCodex','selectClaude','selectPi','selectOpenCode'])
      const seen=new Set<string>()
      const bindings=raw.bindings.map((value:unknown)=>{
        if(!value||typeof value!=='object')throw Error('schema')
        const original=value as Binding;const legacy:Record<string,string>={home:'localino',consumi:'advancedUsage'};const b={...original,id:(raw.version===1?legacy[original.id]??original.id:original.id) as CommandId};const key=canonicalKey(b.key);const identity=`${b.id}:${b.scope}`
        if(key===null||!defaults.some(d=>d.id===b.id&&d.scope===b.scope)||seen.has(identity))throw Error('schema')
        seen.add(identity);return {id:b.id,scope:b.scope,key,active:false}
      })
      for(const added of defaults){
        if(seen.has(`${added.id}:${added.scope}`))continue
        if(!additions.has(added.id)&&!(added.id==='capture'&&added.scope==='global'))throw Error('schema')
        // Existing user assignments always win over introduced defaults.
        bindings.push({...added,key:bindings.some(b=>b.key===added.key)?'':added.key,active:false})
      }
      if(bindingsError(bindings))throw Error('collision')
      if(raw.version===1)await this.persist(bindings)
      this.state={bindings}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.state.error=`Preferences unreadable. File preserved: ${this.file}`}
    this.state.bindings=this.state.bindings.map(b=>{const active=!!b.key&&(b.scope==='local'||this.register(b.key));return {...b,active,...(b.key&&!active?{error:'Global shortcut unavailable: already in use.'}:{})}})
  }
  update(value:unknown):Promise<ShortcutResult>{
    const result=this.queue.then(()=>this.apply(value));this.queue=result.catch(()=>{});return result
  }
  private async apply(value:unknown):Promise<ShortcutResult>{
    const fail=(error:string):ShortcutResult=>({ok:false,error,state:this.state})
    if(this.state.error)return fail(this.state.error)
    if(!value||typeof value!=='object')return fail('Invalid request.')
    const request=value as {reset?:unknown;id?:unknown;scope?:unknown;key?:unknown}
    let next:Binding[]
    if(request.reset===true)next=defaultBindings(this.platform)
    else {
      const key=canonicalKey(request.key)
      if(!isCommand(request.id)||!this.state.bindings.some(b=>b.id===request.id&&b.scope===request.scope))return fail('Invalid command or scope.')
      if(key===null)return fail('Invalid shortcut. Use Ctrl+Alt+L, Cmd+Alt+L or F2.')
      next=this.state.bindings.map(b=>({...b,...(b.id===request.id&&b.scope===request.scope?{key}:{})}))
    }
    const invalid=bindingsError(next);if(invalid)return fail(invalid)
    const added:string[]=[]
    for(const b of next.filter(b=>b.scope==='global'&&b.key)){
      if(this.registered.has(b.key))continue
      if(request.reset!==true && !(request.id===b.id&&request.scope===b.scope) && this.state.bindings.some(old=>old.id===b.id&&old.scope===b.scope&&old.key===b.key&&!old.active))continue
      if(!this.register(b.key)){for(const key of added){this.os.unregister(key);this.registered.delete(key)}return fail(`Global shortcut unavailable (${b.key}): already in use. Previous binding kept.`)}
      added.push(b.key)
    }
    try{await this.persist(next)}
    catch{for(const key of added){this.os.unregister(key);this.registered.delete(key)}return fail('Could not save. Previous bindings kept.')}
    this.state={bindings:next.map(({id,scope,key})=>{const active=!!key&&(scope==='local'||this.registered.has(key));return {id,scope,key,active,...(key&&!active?{error:'Global shortcut unavailable: already in use.'}:{})}})}
    for(const key of this.registered){if(!next.some(b=>b.scope==='global'&&b.key===key)){this.os.unregister(key);this.registered.delete(key)}}
    this.emit('change',this.state);return {ok:true,state:this.state}
  }
  private async persist(bindings:Binding[]):Promise<void>{
    const temp=`${this.file}.${randomUUID()}.tmp`
    try{await writeFile(temp,JSON.stringify({version:2,bindings:bindings.map(({id,scope,key})=>({id,scope,key}))}),'utf8');await rename(temp,this.file)}
    catch(error){await unlink(temp).catch(()=>{});throw error}
  }
  dispose():void{for(const key of this.registered)this.os.unregister(key);this.registered.clear()}
}
