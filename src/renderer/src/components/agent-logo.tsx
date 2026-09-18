import type { AgentId } from '../../../shared/agents'

export function AgentLogo({agent,className=''}:{agent:AgentId;className?:string}):React.JSX.Element {
  return <span className={`agent-logo agent-logo-${agent} ${className}`} aria-hidden="true">
    {agent==='codex'&&<svg viewBox="0 0 32 32" fill="none"><path d="M16 5.2a7.1 7.1 0 0 1 12.1 5.1 7.1 7.1 0 0 1-1 11.9 7.1 7.1 0 0 1-11.2 6.3 7.1 7.1 0 0 1-11.1-6.3 7.1 7.1 0 0 1-1-11.9A7.1 7.1 0 0 1 16 5.2Z"/><path d="m10 12.5 6-3.4 6 3.4v7L16 23l-6-3.5v-7Z"/></svg>}
    {agent==='claude'&&<svg viewBox="0 0 32 32" fill="none"><path d="M16 5v22M5 16h22M8.2 8.2l15.6 15.6M23.8 8.2 8.2 23.8"/></svg>}
    {agent==='pi'&&<svg viewBox="0 0 32 32" fill="none"><path d="M8 11.5h16M11.5 11.5v10.2c0 3 4.5 3 4.5 0V12M21 11.5v12.7"/><circle cx="21" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>}
    {agent==='opencode'&&<svg viewBox="0 0 32 32" fill="none"><path d="m12.5 9-7 7 7 7M19.5 9l7 7-7 7"/><path d="m18 6-4 20"/></svg>}
  </span>
}
