import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, Tray } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Connection } from './codex/connection'
import { FilePreferences } from './codex/preferences'
import { isTrustedSender } from './security'
import { Resource } from './codex/resource'
import { freshness, normalizeQuotas, quotaResets, quotaSummary } from '../shared/quotas'
import { normalizeUsage } from '../shared/usage'
import { destinationLabels, isDestination, type Destination } from '../shared/navigation'

const customData = app.commandLine.getSwitchValue('user-data-dir')
if (customData) { mkdirSync(resolve(customData), { recursive: true }); app.setPath('userData', resolve(customData)) }
const connection = new Connection(new FilePreferences(join(app.getPath('userData'), 'connection.json')))
const quotas = new Resource(connection, { method: 'account/rateLimits/read', normalize: normalizeQuotas, interval: 60_000, staleAfter: 180_000, resets: quotaResets })
connection.on('ratesChanged', () => void quotas.refresh())
const usage = new Resource(connection, { method: 'account/usage/read', normalize: normalizeUsage, interval: 300_000, staleAfter: 300_000 })
usage.setActive(false)

let panel: BrowserWindow | null = null
let dashboard: BrowserWindow | null = null
let destination: Destination = 'home'
let tray: Tray | null = null
let quitting = false
let quitReady = false

const ownedWindows = (): BrowserWindow[] => [panel,dashboard].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed())
function broadcast(channel: string, value: unknown): void { for (const window of ownedWindows()) window.webContents.send(channel,value) }
function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
}
async function loadWindow(window: BrowserWindow, dashboardView = false): Promise<void> {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (dashboardView) url.searchParams.set('view','main')
    await window.loadURL(url.toString())
  } else await window.loadFile(join(__dirname,'../renderer/index.html'), dashboardView ? { query: { view:'main' } } : {})
}
function updateUsageActivity(): void { usage.setActive(destination === 'consumi' && !!dashboard?.isVisible() && !dashboard.isMinimized()) }
async function showMain(next: Destination = 'home'): Promise<void> {
  destination = next
  if (dashboard && !dashboard.isDestroyed()) {
    if (dashboard.isMinimized()) dashboard.restore()
    dashboard.setTitle(`Localino ? ${destinationLabels[destination]}`)
    dashboard.webContents.send('localino:navigated', destination)
    dashboard.show(); dashboard.focus(); updateUsageActivity(); return
  }
  dashboard = new BrowserWindow({ width:1120,height:800,minWidth:800,minHeight:600,title:'Localino — Statistiche Codex',backgroundColor:'#faf9f6',show:false,autoHideMenuBar:true,
    webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true} })
  const window = dashboard
  secureWindow(window)
  window.on('page-title-updated', event => event.preventDefault())
  window.on('show', updateUsageActivity)
  window.on('minimize', updateUsageActivity)
  window.on('restore', updateUsageActivity)
  window.on('hide', () => usage.setActive(false))
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide() } })
  window.on('closed', () => { dashboard = null; usage.setActive(false) })
  window.once('ready-to-show', () => { window.show(); window.focus() })
  await loadWindow(window,true)
}

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
    { label: 'Apri Home', click: () => { void showMain('home') } },
    { label: 'Apri Consumi', click: () => { void showMain('consumi') } },
    { label: 'Apri Clipboard', click: () => { void showMain('clipboard') } },
    { label: 'Scorciatoie', click: () => { void showMain('shortcuts') } },
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
  app.on('second-instance', () => { void showMain('home') })
  app.on('activate', () => { void showMain('home') })
  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    quotas.dispose()
    usage.dispose()
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
    secureWindow(panel)
    panel.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        panel?.hide()
      }
    })
    ipcMain.on('localino:hide', (event) => {
      if (isTrustedSender(event.sender, event.senderFrame, ownedWindows().map(w => w.webContents))) {
        BrowserWindow.fromWebContents(event.sender)?.hide()
      }
    })
    const handle = (channel: string, action: (owner: BrowserWindow, value: unknown) => unknown) => ipcMain.handle(channel, (event, value: unknown) => {
      if (!isTrustedSender(event.sender, event.senderFrame, ownedWindows().map(w => w.webContents))) throw new Error('Access denied')
      return action(BrowserWindow.fromWebContents(event.sender)!, value)
    })
    handle('localino:connection', () => connection.state)
    handle('localino:quotas', () => quotas.state)
    handle('localino:refresh-quotas', () => quotas.refresh())
    handle('localino:open-dashboard', () => showMain('consumi'))
    handle('localino:destination', () => destination)
    handle('localino:navigate', (_owner, value) => {
      if (!isDestination(value)) throw new Error('Destinazione non valida')
      return showMain(value)
    })
    handle('localino:usage', () => usage.state)
    handle('localino:refresh-usage', () => usage.refresh())
    handle('localino:connect', () => connection.connect())
    handle('localino:reread', () => connection.connect())
    handle('localino:disconnect', () => connection.disconnect())
    handle('localino:choose-codex', async owner => {
      const choice = await dialog.showOpenDialog(owner, { title: 'Seleziona Codex', properties: ['openFile'], filters: [{ name: 'Codex', extensions: ['exe'] }] })
      if (!choice.canceled && choice.filePaths[0]) await connection.connect(choice.filePaths[0])
    })
    connection.on('change', state => {
      broadcast('localino:connection-changed',state)
      updateTray()
    })
    quotas.on('change', state => {
      broadcast('localino:quotas-changed',state)
      updateTray()
    })
    usage.on('change', state => broadcast('localino:usage-changed',state))
    powerMonitor.on('suspend', () => { quotas.suspend(); usage.suspend() })
    powerMonitor.on('resume', () => { quotas.resume(); usage.resume() })
    tray = new Tray(createTrayIcon())
    updateTray()
    tray.on('click', () => panel?.isVisible() ? panel.hide() : showPanel())
    await showMain('home')
    await loadWindow(panel)
    void connection.autoConnect()
  }).catch((error: unknown) => {
    console.error('Impossibile avviare Localino', error)
    app.exit(1)
  })
  app.on('will-quit', () => { tray?.destroy() })
}
