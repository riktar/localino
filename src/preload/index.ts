import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionState, LocalinoApi, Quotas, ResourceState } from '../shared/contracts'

const api: LocalinoApi = {
  hide: (): void => ipcRenderer.send('localino:hide'),
  getConnection: () => ipcRenderer.invoke('localino:connection'),
  connect: () => ipcRenderer.invoke('localino:connect'),
  disconnect: () => ipcRenderer.invoke('localino:disconnect'),
  rereadAccount: () => ipcRenderer.invoke('localino:reread'),
  chooseCodex: () => ipcRenderer.invoke('localino:choose-codex'),
  getQuotas: () => ipcRenderer.invoke('localino:quotas'),
  refreshQuotas: () => ipcRenderer.invoke('localino:refresh-quotas'),
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
