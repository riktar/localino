import { useEffect, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import { transcriptItemKey, transcriptPolicy, type TranscriptInfo, type TranscriptPage } from '../../../shared/transcript'
import { terminalText } from '../../../shared/terminal'
import { Button } from './ui/button'

export function TranscriptArchive({agent}:{agent:AgentId}):React.JSX.Element {
  const [sessions,setSessions] = useState<TranscriptInfo[]>([]),[page,setPage] = useState<TranscriptPage>(),[error,setError] = useState<string>(),[loading,setLoading] = useState(false)
  useEffect(()=>{
    let disposed = false,timer:ReturnType<typeof setTimeout> | undefined
    const read = async()=>{try { const state = await window.localino.getTranscripts();if (!disposed) {setSessions(state.sessions.filter(session=>session.provider === agent));setError(state.error ?? undefined)} } catch {if (!disposed) setError('Transcript storage is unavailable.')} }
    void read()
    const off = window.localino.onTranscripts(()=>{if (!timer) timer = setTimeout(()=>{timer = undefined;void read()},100)})
    return ()=>{disposed = true;off();clearTimeout(timer)}
  },[agent])
  useEffect(()=>{setPage(undefined)},[agent])
  const open = async(id:string,before?:number)=>{
    setLoading(true)
    try {setPage(await window.localino.getTranscriptPage(id,before))} catch {setError('Could not read this transcript. Original files are preserved.')} finally {setLoading(false)}
  }
  const remove = async(id:string)=>{try {const result = await window.localino.deleteTranscript(id);if (!result.ok) setError(result.error);else if (page?.info.sessionId === id) setPage(undefined)} catch {setError('Could not delete the transcript.')} }
  return <section aria-label="Saved transcripts" className="mt-4 space-y-2 border-t pt-3">
    <h3 className="text-sm font-medium">Saved transcripts</h3>
    <p className="text-xs text-muted-foreground">{transcriptPolicy}</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {sessions.map(session=><div key={session.sessionId} className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs" data-transcript-id={session.sessionId}>
      <span className="min-w-0 flex-1 break-words">{session.projectName} · {session.sessionId.slice(0,8)} · {session.bytes.toLocaleString()} bytes · {session.events.toLocaleString()} events{session.interrupted?' · interrupted':''}</span>
      <Button size="sm" variant="ghost" disabled={loading} onClick={()=>void open(session.sessionId)}>Read transcript</Button>
      <Button size="sm" variant="ghost" onClick={()=>void remove(session.sessionId)}>Delete transcript</Button>
      {session.error&&<p role="alert" className="w-full text-destructive">{session.error}</p>}
    </div>)}
    {page&&<div className="space-y-2 rounded border p-3" aria-label="Transcript page">
      <div className="flex flex-wrap items-center gap-2"><span className="flex-1 text-xs">{page.info.projectName} · {page.info.sessionId.slice(0,8)}{page.info.interrupted?' · Interrupted after restart; no automatic resend.':''}</span><Button size="sm" variant="ghost" onClick={()=>setPage(undefined)}>Close transcript</Button></div>
      {page.info.error&&<p role="alert" className="text-xs text-destructive">{page.info.error}</p>}
      <p className="text-xs text-muted-foreground">A page contains at most 100 events / 2 MiB. Earlier pages stay on disk.</p>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading||page.before===null} onClick={()=>void open(page.info.sessionId,page.before!)}>Earlier events</Button><Button size="sm" variant="outline" disabled={loading} onClick={()=>void open(page.info.sessionId)}>Latest events</Button></div>
      <ol className="max-h-80 overflow-auto space-y-2" aria-label="Transcript events">{page.events.map(event=><li key={event.sequence} className="text-xs"><p className="font-medium">#{event.sequence} {event.kind} · {event.operation} · {event.disposition} · {page.states[transcriptItemKey(event)]?.outcome ?? event.outcome ?? 'unknown'}</p><pre className="whitespace-pre-wrap break-words font-mono">{terminalText(event.text ?? event.label ?? '')}</pre></li>)}</ol>
    </div>}
  </section>
}
