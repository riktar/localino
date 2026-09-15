import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionState, LocalinoApi, Quotas, ResourceState, Usage } from '../shared/contracts'

const api: LocalinoApi = {
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
