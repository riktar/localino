import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('localino', {
  hide: (): void => ipcRenderer.send('localino:hide'),
})
