export type ConnectionError = 'cli_missing' | 'cli_invalid' | 'incompatible' | 'unauthenticated' | 'unsupported_auth' | 'timeout' | 'transport' | 'preferences'

export interface Account { email: string | null; plan: string | null }
export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  account: Account | null
  error: ConnectionError | null
}

export interface QuotaWindow {
  kind: 'primary' | 'secondary'
  usedPercent: number | null
  durationMins: number | null
  resetsAt: number | null
}
export interface QuotaBucket { id: string; name: string; windows: QuotaWindow[] }
export interface Quotas { buckets: QuotaBucket[] }
export interface ResourceState<T> {
  data: T | null
  lastSuccessAt: number | null
  refreshing: boolean
  stale: boolean
  error: 'timeout' | 'unavailable' | 'unsupported' | 'invalid' | null
}

export interface LocalinoApi {
  hide: () => void
  getConnection: () => Promise<ConnectionState>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  rereadAccount: () => Promise<void>
  chooseCodex: () => Promise<void>
  onConnection: (listener: (state: ConnectionState) => void) => () => void
  getQuotas: () => Promise<ResourceState<Quotas>>
  refreshQuotas: () => Promise<void>
  onQuotas: (listener: (state: ResourceState<Quotas>) => void) => () => void
}
