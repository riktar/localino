import { useCallback,useEffect,useMemo,useRef,useState,type RefObject } from 'react'
import { ArrowLeft,Check,Copy,Ellipsis,Filter,Plus,Search,SquarePen,Trash2,Undo2 } from 'lucide-react'
import { Button } from './ui/button'
import { useConfirm } from './confirm-dialog'
import { NOTE_LIMIT,textError,type Note,type NotesState } from '../../../shared/notes'
import { newestFirst } from '../../../shared/note-selection'
import { useCommands } from './commands'
import type { CapturedNote } from '../../../shared/capture'

export type LeaveGuard=()=>Promise<boolean>
export function Clipboard({captured,guard,newRequest=0,consumeNew=()=>{},active=true,onAvailability,openList,dismiss}:{captured?:CapturedNote|null;guard:RefObject<LeaveGuard|null>;newRequest?:number;consumeNew?:()=>void;active?:boolean;onAvailability?:(reason:string|undefined)=>void;openList?:RefObject<(()=>Promise<void>)|null>;dismiss?:RefObject<(()=>Promise<void>)|null>}):React.JSX.Element {
  const [state,setState]=useState<NotesState|null>(null),[filter,setFilter]=useState('open'),[query,setQuery]=useState(''),[search,setSearch]=useState(false)
  const [selected,setSelected]=useState<string[]>([]),[focused,setFocused]=useState<string|null>(null),[detail,setDetail]=useState<string|null>(null)
  const [editor,setEditor]=useState<{id:string|null;original:string;updatedAt:number}|null>(null),[draft,setDraft]=useState(''),[suspended,setSuspended]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[menu,setMenu]=useState(false)
  const textArea=useRef<HTMLTextAreaElement>(null),searchInput=useRef<HTMLInputElement>(null),saving=useRef(false),consumedCapture=useRef(0)
  const {ask,dialog}=useConfirm(),dirty=!!editor&&draft!==editor.original
  useEffect(()=>{let updated=false,disposed=false;const off=window.localino.onNotes(next=>{updated=true;setState(next)});void window.localino.getNotes().then(next=>{if(!updated&&!disposed)setState(next)});return()=>{disposed=true;off()}},[])
  useEffect(()=>{window.localino.setUnsaved(dirty);return()=>window.localino.setUnsaved(false)},[dirty])
  const notes=useMemo(()=>(state?.notes??[]).filter(note=>(filter==='all'||note.completed===(filter==='completed'))&&note.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort(newestFirst),[state,filter,query])
  useEffect(()=>{setSelected(previous=>previous.filter(id=>notes.some(note=>note.id===id)))},[notes])
  const changeQuery=(value:string)=>{setQuery(value);setSelected([])},changeFilter=(value:string)=>{setFilter(value);setSelected([])}
  const focusedNote=state?.notes.find(note=>note.id===focused),detailNote=state?.notes.find(note=>note.id===detail)
  useEffect(()=>{
    if(busy||!captured||captured.sequence===consumedCapture.current||!state?.notes.some(note=>note.id===captured.noteId))return
    consumedCapture.current=captured.sequence;setQuery('');setFilter('open');setSelected([captured.noteId]);setFocused(captured.noteId);setDetail(captured.noteId);setError('');setMessage('Captured.')
    if(editor&&dirty)setSuspended(true);else{setEditor(null);setSuspended(false)}
  },[captured,state,busy,editor,dirty])
  useEffect(()=>{
    if(!captured||detail!==captured.noteId||(editor&&!suspended))return
    let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{document.querySelector<HTMLElement>('[data-note-text]')?.focus();void window.localino.capturedNotePresented(captured.sequence)})})
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)}
  },[captured?.sequence,detail,editor,suspended])
  const save=useCallback(async():Promise<boolean>=>{
    if(!editor||saving.current)return false
    const invalid=textError(draft);if(invalid){setError(invalid);textArea.current?.focus();return false}
    saving.current=true;setBusy(true);setError('')
    try{const result=await window.localino.mutateNote(editor.id?{kind:'update',id:editor.id,text:draft,expectedUpdatedAt:editor.updatedAt}:{kind:'create',text:draft});if(!result.ok){setError(result.error);return false}
      const id=editor.id??result.state.notes[0].id;setState(result.state);setFocused(id);setEditor(null);setSuspended(false);setDetail(null);window.localino.setUnsaved(false);setMessage('Saved.');return true
    }catch{setError('Could not save. Your draft is safe.');return false}finally{saving.current=false;setBusy(false)}
  },[editor,draft])
  const canLeave=useCallback(async():Promise<boolean>=>{
    if(busy||saving.current)return false
    if(!dirty)return true
    const answer=await ask('Keep your changes?','This note has unsaved changes.',['Save','Discard','Stay'])
    if(answer===0)return save()
    if(answer===1){setEditor(null);setSuspended(false);window.localino.setUnsaved(false);return true}
    setSuspended(false);requestAnimationFrame(()=>textArea.current?.focus());return false
  },[busy,dirty,ask,save])
  useEffect(()=>{guard.current=canLeave;return()=>{guard.current=null}},[guard,canLeave])
  const begin=async(note?:Note)=>{if(!state||state.error||busy||!await canLeave())return;setError('');setMessage('');setSuspended(false);setDetail(null);setDraft(note?.text??'');setEditor({id:note?.id??null,original:note?.text??'',updatedAt:note?.updatedAt??0});requestAnimationFrame(()=>textArea.current?.focus())}
  const closeEditor=async()=>{if(await canLeave()){setEditor(null);setDetail(null)}}
  useEffect(()=>{if(!openList)return;openList.current=async()=>{if(!await canLeave())return;setEditor(null);setSuspended(false);setDetail(null);requestAnimationFrame(()=>(document.querySelector<HTMLElement>('[data-note-id] input')??document.querySelector<HTMLElement>('[data-clipboard] button[aria-label="New note"]'))?.focus())};return()=>{openList.current=null}},[openList,canLeave])
  const copy=async()=>{const result=await window.localino.copyNotes(selected);if(result.ok){setMessage('Copied.');setError('')}else{setError(result.error??'Could not copy. Retry.');setMessage('')}setMenu(false)}
  const mutate=async(note:Note,kind:'complete'|'delete')=>{
    if(busy||saving.current)return
    if(kind==='delete'&&await ask('Delete this note?','This cannot be undone.',['Delete','Cancel'])!==0)return
    setBusy(true);setError('')
    try{const result=await window.localino.mutateNote(kind==='delete'?{kind,id:note.id}:{kind,id:note.id,completed:!note.completed});if(result.ok){setState(result.state);if(kind==='delete'&&detail===note.id)setDetail(null);setMessage(kind==='delete'?'Deleted.':note.completed?'Reopened.':'Completed.')}else setError(result.error)}catch{setError('Could not update note. Retry.')}finally{setBusy(false)}
  }
  const newAction=useRef(()=>{});newAction.current=()=>{consumeNew();void begin()}
  useEffect(()=>{if(newRequest&&state)newAction.current()},[newRequest,state])
  const editing=!!editor&&!suspended,unavailable=!active?'Open Clipboard first.':!state||state.error?'Library unavailable.':busy?'Working…':undefined
  useEffect(()=>{onAvailability?.(!state||state.error?'Library unavailable.':busy?'Working...':undefined)},[state,busy,onAvailability])
  useEffect(()=>{if(!dismiss)return;dismiss.current=editing||detailNote?closeEditor:null;return()=>{dismiss.current=null}})
  const listDisabled=unavailable??(editing?'Close the editor first.':undefined)
  useCommands({search:{run:()=>{setSearch(true);requestAnimationFrame(()=>searchInput.current?.focus())},disabled:unavailable},
    edit:{run:()=>begin(focusedNote),disabled:listDisabled??(!focusedNote?'Focus a note.':undefined)},copy:{run:copy,disabled:listDisabled??(!selected.length?'Select notes.':undefined)},
    complete:{run:()=>focusedNote&&mutate(focusedNote,'complete'),disabled:listDisabled??(!focusedNote?'Focus a note.':undefined)},delete:{run:()=>focusedNote&&mutate(focusedNote,'delete'),disabled:listDisabled??(!focusedNote?'Focus a note.':undefined)},
    save:{run:save,disabled:unavailable??(!editing?'Open the editor.':undefined)},closeEditor:{run:closeEditor,disabled:unavailable??(!editing?'Open the editor.':undefined)},
    notesReload:{run:()=>window.localino.reloadNotes().then(setState),disabled:!active?'Open Clipboard first.':!state?.error?'Library available.':undefined},
    notesOpen:{run:()=>changeFilter('open'),disabled:unavailable},notesCompleted:{run:()=>changeFilter('completed'),disabled:unavailable},notesAll:{run:()=>changeFilter('all'),disabled:unavailable},
  })
  const openMenu=(id?:string)=>{if(id&&!selected.includes(id))setSelected([id]);if(id||selected.length)setMenu(true)}
  return <main className="clipboard" data-clipboard onCopy={event=>{
    if(!active||editing||detail||!selected.length||(event.target as HTMLElement).closest('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]'))return
    event.preventDefault();void copy()
  }}>
    <header className="flex shrink-0 items-center gap-1"><h2 className="mr-auto text-sm font-semibold">Clipboard</h2>
      <Button size="icon" variant="ghost" aria-label="Search and filter" title="Search and filter" onClick={()=>{setSearch(value=>!value);requestAnimationFrame(()=>searchInput.current?.focus())}}><Search/></Button>
      <Button size="icon" variant="ghost" aria-label="Selection actions" title="Selection actions" disabled={!selected.length||editing} onClick={()=>openMenu()}><Ellipsis/></Button>
      <Button size="icon" variant="ghost" aria-label="New note" title="New note" disabled={!!unavailable} onClick={()=>void begin()}><Plus/></Button>
    </header>
    {state?.error&&<div role="alert" className="text-sm text-destructive">Library unavailable.<Button size="sm" variant="outline" onClick={()=>void window.localino.reloadNotes().then(setState)}>Retry</Button><details><summary>Details</summary><p className="break-all">{state.error}</p></details></div>}
    {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {message&&<p role="status" className="text-xs text-muted-foreground">{message}{captured?.focusFailed?' Open Localino from the menu bar.':''}</p>}
    {editor&&suspended&&<div className="flex items-center justify-between gap-2 text-xs"><span>Draft saved in memory</span><Button size="sm" variant="outline" onClick={()=>{setSuspended(false);requestAnimationFrame(()=>textArea.current?.focus())}}>Resume draft</Button></div>}
    {(search||query||filter!=='open')&&<div className="flex shrink-0 gap-2"><input ref={searchInput} type="search" aria-label="Search notes" placeholder="Search" value={query} onChange={event=>changeQuery(event.target.value)} className="min-w-0 flex-1 rounded-md border bg-card p-2 text-sm"/><label className="flex items-center gap-1"><Filter className="size-4" aria-hidden="true"/><select aria-label="Show notes" value={filter} onChange={event=>changeFilter(event.target.value)} className="max-w-28 rounded-md border bg-card p-2 text-sm"><option value="open">Open</option><option value="completed">Completed</option><option value="all">All</option></select></label></div>}
    {editing?<section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto" aria-label="Note editor">
      <label className="text-sm">{editor.id?'Edit note':'New note'}<textarea ref={textArea} aria-label="Note text" readOnly={busy} value={draft} onChange={event=>{setDraft(event.target.value);window.localino.setUnsaved(event.target.value!==editor.original)}} className="mt-2 min-h-36 w-full resize-y rounded-lg border bg-card p-3 text-sm"/></label>
      <p className={`text-xs ${draft.length>NOTE_LIMIT?'text-destructive':'text-muted-foreground'}`}>{draft.length.toLocaleString('en-US')} / {NOTE_LIMIT.toLocaleString('en-US')}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={()=>void save()}>Save</Button><Button variant="outline" disabled={busy} onClick={()=>void closeEditor()}>Cancel</Button></div>
    </section>:detailNote?<section className="min-h-0 space-y-3 overflow-auto" aria-label="Note details"><Button size="sm" variant="ghost" onClick={()=>setDetail(null)}><ArrowLeft/>Back to list</Button>
      <p tabIndex={0} data-note-text className="whitespace-pre-wrap break-words text-sm">{detailNote.text}</p><div className="flex gap-2"><Button size="sm" onClick={()=>void begin(detailNote)}>Edit</Button><Button size="sm" variant="outline" onClick={()=>void window.localino.copyNotes([detailNote.id]).then(result=>result.ok?setMessage('Copied.'):setError(result.error??'Could not copy.'))}><Copy/>Copy</Button></div>
      <details className="text-xs text-muted-foreground"><summary>Details</summary><p>Created: {new Date(detailNote.createdAt).toLocaleString('en-US')}<br/>Updated: {new Date(detailNote.updatedAt).toLocaleString('en-US')}</p>{captured?.noteId===detailNote.id&&<p>Acquisition: {captured.elapsedMs??'—'} ms · Presentation: {captured.visibleMs??'—'} ms</p>}</details>
    </section>:<>
      {!!selected.length&&<p className="shrink-0 text-xs text-muted-foreground">{selected.length} selected</p>}
      <ul className="note-list" aria-label="Notes">{notes.map(note=><li key={note.id} data-note-id={note.id} className={`note-row ${selected.includes(note.id)?'selected':''}`} onContextMenu={event=>{event.preventDefault();openMenu(note.id)}} onKeyDown={event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();openMenu(note.id)}}} onFocus={()=>setFocused(note.id)}>
        <input type="checkbox" aria-label={`Select note: ${note.text.slice(0,60)}`} checked={selected.includes(note.id)} onChange={()=>setSelected(previous=>previous.includes(note.id)?previous.filter(id=>id!==note.id):[...previous,note.id])} className="note-selector"/>
        <button type="button" className={`min-w-0 flex-1 text-left text-sm ${note.completed?'text-muted-foreground line-through':''}`} aria-label={`Read note: ${note.text.slice(0,60)}`} onClick={()=>setDetail(note.id)}><span className="line-clamp-3 whitespace-pre-wrap break-words">{note.text}</span>{note.completed&&<span className="sr-only">Completed</span>}</button>
        <div className="flex shrink-0 flex-col"><Button size="icon" variant="ghost" aria-label="Edit note" title="Edit note" disabled={busy} onClick={()=>void begin(note)}><SquarePen/></Button><Button size="icon" variant="ghost" aria-label="Delete note" title="Delete note" disabled={busy} onClick={()=>void mutate(note,'delete')}><Trash2/></Button><Button size="icon" variant="ghost" aria-label={note.completed?'Reopen note':'Complete note'} title={note.completed?'Reopen note':'Complete note'} disabled={busy} onClick={()=>void mutate(note,'complete')}>{note.completed?<Undo2/>:<Check/>}</Button></div>
      </li>)}</ul>
      {!notes.length&&<p className="text-sm text-muted-foreground">{!state?'Loading…':state.notes.length?'No matching notes.':'No notes yet.'}</p>}
    </>}
    {dialog}{menu&&<SelectionMenu count={selected.length} copy={()=>void copy()} close={()=>setMenu(false)}/>}
  </main>
}
function SelectionMenu({count,copy,close}:{count:number;copy:()=>void;close:()=>void}):React.JSX.Element {
  const element=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const origin=document.activeElement as HTMLElement;element.current!.showModal();return()=>{if(origin?.isConnected)origin.focus()}},[])
  return <dialog ref={element} onCancel={event=>{event.preventDefault();close()}} aria-label="Selection actions" className="m-auto rounded-xl border bg-card p-3 shadow-xl backdrop:bg-black/20"><div role="menu" className="flex flex-col gap-1"><Button role="menuitem" variant="ghost" disabled={!count} onClick={copy}>{count>1?`Copy all (${count})`:'Copy'}</Button><Button role="menuitem" variant="ghost" onClick={close}>Close</Button></div></dialog>
}
