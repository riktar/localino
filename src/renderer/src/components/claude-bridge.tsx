import { useEffect,useState } from 'react'
import type { BridgeState } from '../../../shared/agents'
import {Button} from './ui/button'
import {QuotaCard} from './quota-card'

export function useBridge():BridgeState|null {
  const [state,setState]=useState<BridgeState|null>(null)
  useEffect(()=>{let updated=false,disposed=false;const off=window.localino.onBridge(value=>{updated=true;setState(value)});void window.localino.getBridge().then(value=>{if(!updated&&!disposed)setState(value)});return()=>{disposed=true;off()}},[])
  return state
}
export function ClaudeBridgeCard({state}:{state:BridgeState|null}):React.JSX.Element {
  const [busy,setBusy]=useState(false),[diagnosis,setDiagnosis]=useState<string>()
  const toggle=async()=>{setBusy(true);try{await window.localino.setBridgeEnabled(!state?.enabled)}finally{setBusy(false)}}
  return <section className="space-y-3 rounded-xl border p-3" aria-label="Claude status line quotas" data-bridge-received-at={state?.receivedAt??''}>
    <h2 className="text-sm font-medium">Claude session</h2>
    <p role="status" className="text-xs">{!state?.enabled?'Bridge off':state.quotas.error?'Cache unavailable':state.quotas.stale?'Stale snapshot':state.effective?'Live snapshot':'Waiting for Claude'}</p>
    <Button size="sm" disabled={!state||busy} onClick={()=>void toggle()}>{busy?'Saving…':state?.enabled?'Disable bridge':'Enable bridge'}</Button>
    {state?.error&&<p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state?.enabled&&<><QuotaCard state={state.quotas} refresh={()=>void window.localino.refreshBridge()}/><p className="text-xs">Session cost: {state.cost===null?'Unavailable':`${state.cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4})} USD · Estimate`}</p></>}
    <details className="text-xs"><summary className="cursor-pointer">Details</summary><div className="mt-2 space-y-2 break-words">
      <p>Optional integration in Claude user settings. Keeps the previous status line and restores it when disabled, unless you changed it. Receives only quota, cost and session identity.</p>
      <p className="break-all">Settings: {state?.settingsPath??'Loading…'}</p><p>Session: {state?.sessionId??'Unavailable'}</p><p>Received: {state?.receivedAt?new Date(state.receivedAt).toLocaleString('en-US'):'Never'}</p>
      <Button size="sm" variant="outline" onClick={()=>void window.localino.diagnoseBridge().then(setDiagnosis)}>Check project overrides</Button>{diagnosis&&<p>{diagnosis}</p>}
      <p>Refresh reads the cache. Claude activity supplies new values. Snapshots expire after 120 seconds; elapsed resets do not clear consumption. Check /status in Claude for project or policy overrides. Session cost is separate from local history and subscription charges.</p>
    </div></details>
  </section>
}
