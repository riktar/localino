import type { AgentId } from '../../../shared/agents'
import claudeLogo from '../../../../icons/claude-code.svg'
import codexLogo from '../../../../icons/codex.png'
import openCodeLogo from '../../../../icons/opencode.svg'
import piLogo from '../../../../icons/pi.svg'

const agentLogos:Record<AgentId,string>={codex:codexLogo,claude:claudeLogo,pi:piLogo,opencode:openCodeLogo}

export function AgentLogo({agent,className=''}:{agent:AgentId;className?:string}):React.JSX.Element {
  return <span className={`agent-logo agent-logo-${agent} ${className}`} aria-hidden="true">
    <img src={agentLogos[agent]} alt=""/>
  </span>
}
