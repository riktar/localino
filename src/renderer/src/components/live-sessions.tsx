import { useEffect, useState } from 'react'
import { Square, Play, X } from 'lucide-react'
import type { AgentId } from '../../../shared/agents'
import { initialLiveSessions, type LiveSessionsState } from '../../../shared/sessions'
import { Button } from './ui/button'

export function useLiveSessions():LiveSessionsState{
  const [state,setState]=useState(initialLiveSessions)
  useEffect(()=>{let current=false,disposed=false;const off=window.localino.onLiveSessions(next=>{current=true;setState(next)});void window.localino.getLiveSessions().then(next=>{if(!current&&!disposed)setState(next)});return()=>{disposed=true;off()}},[])
  return state
}

function elapsed(start:number|null,now:number):string{
  if(start===null)return 'Unavailable'
  const seconds=Math.max(0,Math.floor((now-start)/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60)
  return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${minutes}:${String(seconds%60).padStart(2,'0')}`
}

export function LiveSessions({agent}:{agent:AgentId}):React.JSX.Element{
  const state=useLiveSessions(),capability=state.capabilities[agent],[now,setNow]=useState(Date.now()),[error,setError]=useState<string>(),[selected,setSelected]=useState<string>(),[drafts,setDrafts]=useState<Record<string,string>>({})
  const sessions=state.sessions.filter(session=>session.agent===agent&&session.status!=='stopped'),recovered=state.recovered.filter(session=>session.agent===agent)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  useEffect(()=>{setDrafts(previous=>{let changed=false;const next={...previous};for(const session of state.sessions)if(next[session.id]===undefined){next[session.id]=session.draft;changed=true}return changed?next:previous})},[state.sessions])
  useEffect(()=>{if(selected&&!sessions.some(session=>session.id===selected))setSelected(undefined)},[selected,sessions])
  const act=async(action:()=>Promise<{ok:boolean;error?:string}>)=>{setError(undefined);const result=await action();if(!result.ok)setError(result.error);return result.ok}
  const start=async()=>{const result=await window.localino.startLiveSession(agent);if(!result.ok&&result.error!=='No project selected.')setError(result.error)}
  const stop=(id:string)=>act(()=>window.localino.stopLiveSession(id))
  const updateDraft=(id:string,text:string)=>{setDrafts(value=>({...value,[id]:text}));void act(()=>window.localino.setLiveSessionDraft(id,text))}
  const send=async(id:string)=>{const text=drafts[id]??'';if(await act(()=>window.localino.sendLiveSession(id,text)))setDrafts(value=>({...value,[id]:''}))}
  const cancel=(sessionId:string,deliveryId:string)=>act(()=>window.localino.cancelLiveDelivery(sessionId,deliveryId))
  return <section aria-labelledby="live-sessions-title" className="mx-auto max-w-[1440px] space-y-3 px-6 pt-5 lg:px-8" data-live-sessions={agent}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="live-sessions-title" className="font-medium">Sessions</h2><p className="text-xs text-muted-foreground">CLI processes supervised by Localino.</p></div><Button size="sm" disabled={capability.status!=='available'} onClick={()=>void start()}><Play aria-hidden="true"/>Start session</Button></div>
    <p className="text-xs text-muted-foreground" role="status">{capability.status==='checking'?'Checking CLI...':capability.status==='available'?`${capability.version??'CLI available'} - ${capability.protocol}`:capability.status==='missing'?'CLI binary not found.':'CLI inspection failed.'}</p>
    {(error||state.persistenceError)&&<p role="alert" className="text-sm text-destructive">{error??state.persistenceError}</p>}
    {sessions.length===0?<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No supervised sessions.</p>:<div className="grid gap-2">{sessions.map(session=>{
      const open=selected===session.id,draft=drafts[session.id]??session.draft,busy=session.status==='running'||session.status==='waiting'||session.deliveries.some(item=>item.status==='sending'),canSend=!['starting','stopping','stopped','unknown','error'].includes(session.status)&&draft.trim().length>0&&draft.length<=100_000
      return <article key={session.id} tabIndex={0} aria-expanded={open} className="min-w-0 rounded-lg border p-3" data-session-id={session.id} onClick={()=>setSelected(open?undefined:session.id)} onKeyDown={event=>{if(event.currentTarget===event.target&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setSelected(open?undefined:session.id)}}}>
        <div className="flex min-w-0 items-center gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium">{session.projectName}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs" data-session-status={session.status}>{session.status}</span></div><p className="truncate text-xs text-muted-foreground" title={session.projectPath}>{session.projectPath}</p><p className="text-xs text-muted-foreground" data-session-instance={session.id}>{agent} - Instance {session.id.slice(0,8)}</p><p className="mt-1 text-xs tabular-nums">{session.status==='running'||session.status==='waiting'?'Current turn':session.lastTurnOutcome?`Last turn (${session.lastTurnOutcome})`:'Last turn'}: {session.status==='running'||session.status==='waiting'?elapsed(session.turnStartedAt,now):session.turnElapsedMs===null?'-':elapsed(0,session.turnElapsedMs)}</p>{session.error&&<p role="alert" className="mt-1 text-xs text-destructive">{session.error}</p>}</div>
          <Button size="icon" variant="ghost" aria-label={`Stop ${session.projectName} instance ${session.id.slice(0,8)}`} disabled={session.status==='stopping'} onClick={event=>{event.stopPropagation();void stop(session.id)}}><Square aria-hidden="true"/></Button>
        </div>
        {open&&<div className="mt-3 space-y-2 border-t pt-3" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
          <p className="text-xs text-muted-foreground">Message to {session.projectName} - instance {session.id.slice(0,8)}</p>
          <textarea aria-label={`Message for ${session.projectName} instance ${session.id.slice(0,8)}`} className="min-h-24 w-full resize-y rounded-md border bg-background p-2 text-sm" maxLength={100_000} value={draft} onChange={event=>updateDraft(session.id,event.target.value)}/>
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{draft.length.toLocaleString()} / 100,000 characters</span><Button size="sm" disabled={!canSend} onClick={()=>void send(session.id)}>{busy?'Queue':'Send'}</Button></div>
          {session.deliveries.length>0&&<ul aria-label="Message deliveries" className="space-y-1">{session.deliveries.map(delivery=><li key={delivery.id} className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs"><span className="min-w-0 flex-1 truncate" title={delivery.text}>{delivery.text}</span><span data-delivery-status={delivery.status}>{delivery.status}</span>{delivery.status==='queued'&&<Button size="icon" variant="ghost" aria-label="Cancel queued message" onClick={()=>void cancel(session.id,delivery.id)}><X aria-hidden="true"/></Button>}</li>)}</ul>}
        </div>}
      </article>})}</div>}
    {recovered.length>0&&<div className="space-y-2"><h3 className="text-sm font-medium">Recovered drafts and undelivered messages</h3><p className="text-xs text-muted-foreground">These messages are suspended and will never be sent automatically.</p>{recovered.map(session=><article key={session.id} className="rounded-lg border border-dashed p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium">{session.projectName} - instance {session.id.slice(0,8)}</p><p className="truncate text-xs text-muted-foreground">{session.projectPath}</p></div><Button size="sm" variant="ghost" onClick={()=>void act(()=>window.localino.discardRecoveredSession(session.id))}>Discard</Button></div>{session.draft&&<pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{session.draft}</pre>}{session.deliveries.map(delivery=><div key={delivery.id} className="mt-2 rounded bg-muted p-2 text-xs"><span className="font-medium">{delivery.status}: </span><span className="whitespace-pre-wrap break-words">{delivery.text}</span></div>)}</article>)}</div>}
  </section>
}
