import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesStore } from '../../src/main/notes'

async function fixture(): Promise<{store:NotesStore;path:string}> {const directory=await mkdtemp(join(tmpdir(),'localino-notes-'));const path=join(directory,'notes.json');return {store:new NotesStore(path),path}}
test('Shared clients serialize overlapping creates, preserve exact Unicode and reopen durable mutations',async()=>{
  const {store,path}=await fixture();const text='  Riga uno 🌱\nRiga due è 漢字\r\n  '
  const results=await Promise.all(Array.from({length:15},(_,i)=>store.mutate({kind:'create',text:i===0?text:`Nota ${i}`})))
  assert.ok(results.every(r=>r.ok))
  const state=await store.get();assert.equal(state.notes.length,15)
  const original=state.notes.find(n=>n.text===text)!
  assert.ok(state.notes.every((n,i)=>i===0||n.createdAt<=state.notes[i-1].createdAt))
  const edited=await store.mutate({kind:'update',id:original.id,expectedUpdatedAt:original.updatedAt,text:text+'modifica'})
  assert.ok(edited.ok)
  assert.equal((await store.mutate({kind:'update',id:original.id,expectedUpdatedAt:original.updatedAt,text:'stale'})).ok,false)
  await store.mutate({kind:'complete',id:original.id,completed:true})
  const restarted=new NotesStore(path);const persisted=(await restarted.get()).notes.find(n=>n.id===original.id)!
  assert.equal(persisted.text,text+'modifica');assert.equal(persisted.completed,true);assert.equal(persisted.createdAt,original.createdAt)
  await restarted.mutate({kind:'complete',id:original.id,completed:false})
  await restarted.mutate({kind:'delete',id:original.id})
  assert.equal((await new NotesStore(path).get()).notes.some(n=>n.id===original.id),false)
})
test('Invalid input and oversized text never save or truncate; 100000 characters accepted',async()=>{
  const {store}=await fixture()
  for(const value of [null,{}, {kind:'create',text:2},{kind:'create',text:' \n\t'},{kind:'create',text:'x'.repeat(100001)},{kind:'delete',id:'missing'}]) assert.equal((await store.mutate(value)).ok,false)
  assert.equal((await store.get()).notes.length,0)
  assert.ok((await store.mutate({kind:'create',text:'è'.repeat(100000)})).ok)
  assert.equal((await store.get()).notes[0].text.length,100000)
})
test('Corrupt/future schema and duplicate IDs are preserved; recovery requires explicit reload',async()=>{
  for(const raw of ['{broken',JSON.stringify({version:2,notes:[]}),JSON.stringify({version:1,notes:[{id:'x',text:'one',createdAt:1,updatedAt:1,completed:false},{id:'x',text:'two',createdAt:2,updatedAt:2,completed:false}]})]) {
    const {store,path}=await fixture();await writeFile(path,raw)
    assert.ok((await store.get()).error?.includes(path))
    assert.equal((await store.mutate({kind:'create',text:'new'})).ok,false)
    assert.equal(await readFile(path,'utf8'),raw)
    await writeFile(path,JSON.stringify({version:1,notes:[]}))
    assert.ok((await store.get()).error)
    assert.equal((await store.reload()).error,null)
    assert.ok((await store.mutate({kind:'create',text:'recovered'})).ok)
  }
})
test('Write failure retains confirmed state and permits retry without a false success',async()=>{
  const {store,path}=await fixture();await store.get()
  await mkdir(path)
  const failure=await store.mutate({kind:'create',text:'recoverable'})
  assert.equal(failure.ok,false);assert.equal((await store.get()).notes.length,0)
  await rmdir(path)
  assert.ok((await store.mutate({kind:'create',text:'recoverable'})).ok)
  assert.equal((await new NotesStore(path).get()).notes[0].text,'recoverable')
})
