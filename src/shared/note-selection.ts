import type { Note, NotesState } from './notes'
export const newestFirst = (a:Note,b:Note):number => b.createdAt-a.createdAt || (a.id<b.id?-1:a.id>b.id?1:0)
export function selectedText(state:NotesState, ids:unknown):{ok:true;text:string}|{ok:false;error:string} {
  if(state.error)return {ok:false,error:'Library unavailable. Reload and retry.'}
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)return {ok:false,error:'Invalid selection.'}
  const wanted=new Set(ids),notes=state.notes.filter(note=>wanted.has(note.id)).sort(newestFirst)
  if(notes.length!==wanted.size)return {ok:false,error:'A selected note is no longer available. Select again.'}
  return {ok:true,text:notes.map(note=>note.text).join('\n')}
}
