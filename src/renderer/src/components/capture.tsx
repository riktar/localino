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
  return <section aria-labelledby="capture-settings-title" className="space-y-3 rounded-xl border bg-card p-4">
    <h2 id="capture-settings-title" className="font-semibold">Cattura della selezione</h2>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e => void update(e.target.checked)} />Abilita doppio Shift</label>
    <p className="text-sm text-muted-foreground">Premi e rilascia Shift due volte entro 350 ms, senza altri tasti. L’alternativa globale predefinita è Ctrl+Alt+P, configurabile sotto. Il testo selezionato viene salvato automaticamente e mostrato in Clipboard, in primo piano.</p>
    <p className="text-sm text-muted-foreground">{captureHelp}</p>
    <p role="status" className="text-sm">{state.status === 'ready' ? 'Componente di cattura disponibile.' : state.status === 'starting' ? 'Avvio cattura…' : state.status === 'suspended' ? 'Cattura sospesa.' : state.error}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" disabled={state.status === 'starting' || state.status === 'suspended'} onClick={() => void window.localino.retryCapture()}>Riprova componente di cattura</Button>
  </section>
}

export function CaptureView({guard}:{guard:React.MutableRefObject<LeaveGuard|null>}): React.JSX.Element {
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
  const cancel = () => { if (draft && !saving.current) void window.localino.cancelCapture(draft.id) }
  useEffect(()=>{
    guard.current=async()=>{
      if(saving.current)return false
      if(!draft)return true
      const answer=await ask('Keep this capture?','Save the text or discard it.',['Save','Discard','Stay'])
      if(answer===0){const invalid=textError(text);if(invalid){setError(invalid);return false}const result=await window.localino.saveCapture(draft.id,text);if(!result.ok){setError(result.error??'Could not save.');return false}return true}
      if(answer===1){await window.localino.cancelCapture(draft.id);return true}
      return false
    }
    return ()=>{guard.current=null}
  },[guard,draft,text,ask])
  return <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" onKeyDown={event => {
    if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
    if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.shiftKey) { event.preventDefault(); void save() }
  }}>
    <header><h1 className="text-2xl font-semibold">Cattura selezione</h1><p className="mt-1 text-sm text-muted-foreground">Salva un prompt nella tua Clipboard locale.</p></header>
    <p role="status" className="text-sm">{draft?.message ?? 'Preparazione cattura…'}{draft?.elapsedMs !== undefined && <span className="block text-xs text-muted-foreground">Acquisizione: {draft.elapsedMs} ms</span>}{draft?.visibleMs !== undefined && <span className="block text-xs text-muted-foreground">Presentazione: {draft.visibleMs} ms dal rilevamento</span>}</p>
    <label htmlFor="capture-text" className="text-sm font-medium">Testo da salvare</label>
    <textarea id="capture-text" ref={editor} value={text} readOnly={!draft || draft.acquiring || busy} onChange={e => setText(e.target.value)} className="min-h-40 flex-1 resize-y rounded-lg border bg-background p-3 text-sm" spellCheck={false} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">{captureHelp}</p>
    <footer className="flex flex-wrap gap-3"><Button disabled={!draft || draft.acquiring || busy} onClick={() => void save()}>{busy ? 'Salvataggio…' : 'Salva prompt'} <kbd>Ctrl+Invio</kbd></Button><Button variant="outline" disabled={busy || !draft} onClick={cancel}>Annulla <kbd>Esc</kbd></Button></footer>
    {dialog}
  </main>
}
