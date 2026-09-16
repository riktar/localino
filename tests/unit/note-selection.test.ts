import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedText } from '../../src/shared/note-selection'
import type { NotesState } from '../../src/shared/notes'
test('copy snapshots reject missing/duplicate IDs and preserve complete text in deterministic newest order',()=>{
  const state:NotesState={path:'fixture',error:null,notes:[{id:'z',text:' older\r\n漢字 ',createdAt:1,updatedAt:99,completed:false},{id:'b',text:'B\n',createdAt:2,updatedAt:2,completed:true},{id:'a',text:'A 🌱',createdAt:2,updatedAt:2,completed:false}]}
  assert.deepEqual(selectedText(state,['z','b','a']),{ok:true,text:'A 🌱\nB\n\n older\r\n漢字 '})
  for(const ids of [[],['a','a'],['a','missing'],[null],'a'])assert.equal(selectedText(state,ids).ok,false)
  assert.equal(selectedText({...state,error:'corrupt'},['a']).ok,false)
})
