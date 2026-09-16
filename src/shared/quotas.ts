import type { QuotaBucket, Quotas, QuotaWindow, ResourceState } from './contracts'

export const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
export const nonnegative = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export const label = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : null

export function normalizeQuotas(value: unknown): Quotas {
  const root = record(value)
  if (!root || !('rateLimits' in root || 'rateLimitsByLimitId' in root)) throw Error('invalid')
  const map = record(root.rateLimitsByLimitId)
  const legacy = record(root.rateLimits)
  if ((root.rateLimitsByLimitId != null && !map) || (root.rateLimits != null && !legacy) || (!map && !legacy)) throw Error('invalid')
  if (map && Object.values(map).some(value => !record(value))) throw Error('invalid')
  const entries = map ? Object.entries(map) : [[label(legacy?.limitId) ?? 'codex', legacy] as const]
  const buckets: QuotaBucket[] = entries.map(([id, value]) => {
    const bucket = record(value)
    const windows: QuotaWindow[] = []
    for (const kind of ['primary', 'secondary'] as const) {
      if (bucket?.[kind] == null) continue
      const window = record(bucket[kind])
      const duration = nonnegative(window?.windowDurationMins)
      const seconds = nonnegative(window?.resetsAt)
      windows.push({ kind, usedPercent: nonnegative(window?.usedPercent), durationMins: duration && Number.isSafeInteger(duration) ? duration : null,
        resetsAt: seconds !== null && Number.isSafeInteger(seconds) && seconds <= 8_640_000_000_000 ? seconds * 1000 : null })
    }
    const credits = record(bucket?.credits)
    return { id, name: label(bucket?.limitName) ?? id, windows, credits: credits ? {
      hasCredits: typeof credits.hasCredits === 'boolean' ? credits.hasCredits : null,
      unlimited: typeof credits.unlimited === 'boolean' ? credits.unlimited : null,
      balance: label(credits.balance),
    } : null }
  }).sort((a,b) => a.id.localeCompare(b.id))
  const count = nonnegative(record(root.rateLimitResetCredits)?.availableCount)
  return { buckets, availableResets: count !== null && Number.isSafeInteger(count) ? count : null }
}

export function durationLabel(minutes: number | null): string {
  if (minutes === null) return 'Unknown duration'
  if (minutes % 1440 === 0) return `${minutes / 1440} days`
  if (minutes % 60 === 0) return `${minutes / 60} hours`
  return `${minutes} minutes`
}
export function countdown(timestamp: number, now: number): string {
  const minutes = Math.ceil((timestamp - now) / 60_000)
  if (minutes <= 0) return 'Reset needs verification'
  if (minutes < 60) return `in ${minutes} min`
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`
  return `in ${Math.floor(minutes / 1440)} d ${Math.floor(minutes % 1440 / 60)} h`
}
export const quotaResets = (data: Quotas): number[] => data.buckets.flatMap(b => b.windows.flatMap(w => w.resetsAt === null ? [] : [w.resetsAt]))
export function freshness<T>(state: ResourceState<T>): string {
  if (state.stale && state.data !== null) return 'Stale'
  if (state.error) return 'Unavailable'
  if (state.refreshing && state.lastSuccessAt === null) return 'Refreshing'
  return state.lastSuccessAt === null ? 'Waiting' : 'Updated'
}
export function quotaSummary(state: ResourceState<Quotas>): string {
  const bucket = state.data?.buckets.find(b => b.id === 'codex') ?? state.data?.buckets[0]
  if (!bucket) return 'Quotas unavailable'
  return `${bucket.name}: ${bucket.windows.map(w => `${durationLabel(w.durationMins)} ${w.usedPercent === null ? 'unavailable' : `${Math.max(0,100-w.usedPercent)}% remaining`}`).join(' · ') || 'no windows available'}`
}
