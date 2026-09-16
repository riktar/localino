import { useEffect, useState } from 'react'
import { agentIds, agentLabels, agentCapabilities, initialAgents, type AgentsState, type LocalAgentId } from '../../../shared/agents'
import { useCommands } from './commands'
import { Button } from './ui/button'
import { Dashboard } from './dashboard'
import { LocalHistory } from './local-history'

export function useAgents(): AgentsState {
  const [state,setState]=useState(initialAgents)
  useEffect(()=>{
    let updated=false,disposed=false
    const off=window.localino.onAgents(next=>{updated=true;setState(next)})
    void window.localino.getAgents().then(next=>{if(!updated&&!disposed)setState(next)})
    return ()=>{disposed=true;off()}
  },[])
  return state
}
export function AgentCommands(): null {
  useCommands({
    selectCodex:{run:()=>window.localino.selectAgent('codex').then(()=>{})},
    selectClaude:{run:()=>window.localino.selectAgent('claude').then(()=>{})},
    selectPi:{run:()=>window.localino.selectAgent('pi').then(()=>{})},
    selectOpenCode:{run:()=>window.localino.selectAgent('opencode').then(()=>{})},
  })
  return null
}
export function AgentPicker(): React.JSX.Element {
  const state=useAgents()
  const [error,setError]=useState<string>()
  return <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
    <label className="text-sm font-medium">Agente <select aria-label="Agente" className="ml-2 rounded-md border bg-background p-2" value={state.selected} onChange={event=>{
      const id=event.target.value as typeof state.selected
      void window.localino.selectAgent(id).then(result=>setError(result.error))
    }}>{agentIds.map(id=><option key={id} value={id}>{agentLabels[id]}</option>)}</select></label>
    {(state.error||error)&&<p role="alert" className="text-sm text-destructive">{state.error||error}</p>}
    {state.error&&<Button variant="outline" onClick={()=>void window.localino.recoverPreferences('agents')}>Ripristina preferenze agenti</Button>}
  </div>
}
export function LocalAgentView({id}:{id:LocalAgentId}): React.JSX.Element {
  return agentCapabilities[id].history?<LocalHistory id={id}/>:<PendingAgent id={id}/>
}
function PendingAgent({id}:{id:LocalAgentId}): React.JSX.Element {
  const capability=agentCapabilities[id]
  const historyReason=capability.history?'Collega prima la cronologia locale.':`Lettore ${agentLabels[id]} in preparazione.`
  const unavailable=(disabled:string)=>({run:()=>{},disabled})
  useCommands({
    connect:unavailable(historyReason),choose:unavailable(historyReason),disconnect:unavailable(historyReason),
    reread:unavailable(`${agentLabels[id]} usa una fonte locale, senza account Codex.`),
    quotas:unavailable(`Quote non esposte da ${agentLabels[id]}.`),usage:unavailable(historyReason),
    period7:unavailable(historyReason),period30:unavailable(historyReason),periodAll:unavailable(historyReason),
    table:unavailable(capability.daily?historyReason:`${agentLabels[id]} non fornisce una serie giornaliera.`),
  })
  return <main className="mx-auto max-w-5xl space-y-5 p-6" data-agent={id}>
    <h1 className="text-2xl font-semibold">Consumi {agentLabels[id]}</h1>
    <p className="text-muted-foreground">Cronologia locale non collegata. Il lettore sarà disponibile con il completamento di questo incremento.</p>
    <p className="text-sm text-muted-foreground">I dati di ciascun agente rimangono separati. Nessuna lettura automatica prima del collegamento.</p>
    <Button variant="outline" onClick={()=>window.localino.hide()}>Riduci nella barra</Button>
  </main>
}
export function AgentDashboard(): React.JSX.Element {
  const state=useAgents()
  return <><AgentPicker/>{state.selected==='codex'?<Dashboard/>:<LocalAgentView id={state.selected}/>}</>
}
