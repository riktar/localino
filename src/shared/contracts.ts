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
export interface Credits { hasCredits: boolean | null; unlimited: boolean | null; balance: string | null }
export interface QuotaBucket { id: string; name: string; windows: QuotaWindow[]; credits?: Credits | null }
export interface Quotas { buckets: QuotaBucket[]; availableResets?: number | null }
export interface UsageSummary {
  lifetimeTokens: number | null
  peakDailyTokens: number | null
  longestRunningTurnSec: number | null
  currentStreakDays: number | null
  longestStreakDays: number | null
}
export interface Usage { summary: UsageSummary; days: { date: string; tokens: number }[]; issues: number; range: { start: string; end: string } | null }
export interface ResourceState<T> {
  data: T | null
  lastSuccessAt: number | null
  refreshing: boolean
  stale: boolean
  error: 'timeout' | 'unavailable' | 'unsupported' | 'invalid' | null
}

export interface LocalinoApi {
  getNotes: () => Promise<import('./notes').NotesState>
  reloadNotes: () => Promise<import('./notes').NotesState>
  mutateNote: (action: import('./notes').NoteMutation) => Promise<import('./notes').NoteResult>
  copyNote: (id: string) => Promise<{ok:boolean;error?:string}>
  onNotes: (listener: (state: import('./notes').NotesState) => void) => () => void
  setUnsaved: (value: boolean) => void
  onActionRequest: (listener: (request: import('./actions').ActionRequest) => void) => () => void
  resolveAction: (id: number, proceed: boolean) => Promise<void>
  quit: () => Promise<void>
  navigate: (destination: import('./navigation').Destination) => Promise<void>
  getDestination: () => Promise<import('./navigation').Destination>
  onNavigate: (listener: (destination: import('./navigation').Destination) => void) => () => void
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
  openDashboard: () => Promise<void>
  getUsage: () => Promise<ResourceState<Usage>>
  refreshUsage: () => Promise<void>
  onUsage: (listener: (state: ResourceState<Usage>) => void) => () => void
}
