import { useEffect, useRef, useState } from 'react'
import { captureHelp, type CaptureDraft, type CaptureStatus } from '../../../shared/capture'
import { textError } from '../../../shared/notes'
import { Button } from './ui/button'
import type { LeaveGuard } from './clipboard'
import { useConfirm } from './confirm-dialog'

export function useCaptureStatus(): CaptureStatus {
  const [state, setState] = useState<CaptureStatus>({ enabled: true, status: 'starting' })
  useEffect(() => {
    const off = window.localino.onCaptureStatus(setState)
    void window.localino.getCaptureStatus().then(setState)
    return off
  }, [])
  return state
}
export function CaptureSettings(): React.JSX.Element {
  const state = useCaptureStatus()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const update = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { const result = await window.localino.setCaptureEnabled(enabled); if (!result.ok) setError(result.error ?? 'Modifica non riuscita.') }
    catch { setError('Modifica non riuscita.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Capture settings" className="space-y-3">
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e=>void update(e.target.checked)}/>Double Shift</label>
    <p role="status" className="text-xs">{state.status==='ready'?'Ready':state.status==='starting'?'Starting…':state.status==='suspended'?'Suspended':state.error}</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {state.status==='error'&&<Button size="sm" variant="outline" onClick={()=>void window.localino.retryCapture()}>Retry capture</Button>}
    {window.localino.platform==='darwin'&&<Button size="sm" variant="outline" onClick={()=>void window.localino.requestCapturePermissions()}>Allow permissions</Button>}
    <details className="text-xs"><summary className="cursor-pointer">Help</summary><div className="mt-2 space-y-2"><p>Press and release Shift twice within 350 ms, without other keys. Readable selections save automatically.</p><p>{captureHelp}</p></div></details>
  </section>
}

export function CaptureEditor({guard}:{guard:React.MutableRefObject<LeaveGuard|null>}): React.JSX.Element {
  const {ask,dialog}=useConfirm()
  const [draft, setDraft] = useState<CaptureDraft | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const received = useRef<{id:number;complete:boolean} | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const receive = (next: CaptureDraft | null) => {
      if (!next) return
      if (received.current?.id !== next.id || (!received.current.complete && !next.acquiring)) {
        setText(next.text); setError('')
      }
      received.current = { id: next.id, complete: !next.acquiring }
      setDraft(next)
    }
    const off = window.localino.onCaptureDraft(receive)
    void window.localino.getCaptureDraft().then(receive)
    return off
  }, [])
  useEffect(() => { if (draft && !draft.acquiring) editor.current?.focus() }, [draft?.id, draft?.acquiring])
  useEffect(() => {
    if (!draft) return
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { void window.localino.capturePresented(draft.id) }) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [draft?.id])
  const save = async () => {
    if (!draft || draft.acquiring || saving.current) return
    const invalid = textError(text)
    if (invalid) { setError(invalid); return }
    saving.current = true; setBusy(true); setError('')
    try { const result = await window.localino.saveCapture(draft.id, text); if (!result.ok) setError(result.error ?? 'Salvataggio non riuscito: riprova.') }
    catch { setError('Salvataggio non riuscito. Il testo è conservato: riprova.') }
    finally { saving.current = false; setBusy(false) }
  }
  const cancel = async () => { if (draft && !saving.current && await guard.current?.()) { await window.localino.cancelCapture(draft.id) } }
  useEffect(()=>{
    guard.current=async()=>{
      if(saving.current)return false
      if(!draft)return true
      const answer=await ask('Keep this capture?','Save the text or discard it.',['Save','Discard','Stay'])
      if(answer===0){const invalid=textError(text);if(invalid){setError(invalid);return false}saving.current=true;setBusy(true);try{const result=await window.localino.saveCapture(draft.id,text);if(!result.ok){setError(result.error??'Could not save.');return false}return true}catch{setError('Could not save. Your draft is safe.');return false}finally{saving.current=false;setBusy(false)}}
      if(answer===1){await window.localino.cancelCapture(draft.id);return true}
      requestAnimationFrame(()=>editor.current?.focus())
      return false
    }
    return ()=>{guard.current=null}
  },[guard,draft,text,ask])
  return <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" onKeyDown={event => {
    if (document.querySelector('dialog[open]') || event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) { event.preventDefault(); void save() }
  }}>
    <h2 className="text-sm font-semibold">Capture</h2>
    <p role="status" className="text-sm">{draft?.message??'Preparing…'}</p>
    <label htmlFor="capture-text" className="text-sm font-medium">Capture text</label>
    <textarea id="capture-text" ref={editor} value={text} readOnly={!draft || draft.acquiring || busy} onChange={e => setText(e.target.value)} className="min-h-40 flex-1 resize-y rounded-lg border bg-background p-3 text-sm" spellCheck={false} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <details className="text-xs"><summary>Help</summary><p>{captureHelp}</p><p>Acquisition: {draft?.elapsedMs??'—'} ms · Presentation: {draft?.visibleMs??'—'} ms</p></details>
    <footer className="flex flex-wrap gap-3"><Button disabled={!draft || draft.acquiring || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button><Button variant="outline" disabled={busy || !draft} onClick={cancel}>Cancel</Button></footer>
    {dialog}
  </main>
}
