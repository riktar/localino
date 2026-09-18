import { useEffect, useState } from 'react'
import { initialAgents, type AgentId, type AgentsState, type LocalAgentId } from '../../../shared/agents'
import { useCommands } from './commands'
import { Button } from './ui/button'
import { Dashboard } from './dashboard'
import { LocalHistory } from './local-history'
import { LiveSessions } from './live-sessions'
import { AgentSwitcher } from './agent-switcher'

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
  return <div className="workspace-agent-bar">
    <AgentSwitcher selected={state.selected} onSelect={(id:AgentId)=>void window.localino.selectAgent(id).then(result=>setError(result.error))}/>
    <div className="workspace-agent-context"><span>Active workspace</span><strong>Usage, sessions and local history</strong></div>
    {(state.error||error)&&<p role="alert" className="text-sm text-destructive">{state.error||error}</p>}
    {state.error&&<Button variant="outline" onClick={()=>void window.localino.recoverPreferences('agents')}>Recover agent preferences</Button>}
  </div>
}
export function LocalAgentView({id}:{id:LocalAgentId}): React.JSX.Element {
  return <LocalHistory key={id} id={id}/>
}
export function AgentDashboard(): React.JSX.Element {
  const state=useAgents()
  return <><AgentPicker/><LiveSessions agent={state.selected}/>{state.selected==='codex'?<Dashboard/>:<LocalAgentView id={state.selected}/>}</>
}
