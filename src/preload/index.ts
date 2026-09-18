import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionState, LocalinoApi, Quotas, ResourceState, Usage } from '../shared/contracts'

const api: LocalinoApi = {
  getTheme: () => ipcRenderer.invoke('localino:theme'),
  setTheme: theme => ipcRenderer.invoke('localino:set-theme', theme),
  onTheme: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: import('../shared/theme').ThemeState) => listener(state)
    ipcRenderer.on('localino:theme-changed', callback)
    return () => ipcRenderer.removeListener('localino:theme-changed', callback)
  },
  windowAction: action => ipcRenderer.invoke('localino:window-action', action),
  platform: process.platform as 'win32'|'darwin',
  requestCapturePermissions:()=>ipcRenderer.invoke('localino:capture-permissions'),
  getBridge:()=>ipcRenderer.invoke('localino:bridge'),
  setBridgeEnabled:enabled=>ipcRenderer.invoke('localino:bridge-enable',enabled),
  refreshBridge:()=>ipcRenderer.invoke('localino:bridge-refresh'),
  diagnoseBridge:()=>ipcRenderer.invoke('localino:bridge-diagnose'),
  onBridge:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,state:import('../shared/agents').BridgeState)=>listener(state)
    ipcRenderer.on('localino:bridge-changed',callback)
    return ()=>ipcRenderer.removeListener('localino:bridge-changed',callback)
  },
  getAgents: () => ipcRenderer.invoke('localino:agents'),
  selectAgent: id => ipcRenderer.invoke('localino:select-agent', id),
  recoverPreferences: target => ipcRenderer.invoke('localino:recover-preferences', target),
  getHistory: id => ipcRenderer.invoke('localino:history', id),
  connectAgent: id => ipcRenderer.invoke('localino:connect-agent', id),
  chooseAgentSource: id => ipcRenderer.invoke('localino:choose-agent-source', id),
  disconnectAgent: id => ipcRenderer.invoke('localino:disconnect-agent', id),
  refreshHistory: id => ipcRenderer.invoke('localino:refresh-history', id),
  setAgentPeriod: (id, period) => ipcRenderer.invoke('localino:agent-period', { id, period }),
  onAgents: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: import('../shared/agents').AgentsState) => listener(state)
    ipcRenderer.on('localino:agents-changed', callback)
    return () => { ipcRenderer.removeListener('localino:agents-changed', callback) }
  },
  onHistory: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: import('../shared/agents').HistoryState) => listener(state)
    ipcRenderer.on('localino:history-changed', callback)
    return () => { ipcRenderer.removeListener('localino:history-changed', callback) }
  },
  getLiveSessions:()=>ipcRenderer.invoke('localino:live-sessions'),
  startLiveSession:agent=>ipcRenderer.invoke('localino:start-live-session',agent),
  stopLiveSession:sessionId=>ipcRenderer.invoke('localino:stop-live-session',sessionId),
  sendLiveSession:(sessionId,text)=>ipcRenderer.invoke('localino:send-live-session',{sessionId,text}),
  cancelLiveDelivery:(sessionId,deliveryId)=>ipcRenderer.invoke('localino:cancel-live-delivery',{sessionId,deliveryId}),
  setLiveSessionDraft:(sessionId,text)=>ipcRenderer.invoke('localino:set-live-session-draft',{sessionId,text}),
  discardRecoveredSession:sessionId=>ipcRenderer.invoke('localino:discard-recovered-session',sessionId),
  onLiveSessions:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,state:import('../shared/sessions').LiveSessionsState)=>listener(state)
    ipcRenderer.on('localino:live-sessions-changed',callback)
    return ()=>{ipcRenderer.removeListener('localino:live-sessions-changed',callback)}
  },
  getCapturedNote:()=>ipcRenderer.invoke('localino:captured-note'),
  capturedNotePresented:sequence=>ipcRenderer.invoke('localino:captured-note-presented',sequence),
  onCapturedNote:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,note:import('../shared/capture').CapturedNote)=>listener(note)
    ipcRenderer.on('localino:note-captured',callback)
    return ()=>{ipcRenderer.removeListener('localino:note-captured',callback)}
  },
  getCaptureStatus:()=>ipcRenderer.invoke('localino:capture-status'),
  requestCapture:()=>ipcRenderer.invoke('localino:capture-request'),
  setCaptureEnabled:value=>ipcRenderer.invoke('localino:capture-enable',value),
  retryCapture:()=>ipcRenderer.invoke('localino:capture-retry'),
  getCaptureDraft:()=>ipcRenderer.invoke('localino:capture-draft'),
  capturePresented:id=>ipcRenderer.invoke('localino:capture-presented',id),
  cancelCapture:id=>ipcRenderer.invoke('localino:capture-cancel',id),
  saveCapture:(id,text)=>ipcRenderer.invoke('localino:capture-save',{id,text}),
  onCaptureStatus:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,state:import('../shared/capture').CaptureStatus)=>listener(state)
    ipcRenderer.on('localino:capture-status',callback)
    return ()=>{ipcRenderer.removeListener('localino:capture-status',callback)}
  },
  onCaptureDraft:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,draft:import('../shared/capture').CaptureDraft|null)=>listener(draft)
    ipcRenderer.on('localino:capture-draft',callback)
    return ()=>{ipcRenderer.removeListener('localino:capture-draft',callback)}
  },
  getShortcuts:()=>ipcRenderer.invoke('localino:shortcuts'),
  updateShortcuts:value=>ipcRenderer.invoke('localino:update-shortcuts',value),
  openPanel:()=>ipcRenderer.invoke('localino:panel'),
  requestCommand:id=>ipcRenderer.invoke('localino:request-command',id),
  onCommand:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,id:'new'|'palette')=>listener(id)
    ipcRenderer.on('localino:command',callback)
    return ()=>{ipcRenderer.removeListener('localino:command',callback)}
  },
  onShortcuts:listener=>{
    const callback=(_event:Electron.IpcRendererEvent,state:import('../shared/commands').ShortcutState)=>listener(state)
    ipcRenderer.on('localino:shortcuts-changed',callback)
    return ()=>{ipcRenderer.removeListener('localino:shortcuts-changed',callback)}
  },
  getNotes: () => ipcRenderer.invoke('localino:notes'),
  reloadNotes: () => ipcRenderer.invoke('localino:reload-notes'),
  mutateNote: action => ipcRenderer.invoke('localino:mutate-note',action),
  copyNotes: ids => ipcRenderer.invoke('localino:copy-notes',ids),
  onNotes: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: import('../shared/notes').NotesState) => listener(state)
    ipcRenderer.on('localino:notes-changed',callback)
    return () => { ipcRenderer.removeListener('localino:notes-changed',callback) }
  },
  setUnsaved: value => ipcRenderer.send('localino:unsaved',value),
  onActionRequest: listener => {
    const callback = (_event: Electron.IpcRendererEvent, request: import('../shared/actions').ActionRequest) => listener(request)
    ipcRenderer.on('localino:action-request',callback)
    return () => { ipcRenderer.removeListener('localino:action-request',callback) }
  },
  resolveAction: (id,proceed) => ipcRenderer.invoke('localino:resolve-action',{id,proceed}),
  quit: () => ipcRenderer.invoke('localino:quit'),
  navigate: destination => ipcRenderer.invoke('localino:navigate', destination),
  getDestination: () => ipcRenderer.invoke('localino:destination'),
  onNavigate: listener => {
    const callback = (_event: Electron.IpcRendererEvent, destination: import('../shared/navigation').Destination) => listener(destination)
    ipcRenderer.on('localino:navigated', callback)
    return () => { ipcRenderer.removeListener('localino:navigated', callback) }
  },
  hide: (): void => ipcRenderer.send('localino:hide'),
  getConnection: () => ipcRenderer.invoke('localino:connection'),
  connect: () => ipcRenderer.invoke('localino:connect'),
  disconnect: () => ipcRenderer.invoke('localino:disconnect'),
  rereadAccount: () => ipcRenderer.invoke('localino:reread'),
  chooseCodex: () => ipcRenderer.invoke('localino:choose-codex'),
  getQuotas: () => ipcRenderer.invoke('localino:quotas'),
  refreshQuotas: () => ipcRenderer.invoke('localino:refresh-quotas'),
  openDashboard: () => ipcRenderer.invoke('localino:open-dashboard'),
  getUsage: () => ipcRenderer.invoke('localino:usage'),
  refreshUsage: () => ipcRenderer.invoke('localino:refresh-usage'),
  onUsage: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: ResourceState<Usage>) => listener(state)
    ipcRenderer.on('localino:usage-changed', callback)
    return () => { ipcRenderer.removeListener('localino:usage-changed',callback) }
  },
  onQuotas: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: ResourceState<Quotas>) => listener(state)
    ipcRenderer.on('localino:quotas-changed', callback)
    return () => { ipcRenderer.removeListener('localino:quotas-changed', callback) }
  },
  onConnection: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: ConnectionState) => listener(state)
    ipcRenderer.on('localino:connection-changed', callback)
    return () => { ipcRenderer.removeListener('localino:connection-changed', callback) }
  },
}
contextBridge.exposeInMainWorld('localino', api)
