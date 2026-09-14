import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, Tray } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Connection } from './codex/connection'
import { FilePreferences } from './codex/preferences'
import { isTrustedSender } from './security'
import { Resource } from './codex/resource'
import { freshness, normalizeQuotas, quotaResets, quotaSummary } from '../shared/quotas'

const customData = app.commandLine.getSwitchValue('user-data-dir')
if (customData) { mkdirSync(resolve(customData), { recursive: true }); app.setPath('userData', resolve(customData)) }
const connection = new Connection(new FilePreferences(join(app.getPath('userData'), 'connection.json')))
const quotas = new Resource(connection, { method: 'account/rateLimits/read', normalize: normalizeQuotas, interval: 60_000, staleAfter: 180_000, resets: quotaResets })
connection.on('ratesChanged', () => void quotas.refresh())

let panel: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let quitReady = false

function showPanel(): void {
  if (!panel) return
  if (panel.isMinimized()) panel.restore()
  panel.show()
  panel.focus()
  void quotas.refresh()
}

function updateTray(): void {
  if (!tray) return
  const connected = connection.state.status === 'connected'
  const status = connected ? `Codex collegato · ${freshness(quotas.state)}` : connection.state.status === 'connecting' ? 'Collegamento Codex…' : 'Codex non collegato'
  const summary = quotaSummary(quotas.state)
  const timestamp = quotas.state.lastSuccessAt === null ? 'Nessuna lettura riuscita' : `Ultima lettura ${new Date(quotas.state.lastSuccessAt).toLocaleTimeString('it-IT')}`
  tray.setToolTip(`Localino · ${status}${connected ? ` · ${summary}` : ''}`.slice(0,127))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    ...(connected ? [{ label: summary, enabled: false }, { label: timestamp, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Apri Localino', click: showPanel },
    { label: 'Aggiorna quote', enabled: connected, click: () => void quotas.refresh() },
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() },
  ]))
}

function createTrayIcon(): Electron.NativeImage {
  const pixels = Buffer.alloc(16 * 16 * 4)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const index = (y * 16 + x) * 4
      const letter = (x >= 4 && x <= 6 && y >= 3 && y <= 12) ||
        (x >= 4 && x <= 12 && y >= 10 && y <= 12)
      pixels.set(letter ? [40, 35, 28, 255] : [104, 194, 238, 255], index)
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: 16, height: 16 })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showPanel)
  app.on('activate', showPanel)
  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    quotas.dispose()
    void connection.shutdown().finally(() => { quitReady = true; app.quit() })
  })
  app.on('window-all-closed', () => { if (quitting) app.quit() })

  app.whenReady().then(async () => {
    app.setAppUserModelId('app.localino.desktop')
    Menu.setApplicationMenu(null)
    panel = new BrowserWindow({
      width: 420,
      height: 640,
      minWidth: 360,
      minHeight: 460,
      title: 'Localino',
      backgroundColor: '#faf9f6',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    panel.webContents.on('will-navigate', (event) => event.preventDefault())
    panel.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    panel.webContents.session.setPermissionCheckHandler(() => false)
    panel.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        panel?.hide()
      }
    })
    ipcMain.on('localino:hide', (event) => {
      if (panel && isTrustedSender(event.sender, event.senderFrame, [panel.webContents])) {
        panel.hide()
      }
    })
    const handle = (channel: string, action: () => unknown) => ipcMain.handle(channel, event => {
      if (!panel || !isTrustedSender(event.sender, event.senderFrame, [panel.webContents])) throw new Error('Access denied')
      return action()
    })
    handle('localino:connection', () => connection.state)
    handle('localino:quotas', () => quotas.state)
    handle('localino:refresh-quotas', () => quotas.refresh())
    handle('localino:connect', () => connection.connect())
    handle('localino:reread', () => connection.connect())
    handle('localino:disconnect', () => connection.disconnect())
    handle('localino:choose-codex', async () => {
      const choice = await dialog.showOpenDialog(panel!, { title: 'Seleziona Codex', properties: ['openFile'], filters: [{ name: 'Codex', extensions: ['exe'] }] })
      if (!choice.canceled && choice.filePaths[0]) await connection.connect(choice.filePaths[0])
    })
    connection.on('change', state => {
      if (panel && !panel.isDestroyed()) panel.webContents.send('localino:connection-changed', state)
      updateTray()
    })
    quotas.on('change', state => {
      if (panel && !panel.isDestroyed()) panel.webContents.send('localino:quotas-changed', state)
      updateTray()
    })
    powerMonitor.on('suspend', () => quotas.suspend())
    powerMonitor.on('resume', () => quotas.resume())
    tray = new Tray(createTrayIcon())
    updateTray()
    tray.on('click', () => panel?.isVisible() ? panel.hide() : showPanel())
    panel.once('ready-to-show', showPanel)
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      await panel.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      await panel.loadFile(join(__dirname, '../renderer/index.html'))
    }
    void connection.autoConnect()
  }).catch((error: unknown) => {
    console.error('Impossibile avviare Localino', error)
    app.exit(1)
  })
  app.on('will-quit', () => { tray?.destroy() })
}
