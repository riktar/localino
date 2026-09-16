import type { Quotas, ResourceState } from './contracts'

export const agentIds = ['codex', 'claude', 'pi', 'opencode'] as const
export type AgentId = typeof agentIds[number]
export type LocalAgentId = Exclude<AgentId, 'codex'>
export const agentLabels: Record<AgentId, string> = { codex: 'Codex', claude: 'Claude Code', pi: 'Pi', opencode: 'OpenCode' }
export const isAgentId = (value: unknown): value is AgentId => typeof value === 'string' && agentIds.includes(value as AgentId)
export const isLocalAgentId = (value: unknown): value is LocalAgentId => isAgentId(value) && value !== 'codex'
export type AgentPeriod = '7' | '30' | 'all'
export const isAgentPeriod = (value: unknown): value is AgentPeriod => value === '7' || value === '30' || value === 'all'
export interface AgentSource { enabled: boolean; path: string | null }
export interface AgentsState { selected: AgentId; sources: Record<LocalAgentId, AgentSource>; error: string | null }
export function initialAgents(): AgentsState {
  return { selected: 'codex', sources: { claude: { enabled: false, path: null }, pi: { enabled: false, path: null }, opencode: { enabled: false, path: null } }, error: null }
}
export interface AgentCapabilities { scope: 'account' | 'local_history'; history: boolean; daily: boolean; costs: boolean; quotas: boolean }
export const agentCapabilities: Record<AgentId, AgentCapabilities> = {
  codex: { scope: 'account', history: true, daily: true, costs: false, quotas: true },
  claude: { scope: 'local_history', history: true, daily: true, costs: false, quotas: false },
  pi: { scope: 'local_history', history: true, daily: true, costs: true, quotas: false },
  opencode: { scope: 'local_history', history: true, daily: false, costs: true, quotas: false },
}
export interface TokenMetrics { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; reasoning: number | null; total: number | null; cost: number | null }
export interface HistoryData {
  totals: TokenMetrics
  days: { date: string; tokens: number | null; input?: number | null; cost: number | null }[]
  limitations?: string[]
  sessions: number
  records: number
  issues: number
  partial: boolean
  sampledAt: number | null
  period: AgentPeriod
  semantics: 'events' | 'updated_sessions'
}
export type HistoryError = 'missing' | 'denied' | 'invalid' | 'unsupported' | 'busy' | 'timeout' | 'unavailable'
export interface HistoryState {
  agent: LocalAgentId
  enabled: boolean
  source: string | null
  period: AgentPeriod
  data: HistoryData | null
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  refreshing: boolean
  stale: boolean
  error: HistoryError | null
}
export interface AgentResult { ok: boolean; error?: string }
export interface BridgeState { enabled: boolean; effective: boolean; error: string | null; sessionId: string | null; cost: number | null; receivedAt: number | null; quotas: ResourceState<Quotas>; settingsPath: string }
