import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Button } from './ui/button'
import { useConfirm } from './confirm-dialog'
import { NOTE_LIMIT, textError, type Note, type NotesState } from '../../../shared/notes'

export type LeaveGuard = () => Promise<boolean>
export function Clipboard({guard}:{guard:RefObject<LeaveGuard|null>}): React.JSX.Element {
  const [state,setState] = useState<NotesState|null>(null)
  const [filter,setFilter] = useState('open')
  const [query,setQuery] = useState('')
  const [selected,setSelected] = useState<string|null>(null)
  const [editor,setEditor] = useState<{id:string|null;original:string;updatedAt:number}|null>(null)
  const [draft,setDraft] = useState('')
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const textArea = useRef<HTMLTextAreaElement>(null)
  const saving = useRef(false)
  const dirty = editor !== null && draft !== editor.original
  const {ask,dialog} = useConfirm()
  useEffect(() => {
    const off = window.localino.onNotes(setState)
    void window.localino.getNotes().then(setState)
    return off
  },[])
  useEffect(() => {window.localino.setUnsaved(dirty);return () => window.localino.setUnsaved(false)},[dirty])
  const notes = useMemo(() => (state?.notes ?? []).filter(n => (filter==='all' || n.completed===(filter==='completed')) && n.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[state,filter,query])
  const note = state?.notes.find(n=>n.id===selected)
  const save = useCallback(async ():Promise<boolean> => {
    if (!editor || busy || saving.current) return false
    const invalid = textError(draft)
    if (invalid) {setError(invalid);textArea.current?.focus();return false}
    saving.current=true;setBusy(true);setError('');setMessage('')
    try {
      const result = await window.localino.mutateNote(editor.id ? {kind:'update',id:editor.id,text:draft,expectedUpdatedAt:editor.updatedAt} : {kind:'create',text:draft})
      if (!result.ok) {setError(result.error);return false}
      setState(result.state);setSelected(editor.id ?? result.state.notes[0].id);setEditor(null);window.localino.setUnsaved(false);setMessage('Prompt salvato.');return true
    } catch {setError('Salvataggio non riuscito. La bozza è conservata.');return false}
    finally {saving.current=false;setBusy(false)}
  },[editor,draft,busy])
  const canLeave = useCallback(async ():Promise<boolean> => {
    if (busy || saving.current) return false
    if (!dirty) return true
    const answer = await ask('Conservare le modifiche?','La bozza contiene modifiche non salvate.',['Salva','Scarta','Resta'])
    if (answer===0) return save()
    if (answer===1) {setEditor(null);window.localino.setUnsaved(false);return true}
    textArea.current?.focus();return false
  },[ask,busy,dirty,save])
  useEffect(() => {guard.current=canLeave;return () => {guard.current=null}},[guard,canLeave])
  const begin = async (target?:Note) => {
    if (!(await canLeave())) return
    setError('');setMessage('');setDraft(target?.text ?? '');setEditor({id:target?.id??null,original:target?.text??'',updatedAt:target?.updatedAt??0})
    requestAnimationFrame(()=>textArea.current?.focus())
  }
  const select = async (id:string) => {if(await canLeave()){setEditor(null);setSelected(id);setError('');setMessage('')}}
  const copy = async () => {
    if (!note) return
    const result=await window.localino.copyNote(note.id)
    if(result.ok){setMessage('Prompt copiato negli appunti.');setError('')}else{setError(result.error??'Copia non riuscita.');setMessage('')}
  }
  const complete = async () => {
    if(!note || busy) return
    setBusy(true)
    try {const result=await window.localino.mutateNote({kind:'complete',id:note.id,completed:!note.completed});if(result.ok){setState(result.state);setMessage(note.completed?'Prompt riaperto.':'Prompt completato.');setError('')}else setError(result.error)} finally {setBusy(false)}
  }
  const remove = async () => {
    if(!note || busy) return
    if(await ask('Eliminare il prompt?','Questa operazione elimina definitivamente il prompt selezionato.',['Elimina','Annulla'])!==0) return
    setBusy(true)
    try {const result=await window.localino.mutateNote({kind:'delete',id:note.id});if(result.ok){setState(result.state);setSelected(null);setMessage('Prompt eliminato.');setError('')}else setError(result.error)} finally {setBusy(false)}
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-6" data-clipboard>
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold">Clipboard</h1><p className="mt-1 text-sm text-muted-foreground">Prompt e appunti sul tuo PC. Nessun account necessario.</p></div><Button disabled={!state || !!state.error || busy} onClick={()=>void begin()}>Nuovo prompt</Button></header>
    {state?.error && <div role="alert" className="space-y-3 break-words rounded-xl border border-destructive p-4 text-sm"><p>{state.error}</p><Button variant="outline" onClick={()=>void window.localino.reloadNotes().then(setState)}>Riprova lettura</Button></div>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <p role="status" className="min-h-5 text-sm text-muted-foreground">{message}</p>
    <div className="flex gap-3"><label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Cerca prompt<input type="search" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded-md border bg-card p-2" /></label><label className="flex flex-col gap-1 text-sm">Mostra<select aria-label="Mostra" value={filter} onChange={e=>setFilter(e.target.value)} className="rounded-md border bg-card p-2"><option value="open">Aperti</option><option value="completed">Completati</option><option value="all">Tutti</option></select></label></div>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5">
      <section aria-label="Elenco prompt" className="min-w-0"><p className="mb-2 text-xs text-muted-foreground">{notes.length} prompt · Più recenti per primi</p>
        {!state ? <p>Caricamento…</p> : notes.length===0 ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">{state.notes.length===0?'Nessun prompt. Crea il primo con Nuovo prompt.':'Nessun risultato per questa ricerca o filtro.'}</p> : <ul className="max-h-[65vh] space-y-2 overflow-y-auto p-1">{notes.map(n=><li key={n.id}><button type="button" aria-pressed={selected===n.id} onClick={()=>void select(n.id)} className={`w-full rounded-xl border p-3 text-left ${selected===n.id?'border-primary bg-primary/10':'bg-card'}`}><span className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{n.text.slice(0,160)}</span><span className="mt-2 block text-xs text-muted-foreground">{n.completed?'Completato':'Aperto'} · {new Date(n.createdAt).toLocaleString('it-IT')}</span></button></li>)}</ul>}
      </section>
      <section aria-label={editor?'Editor prompt':'Dettaglio prompt'} className="min-w-0 rounded-xl border bg-card p-4">
        {editor ? <div className="space-y-3"><h2 className="font-medium">{editor.id?'Modifica prompt':'Nuovo prompt'}</h2><label className="block text-sm">Testo del prompt<textarea ref={textArea} readOnly={busy} value={draft} onChange={e=>{setDraft(e.target.value);window.localino.setUnsaved(e.target.value!==editor.original)}} onKeyDown={e=>{if(e.ctrlKey&&e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void save()}}} className="mt-2 min-h-64 w-full resize-y rounded-md border bg-background p-3" /></label><p className={`text-xs ${draft.length>NOTE_LIMIT?'text-destructive':'text-muted-foreground'}`}>{draft.length.toLocaleString('it-IT')} / {NOTE_LIMIT.toLocaleString('it-IT')} caratteri · Ctrl+Invio salva</p><div className="flex gap-2"><Button disabled={busy||!!state?.error} onClick={()=>void save()}>Salva prompt</Button><Button variant="outline" disabled={busy} onClick={()=>void canLeave().then(ok=>{if(ok)setEditor(null)})}>Chiudi editor</Button></div></div> : note ? <div className="space-y-4"><h2 className="font-medium">Prompt {note.completed?'completato':'aperto'}</h2><div className="flex flex-wrap gap-2"><Button onClick={()=>void copy()}>Copia</Button><Button variant="outline" onClick={()=>void begin(note)}>Modifica</Button><Button variant="outline" disabled={busy} onClick={()=>void complete()}>{note.completed?'Riapri':'Completa'}</Button><Button variant="outline" disabled={busy} onClick={()=>void remove()}>Elimina</Button></div><p className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words text-sm" data-note-text>{note.text}</p><p className="text-xs text-muted-foreground">Creato: {new Date(note.createdAt).toLocaleString('it-IT')}<br/>Modificato: {new Date(note.updatedAt).toLocaleString('it-IT')}</p></div> : <p className="text-sm text-muted-foreground">Seleziona un prompt per leggerlo o modificarlo.</p>}
      </section>
    </div>
    {dialog}
  </main>
}
