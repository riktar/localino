import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { agentIds, agentLabels, type AgentId } from '../../../shared/agents'
import { AgentLogo } from './agent-logo'

export function AgentSwitcher({selected,onSelect,compact=false}:{selected:AgentId;onSelect:(id:AgentId)=>void;compact?:boolean}):React.JSX.Element {
  const [open,setOpen]=useState(false)
  const root=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(!open)return
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('.agent-trigger')?.focus()}}
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)}
  },[open])
  const choose=(id:AgentId)=>{setOpen(false);if(id!==selected)onSelect(id)}
  return <div ref={root} className={`agent-switcher ${compact?'agent-switcher-compact':''}`}>
    <button type="button" className="agent-trigger" aria-label={`Agent: ${agentLabels[selected]}`} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <AgentLogo agent={selected}/><span className="agent-trigger-copy"><strong>{agentLabels[selected]}</strong><span>{open?'Choose another agent':'Switch agent'}</span></span>
    </button>
    <div className="agent-menu" role="menu" aria-label="Agents" data-open={open||undefined}>
      {agentIds.map((id,index)=><button key={id} type="button" role="menuitemradio" aria-checked={id===selected} aria-label={agentLabels[id]} className="agent-option" style={{'--option-index':index} as React.CSSProperties} onClick={()=>choose(id)}>
        <AgentLogo agent={id}/><span>{agentLabels[id]}</span>{id===selected&&<Check className="agent-check"/>}
      </button>)}
    </div>
  </div>
}
