import { agentIds, isAgentId, type AgentId } from './agents'

export const sessionStatuses = ['starting','ready','idle','running','waiting','stopping','stopped','unknown','error'] as const
export type SessionStatus = typeof sessionStatuses[number]
export type SessionProtocol = 'codex-app-server'|'claude-stream-json'|'pi-rpc'|'opencode-server'
export type DeliveryStatus = 'queued'|'sending'|'sent'|'failed'|'unknown'|'suspended'|'cancelled'
export type TurnOutcome = 'completed'|'interrupted'|'failed'

export interface SessionCapability {
  agent: AgentId
  status: 'checking'|'available'|'missing'|'error'
  protocol: SessionProtocol
  version: string|null
  error: string|null
}

export interface SessionDelivery {
  id: string
  text: string
  createdAt: number
  status: DeliveryStatus
  error: string|null
}

export interface LiveSession {
  id: string
  agent: AgentId
  protocol: SessionProtocol
  projectPath: string
  projectName: string
  providerSessionId: string|null
  status: SessionStatus
  createdAt: number
  turnStartedAt: number|null
  turnElapsedMs: number|null
  lastTurnOutcome: TurnOutcome|null
  updatedAt: number
  error: string|null
  deliveries: SessionDelivery[]
  draft: string
}

export interface RecoveredSession {
  id: string
  agent: AgentId
  projectPath: string
  projectName: string
  providerSessionId: string|null
  updatedAt: number
  draft: string
  deliveries: SessionDelivery[]
}

export interface LiveSessionsState {
  capabilities: Record<AgentId,SessionCapability>
  sessions: LiveSession[]
  recovered: RecoveredSession[]
  persistenceError: string|null
}

export interface SessionResult { ok: boolean; sessionId?: string; error?: string }

export const sessionProtocols: Record<AgentId,SessionProtocol> = {
  codex:'codex-app-server',claude:'claude-stream-json',pi:'pi-rpc',opencode:'opencode-server',
}

export function initialLiveSessions(): LiveSessionsState {
  return {capabilities:Object.fromEntries(agentIds.map(agent=>[agent,{agent,status:'checking',protocol:sessionProtocols[agent],version:null,error:null}])) as Record<AgentId,SessionCapability>,sessions:[],recovered:[],persistenceError:null}
}

export function isSessionStart(value:unknown):value is {agent:AgentId;projectPath:string} {
  if(!value||typeof value!=='object')return false
  const item=value as {agent?:unknown;projectPath?:unknown}
  return isAgentId(item.agent)&&typeof item.projectPath==='string'&&item.projectPath.length>0&&item.projectPath.length<=32768
}

export function isSessionText(value:unknown):value is {sessionId:string;text:string} {
  if(!value||typeof value!=='object')return false
  const item=value as {sessionId?:unknown;text?:unknown}
  return typeof item.sessionId==='string'&&item.sessionId.length>0&&item.sessionId.length<=128&&typeof item.text==='string'&&item.text.trim().length>0&&item.text.length<=100_000
}

export function isSessionDelivery(value:unknown):value is {sessionId:string;deliveryId:string} {
  if(!value||typeof value!=='object')return false
  const item=value as {sessionId?:unknown;deliveryId?:unknown}
  return typeof item.sessionId==='string'&&item.sessionId.length>0&&item.sessionId.length<=128&&typeof item.deliveryId==='string'&&item.deliveryId.length>0&&item.deliveryId.length<=128
}

export function isSessionDraft(value:unknown):value is {sessionId:string;text:string} {
  if(!value||typeof value!=='object')return false
  const item=value as {sessionId?:unknown;text?:unknown}
  return typeof item.sessionId==='string'&&item.sessionId.length>0&&item.sessionId.length<=128&&typeof item.text==='string'&&item.text.length<=100_000
}
