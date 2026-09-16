import { useEffect, useState } from 'react'
import { agentCapabilities, agentLabels, type AgentPeriod, type HistoryState, type LocalAgentId } from '../../../shared/agents'
import { useCommands } from './commands'
import { Button } from './ui/button'
import { ClaudeBridgeCard,useBridge } from './claude-bridge'

export function useHistory(id: LocalAgentId): HistoryState | null {
  const [state,setState]=useState<HistoryState|null>(null)
  useEffect(()=>{
    let updated=false,disposed=false
    const off=window.localino.onHistory(next=>{if(next.agent===id){updated=true;setState(next)}})
    void window.localino.getHistory(id).then(next=>{if(!updated&&!disposed)setState(next)})
    return ()=>{disposed=true;off()}
  },[id])
  return state?.agent===id?state:null
}
const number=(value:number|null|undefined)=>value==null?'Unavailable':value.toLocaleString('en-US')
export function LocalHistory({id}:{id:LocalAgentId}):React.JSX.Element {
  const state=useHistory(id),capability=agentCapabilities[id],bridge=useBridge()
  const [error,setError]=useState<string>(),[table,setTable]=useState(false)
  const action=async(operation:Promise<{ok:boolean;error?:string}>)=>{setError(undefined);try{setError((await operation).error)}catch{setError('Could not update connection. Retry.')}}
  const connect=()=>action(window.localino.connectAgent(id)),choose=()=>action(window.localino.chooseAgentSource(id)),disconnect=()=>action(window.localino.disconnectAgent(id))
  const refresh=()=>window.localino.refreshHistory(id),period=(value:AgentPeriod)=>window.localino.setAgentPeriod(id,value)
  const unavailable=!state?.enabled?'Connect a source first.':state.refreshing?'Refreshing…':undefined
  useCommands({connect:{run:connect,disabled:state?.enabled?'Already connected.':undefined},choose:{run:choose},disconnect:{run:disconnect,disabled:!state?.enabled?'Already disconnected.':undefined},
    reread:{run:()=>{},disabled:'Local history has no Codex account.'},quotas:{run:()=>window.localino.refreshBridge(),disabled:id==='claude'&&bridge?.enabled?undefined:'No account quotas.'},usage:{run:refresh,disabled:unavailable},
    period7:{run:()=>period('7'),disabled:unavailable},period30:{run:()=>period('30'),disabled:unavailable},periodAll:{run:()=>period('all'),disabled:unavailable},table:{run:()=>setTable(v=>!v),disabled:capability.daily?unavailable:'No daily series.'}})
  const data=state?.data,metrics=[['Input',data?.totals.input],['Output',data?.totals.output],['Cache read',data?.totals.cacheRead],['Cache written',data?.totals.cacheWrite],['Reasoning',data?.totals.reasoning],['Total tokens',data?.totals.total]] as const
  const maxInput=Math.max(1,...(data?.days.map(day=>day.input??0)??[]))
  return <main className="mx-auto max-w-5xl space-y-5 p-6" data-agent={id} data-history-updated-at={state?.lastSuccessAt??''}>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{agentLabels[id]} usage</h1><Button variant="outline" disabled={!!unavailable} onClick={()=>void refresh()}>Refresh usage</Button></header>
    <p className="text-xs text-muted-foreground">Local history{state?.stale?' · Stale':''}{data?.partial?' · Partial':''}</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {state?.error&&<p role="alert" className="text-sm text-destructive">{({missing:'Source missing. Choose another source.',denied:'Source access denied.',invalid:'Source unreadable.',unsupported:'Source format unsupported.',busy:'Source busy. Retry.',timeout:'Read timed out. Retry.',unavailable:'Could not read source. Retry.'})[state.error]}</p>}
    <p role="status" className="text-xs">{!state?.enabled?'Disconnected':state.refreshing?'Refreshing…':data?'Updated':'No successful reading'}</p>
    <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer">Connection</summary><div className="mt-3 space-y-3"><div className="flex flex-wrap gap-2"><Button size="sm" onClick={()=>void (state?.enabled?disconnect():connect())}>{state?.enabled?'Disconnect':'Connect'}</Button><Button size="sm" variant="outline" onClick={()=>void choose()}>Choose source</Button></div><p className="break-all text-xs">Source: {state?.source??'Default'}</p></div></details>
    {state?.enabled&&<label className="block text-sm">Period <select aria-label="Period" className="ml-2 rounded-md border bg-background p-2" value={state.period} onChange={e=>void period(e.target.value as AgentPeriod)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All available</option></select></label>}
    {data&&<>
      {data.semantics==='updated_sessions'&&<p className="text-xs">Sessions updated in this period · Lifetime session consumption</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-history-summary>{metrics.map(([label,value])=><div key={label} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-lg font-semibold">{number(value)}</p></div>)}</div>
      <p className="text-sm">History cost: {capability.costs&&data.totals.cost!==null?data.totals.cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD · Estimate':'Unavailable'}</p>
      {!data.records&&!data.issues&&<p className="text-sm">No recorded usage in this period.</p>}
      {capability.daily&&<section className="space-y-3" aria-label="Daily input series"><h2 className="font-medium">Daily input</h2><p className="text-xs text-muted-foreground">Reported days only · Missing days are not zero</p>
        <div className="max-h-64 space-y-2 overflow-auto">{data.days.map(day=><div key={day.date} className="text-xs"><span>{day.date} · {number(day.input)}</span><div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{width:(day.input??0)/maxInput*100+'%'}}/></div></div>)}</div>
        <Button variant="outline" onClick={()=>setTable(v=>!v)}>{table?'Close daily table':'Open daily table'}</Button>{table&&<div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Date</th><th>Input</th><th>Total tokens</th><th>Cost USD</th></tr></thead><tbody>{data.days.map(day=><tr key={day.date}><td>{day.date}</td><td>{number(day.input)}</td><td>{number(day.tokens)}</td><td>{number(day.cost)}</td></tr>)}</tbody></table></div>}
      </section>}
      <details className="rounded-xl border p-3 text-xs"><summary>Details</summary><div className="mt-3 space-y-2">
        <p>Sessions: {data.sessions} · Records: {data.records} · Issues: {data.issues}</p>
        <p>{data.semantics==='events'?'Calendar days in the local timezone, including today.':'Rolling 24-hour days select updated sessions. This does not date individual token consumption.'}</p>
        {id==='claude'&&<p>Copied responses count once; sessions can include response copies.</p>}
        {data.limitations?.map(note=><p key={note}>{note}</p>)}
        <p>Last attempt: {state?.lastAttemptAt?new Date(state.lastAttemptAt).toLocaleString('en-US'):'Never'}<br/>Last success: {state?.lastSuccessAt?new Date(state.lastSuccessAt).toLocaleString('en-US'):'Never'}<br/>Latest event: {data.sampledAt?new Date(data.sampledAt).toLocaleString('en-US'):'Unavailable'}</p>
        <p>Local history is separate from current context, account quota and invoices.</p>
      </div></details>
    </>}
    {id==='claude'&&<details className="rounded-xl border p-3 text-sm"><summary>Session quota bridge</summary><div className="mt-3"><ClaudeBridgeCard state={bridge}/></div></details>}
  </main>
}
