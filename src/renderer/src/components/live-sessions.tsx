import { useEffect, useState } from 'react'
import { Square, Play } from 'lucide-react'
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
  const state=useLiveSessions(),capability=state.capabilities[agent],[now,setNow]=useState(Date.now()),[error,setError]=useState<string>()
  const sessions=state.sessions.filter(session=>session.agent===agent&&session.status!=='stopped')
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const start=async()=>{setError(undefined);const result=await window.localino.startLiveSession(agent);if(!result.ok&&result.error!=='No project selected.')setError(result.error)}
  const stop=async(id:string)=>{setError(undefined);const result=await window.localino.stopLiveSession(id);if(!result.ok)setError(result.error)}
  return <section aria-labelledby="live-sessions-title" className="mx-auto max-w-[1440px] space-y-3 px-6 pt-5 lg:px-8" data-live-sessions={agent}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="live-sessions-title" className="font-medium">Sessions</h2><p className="text-xs text-muted-foreground">CLI processes supervised by Localino.</p></div><Button size="sm" disabled={capability.status!=='available'} onClick={()=>void start()}><Play aria-hidden="true"/>Start session</Button></div>
    <p className="text-xs text-muted-foreground" role="status">{capability.status==='checking'?'Checking CLI…':capability.status==='available'?`${capability.version??'CLI available'} · ${capability.protocol}`:capability.status==='missing'?'CLI binary not found.':'CLI inspection failed.'}</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {sessions.length===0?<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No supervised sessions.</p>:<div className="grid gap-2">{sessions.map(session=><article key={session.id} className="flex min-w-0 items-center gap-3 rounded-lg border p-3" data-session-id={session.id}>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium">{session.projectName}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs" data-session-status={session.status}>{session.status}</span></div><p className="truncate text-xs text-muted-foreground" title={session.projectPath}>{session.projectPath}</p><p className="text-xs text-muted-foreground" data-session-instance={session.id}>{agent} · Instance {session.id.slice(0,8)}</p><p className="mt-1 text-xs tabular-nums">{session.status==='running'||session.status==='waiting'?'Current turn':session.lastTurnOutcome?`Last turn (${session.lastTurnOutcome})`:'Last turn'}: {session.status==='running'||session.status==='waiting'?elapsed(session.turnStartedAt,now):session.turnElapsedMs===null?'—':elapsed(0,session.turnElapsedMs)}</p>{session.error&&<p role="alert" className="mt-1 text-xs text-destructive">{session.error}</p>}</div>
      <Button size="icon" variant="ghost" aria-label={`Stop ${session.projectName} instance ${session.id.slice(0,8)}`} disabled={session.status==='stopping'} onClick={()=>void stop(session.id)}><Square aria-hidden="true"/></Button>
    </article>)}</div>}
  </section>
}
