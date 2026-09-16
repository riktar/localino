import type { AgentPeriod, HistoryData, TokenMetrics } from '../../shared/agents'

export interface UsageEvent { id: string; session: string; sessions?: string[]; time: number; metrics: TokenMetrics }
const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total', 'cost'] as const
export const blankMetrics = (): TokenMetrics => ({ input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, total: null, cost: null })
export function sum(values: (number | null)[], integral = true): number | null {
  if (values.some(value => value === null)) return null
  const total = (values as number[]).reduce((a, b) => a + b, 0)
  return Number.isFinite(total) && (!integral || Number.isSafeInteger(total)) ? total : null
}
export function dayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function aggregate(events: UsageEvent[], period: AgentPeriod, issues: number, now = Date.now()): HistoryData {
  const first = new Date(now); first.setHours(0, 0, 0, 0)
  if (period !== 'all') first.setDate(first.getDate() - Number(period) + 1)
  const end = new Date(now); end.setHours(24, 0, 0, 0)
  const selected = events.filter(event => (period === 'all' || event.time >= first.getTime()) && event.time < end.getTime())
  const totals = blankMetrics()
  for (const key of keys) totals[key] = selected.length ? sum(selected.map(event => event.metrics[key]), key !== 'cost') : (issues || key === 'reasoning' || key === 'cost' ? null : 0)
  const groups = new Map<string, UsageEvent[]>()
  for (const event of selected) { const day = dayKey(event.time); const group = groups.get(day) ?? []; group.push(event); groups.set(day, group) }
  return {
    totals, days: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, group]) => ({ date, tokens: sum(group.map(e => e.metrics.total)), input: sum(group.map(e => e.metrics.input)), cost: sum(group.map(e => e.metrics.cost), false) })),
    sessions: new Set(selected.flatMap(event => event.sessions ?? [event.session])).size, records: selected.length, issues, partial: issues > 0,
    sampledAt: selected.length ? selected.reduce((latest, event) => Math.max(latest, event.time), 0) : null, period, semantics: 'events',
  }
}
