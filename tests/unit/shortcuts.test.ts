import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,mkdir,rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Shortcuts } from '../../src/main/shortcuts'
import { canonicalKey,bindingsError,defaultBindings,keyFromEvent } from '../../src/shared/commands'

test('Mac defaults, Meta events and repeatable legacy migration preserve custom and disabled assignments',async()=>{
 assert.equal(defaultBindings('darwin').find(b=>b.id==='copy')?.key,'Cmd+C')
 assert.equal(canonicalKey('command+shift+r'),'Cmd+Shift+R')
 assert.equal(keyFromEvent({key:'c',ctrlKey:false,altKey:false,shiftKey:false,metaKey:true}),'Cmd+C')
 const reserved=defaultBindings('darwin');reserved.find(b=>b.id==='localino'&&b.scope==='global')!.key='Cmd+C'
 assert.match(bindingsError(reserved)!,/Reserved/)
 const file=join(await mkdtemp(join(tmpdir(),'localino-migration-')),'shortcuts.json')
 const legacy=defaultBindings().map(b=>({...b,id:b.id==='localino'?'home':b.id==='advancedUsage'?'consumi':b.id,key:b.id==='clipboard'&&b.scope==='local'?'':b.key}))
 legacy.find(b=>b.id==='home'&&b.scope==='local')!.key='Ctrl+J'
 legacy.find(b=>b.id==='panel')!.key='Ctrl+Alt+H'
 await writeFile(file,JSON.stringify({version:1,bindings:legacy}))
 const os={register:()=>true,unregister:()=>{}}
 const store=new Shortcuts(file,os,()=>{},'darwin');await store.init()
 assert.equal(store.state.error,undefined)
 assert.equal(store.state.bindings.find(b=>b.id==='clipboard'&&b.scope==='local')?.key,'')
 assert.equal(store.state.bindings.find(b=>b.id==='localino'&&b.scope==='local')?.key,'Ctrl+J')
 assert.equal(store.state.bindings.find(b=>b.id==='panel')?.key,'Ctrl+Alt+H')
 const saved=await readFile(file,'utf8');assert.equal(JSON.parse(saved).version,2)
 store.dispose();const again=new Shortcuts(file,os,()=>{},'darwin');await again.init()
 assert.equal(await readFile(file,'utf8'),saved)
 assert.equal((await again.update({reset:true})).ok,true)
 assert.equal(again.state.bindings.find(b=>b.id==='new')?.key,'Cmd+N');again.dispose()
})

test('agent command migration preserves old bindings and adds unassigned local/global selections',async()=>{
 const file=join(await mkdtemp(join(tmpdir(),'localino-agent-keys-')),'shortcuts.json')
 const old=defaultBindings().filter(b=>!b.id.startsWith('select'))
 old.find(b=>b.id==='localino'&&b.scope==='global')!.key='Ctrl+Alt+H'
 await writeFile(file,JSON.stringify({version:1,bindings:old.map(b=>({...b,id:b.id==='localino'?'home':b.id==='advancedUsage'?'consumi':b.id}))}))
 const store=new Shortcuts(file,{register:()=>true,unregister:()=>{}},()=>{},'win32')
 await store.init()
 assert.equal(store.state.error,undefined)
 assert.equal(store.state.bindings.find(b=>b.id==='localino'&&b.scope==='global')!.key,'Ctrl+Alt+H')
 const added=store.state.bindings.filter(b=>b.id.startsWith('select'))
 assert.equal(added.length,8);assert.ok(added.every(b=>b.key===''))
 store.dispose()
})
test('shortcut format, context collisions and editing combinations',()=>{
 assert.equal(canonicalKey('control+shift+r'),'Ctrl+Shift+R')
 for(const invalid of ['Win+R','Ctrl+Ctrl+N','a','Shift','Ctrl+Potato'])assert.equal(canonicalKey(invalid),null)
 assert.equal(canonicalKey(''),'');assert.equal(bindingsError(defaultBindings()),null)
 const bindings=defaultBindings();bindings.find(b=>b.id==='search')!.key='Ctrl+1';assert.match(bindingsError(bindings)!,/Conflicts/)
 assert.equal(keyFromEvent({key:',',ctrlKey:true,altKey:false,shiftKey:false,metaKey:false}),'Ctrl+Comma')
 for(const [key,code,shiftKey,expected] of [[' ','Space',false,'Ctrl+Space'],['ArrowLeft','ArrowLeft',false,'Ctrl+Left'],['!','Digit1',true,'Ctrl+Shift+1']] as const){assert.equal(keyFromEvent({key,code,shiftKey,ctrlKey:true,altKey:false,metaKey:false}),expected)}
})
test('all supported key names match their browser events, including shifted punctuation',()=>{
 const keys=[...Array.from({length:26},(_,i)=>[String.fromCharCode(65+i),String.fromCharCode(97+i),'Key'+String.fromCharCode(65+i)]),...Array.from({length:10},(_,i)=>[String(i),String(i),'Digit'+i]),...Array.from({length:24},(_,i)=>['F'+(i+1),'F'+(i+1),'F'+(i+1)]),...['Enter','Escape','Delete','Backspace','Tab','Home','End','PageUp','PageDown'].map(k=>[k,k,k]),['Space',' ','Space'],...['Left','Right','Up','Down'].map(k=>[k,'Arrow'+k,'Arrow'+k]),['Comma',',','Comma'],['Period','.','Period']]
 for(const [name,key,code] of keys)for(const shiftKey of [false,true]){
  const actualKey=shiftKey?(name==='Comma'?'<':name==='Period'?'>':/^[0-9]$/.test(name)?')!@#$%^&*('[Number(name)]:key):key
  const expected='Ctrl+'+(shiftKey?'Shift+':'')+name
  assert.equal(canonicalKey(expected),expected)
  assert.equal(keyFromEvent({key:actualKey,code,shiftKey,ctrlKey:true,altKey:false,metaKey:false}),expected,expected)
 }
})
test('global conflict rollback, persistence, disable, callbacks and disposal',async()=>{
 const file=join(await mkdtemp(join(tmpdir(),'localino-keys-')),'shortcuts.json')
 const callbacks=new Map<string,()=>void>();const invoked:string[]=[];const occupied=new Set(['Ctrl+Alt+O'])
 const os={register:(key:string,fn:()=>void)=>{if(occupied.has(key)||callbacks.has(key))return false;callbacks.set(key,fn);return true},unregister:(key:string)=>{callbacks.delete(key)}}
 const store=new Shortcuts(file,os,id=>invoked.push(id),'win32');await store.init()
 assert.equal(callbacks.size,4)
 assert.equal((await store.update({id:'localino',scope:'global',key:'Ctrl+Alt+O'})).ok,false)
 assert.ok(callbacks.has('Ctrl+Alt+L'));callbacks.get('Ctrl+Alt+L')!();assert.deepEqual(invoked,['localino'])
 assert.equal((await store.update({id:'localino',scope:'global',key:'Ctrl+Alt+H'})).ok,true)
 assert.equal(callbacks.has('Ctrl+Alt+L'),false);callbacks.get('Ctrl+Alt+H')!();assert.equal(invoked.length,2)
 assert.equal((await store.update({id:'new',scope:'local',key:'Ctrl+Alt+H'})).ok,false)
 store.dispose();assert.equal(callbacks.size,0)
 const restarted=new Shortcuts(file,os,()=>{},'win32');await restarted.init();assert.ok(callbacks.has('Ctrl+Alt+H'))
 assert.equal((await restarted.update({id:'localino',scope:'global',key:''})).ok,true);assert.equal(callbacks.has('Ctrl+Alt+H'),false)
 restarted.dispose()
})
test('startup occupied key isolated; bad files preserved; failed write restores old bindings',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'localino-keys-errors-'));const file=join(folder,'shortcuts.json')
 const keys=new Set<string>();const os={register:(k:string)=>{if(k==='Ctrl+Alt+L')return false;keys.add(k);return true},unregister:(k:string)=>{keys.delete(k)}}
 const store=new Shortcuts(file,os,()=>{},'win32');await store.init()
 assert.equal(store.state.bindings.find(b=>b.scope==='global'&&b.id==='localino')!.active,false);assert.equal(keys.size,3)
 await mkdir(file)
 const result=await store.update({id:'clipboard',scope:'global',key:'Ctrl+Alt+H'})
 assert.equal(result.ok,false);assert.ok(keys.has('Ctrl+Alt+C'));assert.equal(keys.has('Ctrl+Alt+H'),false)
 store.dispose()
 await rename(file,file+'.directory');await writeFile(file,'{broken')
 const corrupt=new Shortcuts(file,os,()=>{},'win32');await corrupt.init();assert.ok(corrupt.state.error)
 assert.equal((await corrupt.update({reset:true})).ok,false);assert.equal(await readFile(file,'utf8'),'{broken');corrupt.dispose()
})


test('Mac Option shortcuts handle symbols and dead keys without changing ordinary layout letters',()=>{
 for(const [key,code,expected] of [['¬','KeyL','Cmd+Alt+L'],['Dead','KeyN','Cmd+Alt+N'],['x','KeyY','Cmd+Alt+X']]){
  assert.equal(keyFromEvent({key,code,metaKey:true,altKey:true,ctrlKey:false,shiftKey:false},'darwin'),expected)
 }
})

test('native punctuation accelerators register, roll back and unregister correctly',async()=>{
 const file=join(await mkdtemp(join(tmpdir(),'localino-punctuation-')),'shortcuts.json')
 const callbacks=new Map<string,()=>void>(),invoked:string[]=[]
 const os={register:(key:string,fn:()=>void)=>{if(key==='Cmd+Alt+.'||callbacks.has(key))return false;callbacks.set(key,fn);return true},unregister:(key:string)=>{callbacks.delete(key)}}
 const store=new Shortcuts(file,os,id=>invoked.push(id),'darwin');await store.init()
 try {
  assert.equal((await store.update({id:'localino',scope:'global',key:'Cmd+Alt+Comma'})).ok,true)
  callbacks.get('Cmd+Alt+,')!();assert.deepEqual(invoked,['localino'])
  assert.equal((await store.update({id:'localino',scope:'global',key:'Cmd+Alt+Period'})).ok,false)
  assert.ok(callbacks.has('Cmd+Alt+,'));assert.equal(callbacks.has('Cmd+Alt+Comma'),false)
 }finally{store.dispose()}
 assert.equal(callbacks.size,0)
})
