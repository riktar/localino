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
  getChatHistory: (sessionId:string) => Promise<import('./terminal').ChatHistory>
  loadEarlierChat: (sessionId:string) => Promise<import('./terminal').ChatHistory>
  loadLatestChat: (sessionId:string) => Promise<import('./terminal').ChatHistory>
  onChatHistory: (listener:(history:import('./terminal').ChatHistory)=>void) => () => void
  openTerminal: (viewport: import('./terminal').TerminalViewport) => Promise<void>
  closeTerminal: (viewId: string) => Promise<void>
  onTerminalFrame: (listener: (frame: import('./terminal').TerminalFrame) => void) => () => void
  getTheme: () => Promise<import('./theme').ThemeState>
  setTheme: (theme: import('./theme').Theme) => Promise<import('./theme').ThemeState>
  onTheme: (listener: (state: import('./theme').ThemeState) => void) => () => void
  windowAction: (action: 'minimize' | 'maximize') => Promise<void>
  getBridge: () => Promise<import('./agents').BridgeState>
  setBridgeEnabled: (enabled:boolean) => Promise<import('./agents').AgentResult>
  refreshBridge: () => Promise<void>
  diagnoseBridge: () => Promise<string>
  onBridge: (listener:(state:import('./agents').BridgeState)=>void) => () => void
  getAgents: () => Promise<import('./agents').AgentsState>
  onAgents: (listener: (state: import('./agents').AgentsState) => void) => () => void
  selectAgent: (id: import('./agents').AgentId) => Promise<import('./agents').AgentResult>
  recoverPreferences: (target: 'agents' | 'codex') => Promise<import('./agents').AgentResult>
  getHistory: (id: import('./agents').LocalAgentId) => Promise<import('./agents').HistoryState>
  onHistory: (listener: (state: import('./agents').HistoryState) => void) => () => void
  getLiveSessions: () => Promise<import('./sessions').LiveSessionsState>
  startLiveSession: (agent: import('./agents').AgentId) => Promise<import('./sessions').SessionResult>
  stopLiveSession: (sessionId: string) => Promise<import('./sessions').SessionResult>
  sendLiveSession: (sessionId: string, text: string) => Promise<import('./sessions').SessionResult>
  cancelLiveDelivery: (sessionId: string, deliveryId: string) => Promise<import('./sessions').SessionResult>
  respondToSessionInteraction: (response: import('./sessions').SessionInteractionResponse) => Promise<import('./sessions').SessionResult>
  setLiveSessionDraft: (sessionId: string, text: string) => Promise<import('./sessions').SessionResult>
  discardRecoveredSession: (sessionId: string) => Promise<import('./sessions').SessionResult>
  onLiveSessions: (listener: (state: import('./sessions').LiveSessionsState) => void) => () => void
  connectAgent: (id: import('./agents').LocalAgentId) => Promise<import('./agents').AgentResult>
  chooseAgentSource: (id: import('./agents').LocalAgentId) => Promise<import('./agents').AgentResult>
  disconnectAgent: (id: import('./agents').LocalAgentId) => Promise<import('./agents').AgentResult>
  refreshHistory: (id: import('./agents').LocalAgentId) => Promise<void>
  setAgentPeriod: (id: import('./agents').LocalAgentId, period: import('./agents').AgentPeriod) => Promise<void>
  getCapturedNote: () => Promise<import('./capture').CapturedNote|null>
  onCapturedNote: (listener:(note:import('./capture').CapturedNote)=>void)=>()=>void
  capturedNotePresented: (sequence:number) => Promise<void>

  getCaptureStatus: () => Promise<import('./capture').CaptureStatus>
  onCaptureStatus: (listener:(state:import('./capture').CaptureStatus)=>void)=>()=>void
  requestCapture: () => Promise<void>
  setCaptureEnabled: (value:boolean) => Promise<{ok:boolean;error?:string}>
  retryCapture: () => Promise<void>
  requestCapturePermissions: () => Promise<void>
  platform: 'win32' | 'darwin'
  getCaptureDraft: () => Promise<import('./capture').CaptureDraft|null>
  onCaptureDraft: (listener:(draft:import('./capture').CaptureDraft|null)=>void)=>()=>void
  capturePresented: (id:number) => Promise<void>
  cancelCapture: (id:number) => Promise<void>
  saveCapture: (id:number,text:string) => Promise<{ok:boolean;error?:string}>

  getShortcuts: () => Promise<import('./commands').ShortcutState>
  updateShortcuts: (value: unknown) => Promise<import('./commands').ShortcutResult>
  onShortcuts: (listener:(state:import('./commands').ShortcutState)=>void)=>()=>void
  openPanel: () => Promise<void>
  requestCommand: (id:'new'|'palette'|'clipboard')=>Promise<void>
  onCommand: (listener:(id:'new'|'palette')=>void)=>()=>void
  getNotes: () => Promise<import('./notes').NotesState>
  reloadNotes: () => Promise<import('./notes').NotesState>
  mutateNote: (action: import('./notes').NoteMutation) => Promise<import('./notes').NoteResult>
  copyNotes: (ids: string[]) => Promise<{ok:boolean;error?:string}>
  onNotes: (listener: (state: import('./notes').NotesState) => void) => () => void
  setUnsaved: (value: boolean) => void
  onActionRequest: (listener: (request: import('./actions').ActionRequest) => void) => () => void
  resolveAction: (id: number, proceed: boolean) => Promise<void>
  quit: () => Promise<void>
  navigate: (destination: import('./navigation').Destination) => Promise<boolean>
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
