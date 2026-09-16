import type { Usage, UsageSummary } from './contracts'
import { record } from './quotas'

const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value
}
export function normalizeUsage(value: unknown): Usage {
  const root = record(value)
  if (!root || !record(root.summary) || (root.dailyUsageBuckets != null && !Array.isArray(root.dailyUsageBuckets))) throw Error('invalid')
  const source = record(root.summary)!
  const summary: UsageSummary = { lifetimeTokens: integer(source.lifetimeTokens), peakDailyTokens: integer(source.peakDailyTokens), longestRunningTurnSec: integer(source.longestRunningTurnSec), currentStreakDays: integer(source.currentStreakDays), longestStreakDays: integer(source.longestStreakDays) }
  const values = new Map<string, number>(); const excluded = new Set<string>(); const dates = new Set<string>()
  let issues = 0
  for (const item of root.dailyUsageBuckets as unknown[] ?? []) {
    const row = record(item)
    if (!validDate(row?.startDate)) { issues++; continue }
    const date = row.startDate; dates.add(date)
    const tokens = integer(row.tokens)
    if (tokens === null || (values.has(date) && values.get(date) !== tokens)) { issues++; excluded.add(date); continue }
    values.set(date, tokens)
  }
  const ordered = [...dates].sort()
  return { summary, days: [...values].filter(([date]) => !excluded.has(date)).sort(([a],[b]) => a.localeCompare(b)).map(([date,tokens]) => ({date,tokens})), issues,
    range: ordered.length ? { start: ordered[0], end: ordered[ordered.length-1] } : null }
}
export type Period = '7' | '30' | 'all'
export function localDate(now = new Date()): string { return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` }
const dayMs = 86_400_000
const stamp = (date: string): number => Date.parse(`${date}T00:00:00Z`)
const dateAt = (time: number): string => new Date(time).toISOString().slice(0,10)

export function usagePeriod(usage: Usage, period: Period, today = localDate()) {
  const end = period === 'all' ? usage.range?.end ?? null : today
  const start = period === 'all' ? usage.range?.start ?? null : dateAt(stamp(today)-(Number(period)-1)*dayMs)
  const days = start && end ? usage.days.filter(d => d.date >= start && d.date <= end) : []
  const expected = start && end ? Math.round((stamp(end)-stamp(start))/dayMs)+1 : 0
  const sum = days.reduce((total,day) => total+day.tokens,0)
  const total = days.length && Number.isSafeInteger(sum) ? sum : null
  const peak = days.length ? days.reduce((a,b) => b.tokens > a.tokens ? b : a) : null
  // Keep gaps explicit without allocating a row for every day in a potentially very large range.
  const rows: { date: string; endDate?: string; tokens: number | null; timestamp: number }[] = []
  let cursor = start ? stamp(start) : 0
  const gap = (from: number,to: number) => { if (from <= to) rows.push({date:dateAt(from),endDate:dateAt(to),tokens:null,timestamp:from}) }
  for (const day of days) {
    const time = stamp(day.date); gap(cursor,time-dayMs)
    rows.push({...day,timestamp:time}); cursor=time+dayMs
  }
  if (end) gap(cursor,stamp(end))
  return { start,end,days,rows,expected,covered:days.length,total,mean:total===null?null:total/days.length,peak,partial:days.length<expected||usage.issues>0,overflow:days.length>0&&total===null }
}
export const numberLabel = (value: number | null): string => value === null ? 'Unavailable' : value.toLocaleString('en-US',{maximumFractionDigits:2})
export function durationSeconds(value: number | null): string {
  if (value === null) return 'Unavailable'
  const days = Math.floor(value/86400); const hours = Math.floor(value%86400/3600); const minutes = Math.floor(value%3600/60)
  return [days ? `${days} d` : '', hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', `${value%60} s`].filter(Boolean).join(' ')
}
