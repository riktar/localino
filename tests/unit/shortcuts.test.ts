import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,mkdir,rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Shortcuts } from '../../src/main/shortcuts'
import { canonicalKey,bindingsError,defaultBindings,keyFromEvent } from '../../src/shared/commands'
test('shortcut format, context collisions and editing combinations',()=>{
 assert.equal(canonicalKey('control+shift+r'),'Ctrl+Shift+R')
 for(const invalid of ['Win+R','Ctrl+Ctrl+N','a','Shift','Ctrl+Potato'])assert.equal(canonicalKey(invalid),null)
 assert.equal(canonicalKey(''),'');assert.equal(bindingsError(defaultBindings()),null)
 const bindings=defaultBindings();bindings.find(b=>b.id==='search')!.key='Ctrl+1';assert.match(bindingsError(bindings)!,/Collisione/)
 assert.equal(keyFromEvent({key:',',ctrlKey:true,altKey:false,shiftKey:false,metaKey:false}),'Ctrl+Comma')
})
test('global conflict rollback, persistence, disable, callbacks and disposal',async()=>{
 const file=join(await mkdtemp(join(tmpdir(),'localino-keys-')),'shortcuts.json')
 const callbacks=new Map<string,()=>void>();const invoked:string[]=[];const occupied=new Set(['Ctrl+Alt+O'])
 const os={register:(key:string,fn:()=>void)=>{if(occupied.has(key)||callbacks.has(key))return false;callbacks.set(key,fn);return true},unregister:(key:string)=>{callbacks.delete(key)}}
 const store=new Shortcuts(file,os,id=>invoked.push(id));await store.init()
 assert.equal(callbacks.size,3)
 assert.equal((await store.update({id:'home',scope:'global',key:'Ctrl+Alt+O'})).ok,false)
 assert.ok(callbacks.has('Ctrl+Alt+L'));callbacks.get('Ctrl+Alt+L')!();assert.deepEqual(invoked,['home'])
 assert.equal((await store.update({id:'home',scope:'global',key:'Ctrl+Alt+H'})).ok,true)
 assert.equal(callbacks.has('Ctrl+Alt+L'),false);callbacks.get('Ctrl+Alt+H')!();assert.equal(invoked.length,2)
 assert.equal((await store.update({id:'new',scope:'local',key:'Ctrl+Alt+H'})).ok,false)
 store.dispose();assert.equal(callbacks.size,0)
 const restarted=new Shortcuts(file,os,()=>{});await restarted.init();assert.ok(callbacks.has('Ctrl+Alt+H'))
 assert.equal((await restarted.update({id:'home',scope:'global',key:''})).ok,true);assert.equal(callbacks.has('Ctrl+Alt+H'),false)
 restarted.dispose()
})
test('startup occupied key isolated; bad files preserved; failed write restores old bindings',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'localino-keys-errors-'));const file=join(folder,'shortcuts.json')
 const keys=new Set<string>();const os={register:(k:string)=>{if(k==='Ctrl+Alt+L')return false;keys.add(k);return true},unregister:(k:string)=>{keys.delete(k)}}
 const store=new Shortcuts(file,os,()=>{});await store.init()
 assert.equal(store.state.bindings.find(b=>b.scope==='global'&&b.id==='home')!.active,false);assert.equal(keys.size,2)
 await mkdir(file)
 const result=await store.update({id:'clipboard',scope:'global',key:'Ctrl+Alt+H'})
 assert.equal(result.ok,false);assert.ok(keys.has('Ctrl+Alt+C'));assert.equal(keys.has('Ctrl+Alt+H'),false)
 store.dispose()
 await rename(file,file+'.directory');await writeFile(file,'{broken')
 const corrupt=new Shortcuts(file,os,()=>{});await corrupt.init();assert.ok(corrupt.state.error)
 assert.equal((await corrupt.update({reset:true})).ok,false);assert.equal(await readFile(file,'utf8'),'{broken');corrupt.dispose()
})
