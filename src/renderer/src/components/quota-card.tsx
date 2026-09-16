import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Quotas, ResourceState } from '../../../shared/contracts'
import { countdown, durationLabel, freshness } from '../../../shared/quotas'
import { Button } from './ui/button'

export function QuotaCard({state,refresh=()=>void window.localino.refreshQuotas()}:{state:ResourceState<Quotas>;refresh?:()=>void}):React.JSX.Element {
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  return <section className="space-y-3" aria-label="Quotas" data-updated-at={state.lastSuccessAt??''}>
    <div className="flex items-center justify-between"><h2 className="text-sm font-medium">Quotas</h2><Button size="sm" variant="ghost" disabled={state.refreshing} onClick={refresh}><RefreshCw className={state.refreshing?'animate-spin':''} aria-hidden="true"/>Refresh quotas</Button></div>
    <p role="status" className={`text-xs ${state.stale||state.error?'text-destructive':'text-muted-foreground'}`}>{freshness(state)}{state.lastSuccessAt?` · ${new Date(state.lastSuccessAt).toLocaleString('en-US')}`:''}</p>
    {state.error&&<p role="alert" className="text-sm text-destructive">{state.error==='unsupported'?'Quotas unsupported. Update the agent and retry.':state.error==='timeout'?'Quota request timed out. Retry.':'Could not update quotas. Retry.'}</p>}
    {state.data?.buckets.map(bucket=><div key={bucket.id} className="space-y-3 rounded-lg border p-3" data-bucket={bucket.id}>
      <h3 className="break-words text-sm font-medium">{bucket.name}</h3>
      {!bucket.windows.length&&<p className="text-xs">No windows available</p>}
      {bucket.windows.map(window=><div key={window.kind} className="space-y-1 text-xs" data-window={window.kind}>
        <div className="flex flex-wrap justify-between gap-1"><span>{durationLabel(window.durationMins)} · {window.kind==='primary'?'Primary':'Secondary'}</span><strong>{window.usedPercent===null?'Unavailable':`${Math.max(0,100-window.usedPercent)}% remaining`}</strong></div>
        {window.usedPercent!==null&&<><div role="progressbar" aria-label={`${bucket.name}, ${durationLabel(window.durationMins)}, used quota`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,window.usedPercent)} aria-valuetext={`${window.usedPercent}% used`} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${window.usedPercent>=100?'bg-destructive':'bg-primary'}`} style={{width:`${Math.min(100,window.usedPercent)}%`}}/></div><p>{window.usedPercent}% used{window.usedPercent>100?' · Limit exceeded':window.usedPercent===100?' · Limit reached':''}</p></>}
        <p className="text-muted-foreground">Reset: {window.resetsAt===null?'Unavailable':<><time dateTime={new Date(window.resetsAt).toISOString()}>{new Date(window.resetsAt).toLocaleString('en-US')}</time> · {countdown(window.resetsAt,now)}</>}</p>
      </div>)}
    </div>)}
    {state.data&&!state.data.buckets.length&&<p className="text-xs">No quota limits available.</p>}
  </section>
}
