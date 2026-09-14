import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionState, LocalinoApi } from '../shared/contracts'

const api: LocalinoApi = {
  hide: (): void => ipcRenderer.send('localino:hide'),
  getConnection: () => ipcRenderer.invoke('localino:connection'),
  connect: () => ipcRenderer.invoke('localino:connect'),
  disconnect: () => ipcRenderer.invoke('localino:disconnect'),
  rereadAccount: () => ipcRenderer.invoke('localino:reread'),
  chooseCodex: () => ipcRenderer.invoke('localino:choose-codex'),
  onConnection: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: ConnectionState) => listener(state)
    ipcRenderer.on('localino:connection-changed', callback)
    return () => { ipcRenderer.removeListener('localino:connection-changed', callback) }
  },
}
contextBridge.exposeInMainWorld('localino', api)
