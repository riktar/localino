import { useState } from 'react'
import { ChevronDown, Terminal } from 'lucide-react'
import { agentIds, agentLabels, type AgentId, type LocalAgentId } from '../../../shared/agents'
import { compactQuota } from '../../../shared/quota-summary'
import { durationLabel } from '../../../shared/quotas'
import { useConnection } from '../hooks/use-connection'
import { useQuotas } from '../hooks/use-quotas'
import { useAgents } from './agents'
import { useHistory } from './local-history'
import { useBridge } from './claude-bridge'
import { QuotaCard } from './quota-card'
import { Button } from './ui/button'
import { connectionErrors } from './account-card'
import type { Quotas, ResourceState } from '../../../shared/contracts'

export function AgentSummary(): React.JSX.Element {
  const agents=useAgents(),[error,setError]=useState<string>()
  return <section className="agent-summary" aria-label="Agent">
    <div className="flex items-center gap-2">
      <Terminal className="size-5 shrink-0" aria-hidden="true"/>
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Agent</span>
        <select aria-label="Agent" className="w-full appearance-none rounded-md bg-transparent py-1 pr-6 font-medium" value={agents.selected} onChange={event=>void window.localino.selectAgent(event.target.value as AgentId).then(result=>setError(result.error))}>
          {agentIds.map(id=><option key={id} value={id}>{agentLabels[id]}</option>)}
        </select><ChevronDown className="pointer-events-none absolute right-0 top-2 size-4" aria-hidden="true"/>
      </label>
    </div>
    {(agents.error||error)&&<p role="alert" className="text-sm text-destructive">{agents.error||error}</p>}
    {agents.selected==='codex'?<CodexSummary/>:<LocalSummary key={agents.selected} id={agents.selected}/>}
    <Button size="sm" variant="ghost" className="mt-1 h-7 px-0" onClick={()=>void window.localino.openDashboard()}>Advanced usage</Button>
  </section>
}
function CodexSummary():React.JSX.Element {
  const account=useConnection(),quotas=useQuotas()
  return account.status==='connected'?<QuotaSummary state={quotas}/>:<div className="mt-2 space-y-2">
    {account.error&&<p role="alert" className="text-sm text-destructive">{connectionErrors[account.error]}</p>}
    <Button size="sm" disabled={account.status==='connecting'} onClick={()=>void window.localino.connect()}>{account.status==='connecting'?'Connecting…':account.error?'Retry':'Connect'}</Button>
  </div>
}
function LocalSummary({id}:{id:LocalAgentId}):React.JSX.Element {
  const state=useHistory(id),bridge=useBridge(),[error,setError]=useState<string>()
  if(!state?.enabled)return <div className="mt-2 space-y-1">{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button size="sm" disabled={!state} onClick={()=>void window.localino.connectAgent(id).then(result=>setError(result.error))}>Connect</Button></div>
  return <>{id==='claude'&&bridge?.enabled?<QuotaSummary state={bridge.quotas} refresh={()=>void window.localino.refreshBridge()}/>:<p className="mt-2 text-xs text-muted-foreground">Local history · No account quota</p>}
    {(state.error||state.stale||state.data?.partial)&&<p className="text-xs text-destructive">{state.error?'Source unavailable':state.stale?'Stale history':'Partial history'}</p>}</>
}
function QuotaSummary({state,refresh}:{state:ResourceState<Quotas>;refresh?:()=>void}):React.JSX.Element {
  const {bucket,window,count,remaining,otherExhausted,resetPending}=compactQuota(state)
  return <div className="mt-2 space-y-1.5" data-quota-summary>
    <div className="flex justify-between gap-2 text-xs"><span className="truncate">{bucket?`${bucket.name} · ${durationLabel(window?.durationMins??null)}`:'Quota'}</span><strong className="shrink-0">{remaining===null?'Unavailable':`${remaining.toLocaleString('en-US')}% remaining`}</strong></div>
    {remaining!==null&&<div role="progressbar" aria-label="Remaining quota" aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${remaining===0?'bg-destructive':'bg-primary'}`} style={{width:`${remaining}%`}}/></div>}
    {(state.stale||state.error||otherExhausted||resetPending||((window?.usedPercent??0)>100))&&<p className="text-xs text-destructive">{[state.stale?'Stale':state.error?'Update failed':null,otherExhausted?'Another limit is exhausted':null,resetPending?'Reset needs verification':null,(window?.usedPercent??0)>100?'Limit exceeded':null].filter(Boolean).join(' · ')}</p>}
    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Details{count>1?` · ${count} limits`:''}</summary><div className="mt-3"><QuotaCard state={state} refresh={refresh}/></div></details>
  </div>
}
