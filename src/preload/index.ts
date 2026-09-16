import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionState, LocalinoApi, Quotas, ResourceState, Usage } from '../shared/contracts'

const api: LocalinoApi = {
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
    const callback=(_event:Electron.IpcRendererEvent,draft:import('../shared/capture').CaptureDraft)=>listener(draft)
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
  copyNote: id => ipcRenderer.invoke('localino:copy-note',id),
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
