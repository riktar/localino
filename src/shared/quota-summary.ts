import type { Quotas, ResourceState } from './contracts'

/** Keep the provider's windows separate; never invent an aggregate quota. */
export function compactQuota(state: ResourceState<Quotas>) {
  const buckets = state.data?.buckets.filter(bucket => bucket.windows.length) ?? []
  const bucket = buckets.find(bucket => bucket.id === 'codex') ?? buckets[0]
  const window = bucket?.windows.find(window => window.kind === 'primary') ?? bucket?.windows[0]
  const windows = buckets.flatMap(bucket => bucket.windows)
  return {
    bucket, window, count: windows.length,
    remaining: window?.usedPercent == null ? null : Math.max(0, 100 - window.usedPercent),
    otherExhausted: windows.some(other => other !== window && other.usedPercent !== null && other.usedPercent >= 100),
    resetPending: windows.some(window => window.resetsAt !== null && window.resetsAt <= Date.now()),
  }
}
