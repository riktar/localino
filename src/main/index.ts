import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, Tray } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Connection } from './codex/connection'
import { FilePreferences } from './codex/preferences'
import { isTrustedSender } from './security'
import { Resource } from './codex/resource'
import { freshness, normalizeQuotas, quotaResets, quotaSummary } from '../shared/quotas'
import { normalizeUsage } from '../shared/usage'
import { destinationLabels, isDestination, type Destination } from '../shared/navigation'
import { NotesStore } from './notes'
import type { ActionRequest, WindowAction } from '../shared/actions'
import { Shortcuts } from './shortcuts'
import { Capture } from './capture'
import { Foreground } from './foreground'
import type { CapturedNote } from '../shared/capture'
import { homedir } from 'node:os'
import { AgentPreferences } from './agents/preferences'
import { HistoryResource, HistoryFailure } from './agents/history-resource'
import { agentIds, agentLabels, isAgentId, isLocalAgentId, isAgentPeriod, type AgentId, type AgentResult, type LocalAgentId } from '../shared/agents'

const customData = app.commandLine.getSwitchValue('user-data-dir')
if (customData) { mkdirSync(resolve(customData), { recursive: true }); app.setPath('userData', resolve(customData)) }
const codexPreferences = new FilePreferences(join(app.getPath('userData'), 'connection.json'))
const connection = new Connection(codexPreferences)
const agents = new AgentPreferences(join(app.getPath('userData'), 'agents.json'))
const histories = Object.fromEntries(['claude', 'pi', 'opencode'].map(id => [id, new HistoryResource(id as LocalAgentId, async () => { throw new HistoryFailure('unsupported') })])) as Record<LocalAgentId, HistoryResource>
const defaultSources: Record<LocalAgentId, string> = {
  claude: join(homedir(), '.claude', 'projects'), pi: join(homedir(), '.pi', 'agent', 'sessions'),
  opencode: join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db'),
}
const notes = new NotesStore(join(app.getPath('userData'),'notes.json'))
const quotas = new Resource(connection, { method: 'account/rateLimits/read', normalize: normalizeQuotas, interval: 60_000, staleAfter: 180_000, resets: quotaResets })
connection.on('ratesChanged', () => void quotas.refresh())
const usage = new Resource(connection, { method: 'account/usage/read', normalize: normalizeUsage, interval: 300_000, staleAfter: 300_000 })
usage.setActive(false)

const captureExecutable = app.isPackaged ? join(process.resourcesPath,'native/Localino.Capture.exe') : join(__dirname,'../native/Localino.Capture.exe')
const capture = new Capture(join(app.getPath('userData'),'capture.json'), captureExecutable)
const foreground = new Foreground(captureExecutable)
let captureCompleting = false
let quitAfterCapture = false
let capturedNote: CapturedNote | null = null
let captureSequence = 0
let presentationReady = false
let rendererPresented = false
let presentationDone: (() => void) | null = null
let captureWindow: BrowserWindow | null = null
let captureLoading: Promise<void> | null = null
let panel: BrowserWindow | null = null
let dashboard: BrowserWindow | null = null
let destination: Destination = 'home'
let tray: Tray | null = null
let quitting = false
let quitReady = false
let unsaved = false
let actionSequence = 0
let pendingAction: ActionRequest | null = null
const shortcuts = new Shortcuts(join(app.getPath('userData'),'shortcuts.json'),globalShortcut,id=>{
  if(id==='home'||id==='consumi'||id==='clipboard')void showMain(id)
  if(id==='capture')capture.request()
  const selected = ({selectCodex:'codex', selectClaude:'claude', selectPi:'pi', selectOpenCode:'opencode'} as Record<string, AgentId>)[id]
  if(selected)void selectAgent(selected)
})

async function selectAgent(id: AgentId): Promise<AgentResult> {
  if (unsaved && destination !== 'consumi') { requestGuard({kind:'navigate',destination:'consumi',agent:id}); return {ok:true} }
  try { agents.select(id); await showMain('consumi'); return {ok:true} }
  catch (error) { return {ok:false,error:error instanceof Error ? error.message : 'Selezione non riuscita.'} }
}

function requestGuard(action: WindowAction): void {
  if (!dashboard || dashboard.isDestroyed()) return
  if (!pendingAction) {
    pendingAction = {id:++actionSequence,action}
    dashboard.webContents.send('localino:action-request',pendingAction)
  }
  if (dashboard.isMinimized()) dashboard.restore()
  dashboard.show(); dashboard.focus()
}
function hideWindow(window: BrowserWindow): void {
  if (window === dashboard && unsaved) requestGuard({kind:'hide'})
  else window.hide()
}

const ownedWindows = (): BrowserWindow[] => [panel,dashboard,captureWindow].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed())
function broadcast(channel: string, value: unknown): void { for (const window of ownedWindows()) window.webContents.send(channel,value) }
function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
}
async function loadWindow(window: BrowserWindow, dashboardView: boolean | 'capture' = false): Promise<void> {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (dashboardView) url.searchParams.set('view',dashboardView === 'capture' ? 'capture' : 'main')
    await window.loadURL(url.toString())
  } else await window.loadFile(join(__dirname,'../renderer/index.html'), dashboardView ? { query: { view:dashboardView === 'capture' ? 'capture' : 'main' } } : {})
}
async function presentCapture(): Promise<void> {
  if (!capture.draft || capture.draft.acquiring || captureCompleting) return
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = new BrowserWindow({width:760,height:580,minWidth:580,minHeight:460,title:'Localino — Cattura selezione',show:false,autoHideMenuBar:true,backgroundColor:'#faf9f6',
      webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
    const window = captureWindow
    secureWindow(window)
    window.on('page-title-updated',event=>event.preventDefault())
    window.on('close',event=>{if(!quitting){event.preventDefault();if(capture.draft && !capture.isSaving && !captureCompleting){window.hide();capture.finish(capture.draft.id,true)}}})
    window.on('closed',()=>{captureWindow=null})
    captureLoading = loadWindow(window,'capture').finally(()=>{captureLoading=null})
  }
  await captureLoading
  if (!capture.draft || !captureWindow || captureWindow.isDestroyed()) return
  captureWindow.webContents.send('localino:capture-draft',capture.draft)
  if(captureWindow.isMinimized())captureWindow.restore()
  // Keep origin focused until acquisition finishes, including the timeout path.
  captureWindow.show();captureWindow.focus()
  await foreground.focus(captureWindow.getNativeWindowHandle(),process.pid)
}
async function saveCapturedPrompt(id: number, text: unknown): Promise<{ok:boolean;error?:string}> {
  if(captureCompleting)return {ok:false,error:'Salvataggio in corso.'}
  captureCompleting=true
  let noteId: string | undefined
  const result = await capture.save(id,text,async value=>{
    const saved=await notes.mutate({kind:'create',text:value})
    if(saved.ok)noteId=saved.state.notes[0].id
    return saved
  },false)
  if(result.ok && noteId){
    try {
      captureWindow?.hide()
      presentationReady=false;rendererPresented=false
      const presented=new Promise<void>(resolve=>{presentationDone=resolve})
      capturedNote={sequence:++captureSequence,noteId,captureId:id,elapsedMs:capture.draft?.elapsedMs}
      await showMain('clipboard')
      if(dashboard&&!dashboard.isDestroyed()){
        if(!dashboard.isVisible())dashboard.show()
        dashboard.webContents.send('localino:note-captured',capturedNote)
        const focused=await foreground.focus(dashboard.getNativeWindowHandle(),process.pid)
        presentationReady=true
        if(rendererPresented)capture.presented(id)
        if(capturedNote?.captureId===id&&!focused){capturedNote={...capturedNote,focusFailed:true};dashboard.webContents.send('localino:note-captured',capturedNote);dashboard.flashFrame(true)}
      }
      await Promise.race([presented,new Promise<void>(resolve=>setTimeout(resolve,1000))])
    } catch {if(dashboard&&!dashboard.isDestroyed())dashboard.flashFrame(true)} finally {presentationDone=null;capture.finish(id,false);captureCompleting=false;if(quitAfterCapture){quitAfterCapture=false;app.quit()}}
  }else{
    captureCompleting=false
    capture.saveError(result.error??'Salvataggio non riuscito. Il testo è conservato: riprova.')
    // A failed save must remain recoverable, including when exit was requested.
    quitAfterCapture=false
  }
  return result
}
capture.on('selection',draft=>{void saveCapturedPrompt(draft.id,draft.text)})
capture.on('draft',()=>{void presentCapture()})
capture.on('raise',()=>{void presentCapture()})
capture.on('finished',()=>captureWindow?.hide())
capture.on('timing',draft=>{
  captureWindow?.webContents.send('localino:capture-draft',draft)
  if(capturedNote && capturedNote.captureId===draft.id){capturedNote={...capturedNote,visibleMs:draft.visibleMs};dashboard?.webContents.send('localino:note-captured',capturedNote);presentationDone?.()}
})
capture.on('status',state=>broadcast('localino:capture-status',state))

function updateUsageActivity(): void {
  const visible = destination === 'consumi' && !!dashboard?.isVisible() && !dashboard.isMinimized()
  usage.setActive(visible && agents.state.selected === 'codex')
  for (const id of Object.keys(histories) as LocalAgentId[]) histories[id].setActive(visible && agents.state.selected === id)
}
async function showMain(next: Destination = 'home'): Promise<void> {
  if (unsaved && next !== destination) { requestGuard({kind:'navigate',destination:next}); return }
  destination = next
  if (dashboard && !dashboard.isDestroyed()) {
    if (dashboard.isMinimized()) dashboard.restore()
    dashboard.setTitle(`Localino — ${destinationLabels[destination]}`)
    dashboard.webContents.send('localino:navigated', destination)
    dashboard.show(); dashboard.focus(); updateUsageActivity(); return
  }
  dashboard = new BrowserWindow({ width:1120,height:800,minWidth:800,minHeight:600,title:`Localino — ${destinationLabels[destination]}`,backgroundColor:'#faf9f6',show:false,autoHideMenuBar:true,
    webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true} })
  const window = dashboard
  secureWindow(window)
  window.on('page-title-updated', event => event.preventDefault())
  window.on('show', updateUsageActivity)
  window.on('minimize', updateUsageActivity)
  window.on('restore', updateUsageActivity)
  window.on('hide', updateUsageActivity)
  window.on('close', event => { if (!quitting) { event.preventDefault(); hideWindow(window) } })
  window.on('closed', () => { dashboard = null; updateUsageActivity() })
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
  const selected = agents.state.selected
  if (selected !== 'codex') {
    const state = histories[selected].state
    const status = `${agentLabels[selected]} · ${state.enabled ? state.error ? 'Lettura non disponibile' : state.stale ? 'Dati da aggiornare' : 'Cronologia locale' : 'Non collegato'}`
    tray.setToolTip(`Localino · ${status}`.slice(0,127))
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:status,enabled:false},
      {label:'Agente',submenu:agentIds.map(id=>({label:agentLabels[id],type:'radio' as const,checked:selected===id,click:()=>{void selectAgent(id)}}))},
      {label:'Apri Home',click:()=>{void showMain('home')}}, {label:'Apri Consumi',click:()=>{void showMain('consumi')}},
      {label:'Apri Clipboard',click:()=>{void showMain('clipboard')}}, {label:'Cattura selezione',click:()=>capture.request()},
      {label:'Scorciatoie',click:()=>{void showMain('shortcuts')}},
      {label:'Aggiorna statistiche',enabled:state.enabled&&!state.refreshing,click:()=>{void histories[selected].refresh()}},
      {type:'separator'}, {label:'Esci',click:()=>app.quit()},
    ]))
    return
  }
  const connected = connection.state.status === 'connected'
  const status = connected ? `Codex collegato · ${freshness(quotas.state)}` : connection.state.status === 'connecting' ? 'Collegamento Codex…' : 'Codex non collegato'
  const summary = quotaSummary(quotas.state)
  const timestamp = quotas.state.lastSuccessAt === null ? 'Nessuna lettura riuscita' : `Ultima lettura ${new Date(quotas.state.lastSuccessAt).toLocaleTimeString('it-IT')}`
  tray.setToolTip(`Localino · ${status}${connected ? ` · ${summary}` : ''}`.slice(0,127))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    {label:'Agente',submenu:agentIds.map(id=>({label:agentLabels[id],type:'radio' as const,checked:selected===id,click:()=>{void selectAgent(id)}}))},
    ...(connected ? [{ label: summary, enabled: false }, { label: timestamp, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Apri Home', click: () => { void showMain('home') } },
    { label: 'Apri Consumi', click: () => { void showMain('consumi') } },
    { label: 'Apri Clipboard', click: () => { void showMain('clipboard') } },
    { label: 'Cattura selezione', click: () => capture.request() },
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
    if (capture.isSaving || captureCompleting) { quitAfterCapture=true; return }
    if (unsaved && !quitting) { requestGuard({kind:'quit'}); return }
    if (quitting) return
    quitting = true
    capture.dispose();foreground.dispose()
    shortcuts.dispose()
    quotas.dispose()
    usage.dispose()
    Object.values(histories).forEach(resource=>resource.dispose())
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
        const owner = BrowserWindow.fromWebContents(event.sender)
        if (owner) hideWindow(owner)
      }
    })
    const handle = (channel: string, action: (owner: BrowserWindow, value: unknown) => unknown) => ipcMain.handle(channel, (event, value: unknown) => {
      if (!isTrustedSender(event.sender, event.senderFrame, ownedWindows().map(w => w.webContents))) throw new Error('Access denied')
      return action(BrowserWindow.fromWebContents(event.sender)!, value)
    })
    ipcMain.on('localino:unsaved',(event,value:unknown) => {
      if (typeof value === 'boolean' && dashboard && isTrustedSender(event.sender,event.senderFrame,[dashboard.webContents])) unsaved = value
    })
    handle('localino:resolve-action',(owner,value) => {
      if (owner !== dashboard || !value || typeof value !== 'object') throw Error('Access denied')
      const response = value as {id:unknown;proceed:unknown}
      if (!pendingAction || response.id !== pendingAction.id || typeof response.proceed !== 'boolean') throw Error('Richiesta scaduta')
      const {action} = pendingAction; pendingAction = null
      if (!response.proceed) return
      unsaved = false
      if (action.kind === 'navigate') return action.agent ? selectAgent(action.agent) : showMain(action.destination)
      if (action.kind === 'hide') owner.hide()
      else app.quit()
    })
    handle('localino:captured-note',owner=>{if(owner!==dashboard)throw Error('Access denied');return capturedNote})
    handle('localino:captured-note-presented',(owner,sequence)=>{
      if(owner!==dashboard||typeof sequence!=='number')throw Error('Access denied')
      if(capturedNote?.sequence===sequence){rendererPresented=true;if(presentationReady)capture.presented(capturedNote.captureId);owner.flashFrame(false)}
    })
    handle('localino:capture-status',()=>capture.state)
    handle('localino:capture-request',()=>capture.request())
    handle('localino:capture-enable',(_owner,value)=>capture.setEnabled(value))
    handle('localino:capture-retry',()=>capture.start())
    handle('localino:capture-draft',owner=>{if(owner!==captureWindow)throw Error('Access denied');return capture.draft})
    handle('localino:capture-presented',(owner,id)=>{
      if(owner!==captureWindow||typeof id!=='number')throw Error('Access denied')
      if(owner.isVisible())capture.presented(id)
      else owner.once('show',()=>capture.presented(id))
    })
    handle('localino:capture-cancel',(owner,id)=>{
      if(owner!==captureWindow||typeof id!=='number')throw Error('Access denied')
      if(capture.draft?.id===id&&!capture.isSaving&&!captureCompleting){owner.hide();capture.finish(id,true)}
    })
    handle('localino:capture-save',(owner,value)=>{
      if(owner!==captureWindow||!value||typeof value!=='object')throw Error('Access denied')
      const request=value as {id:unknown;text:unknown}
      if(typeof request.id!=='number')throw Error('Richiesta non valida')
      return saveCapturedPrompt(request.id,request.text)
    })
    await capture.init()
    handle('localino:quit',() => app.quit())
    handle('localino:shortcuts',()=>shortcuts.state)
    handle('localino:update-shortcuts',(_owner,value)=>shortcuts.update(value))
    handle('localino:panel',()=>showPanel())
    handle('localino:request-command',async (_owner,id)=>{
      if(id!=='new'&&id!=='palette')throw Error('Comando non valido')
      await showMain(id==='new'?'clipboard':destination)
      dashboard?.webContents.send('localino:command',id)
    })
    shortcuts.on('change',state=>broadcast('localino:shortcuts-changed',state))
    await shortcuts.init()
    handle('localino:notes',() => notes.get())
    handle('localino:reload-notes',() => notes.reload())
    handle('localino:mutate-note',(_owner,value) => notes.mutate(value))
    handle('localino:copy-note',async (_owner,value) => {
      if (typeof value !== 'string') return {ok:false,error:'Prompt non valido.'}
      const state = await notes.get()
      const note = state.notes.find(n => n.id === value)
      if (state.error || !note) return {ok:false,error:state.error ?? 'Prompt non disponibile.'}
      try {
        await clipboard.writeText(note.text)
        if (await clipboard.readText() !== note.text) return {ok:false,error:'Copia non riuscita: riprova.'}
        return {ok:true}
      } catch { return {ok:false,error:'Appunti non disponibili: riprova.'} }
    })
    notes.on('change',state => broadcast('localino:notes-changed',state))
    handle('localino:connection', () => connection.state)
    handle('localino:agents', () => agents.state)
    handle('localino:select-agent', (_owner,id) => { if(!isAgentId(id))throw Error('Agente non valido'); return selectAgent(id) })
    const localId = (id:unknown):LocalAgentId => { if(!isLocalAgentId(id))throw Error('Agente non valido');return id }
    handle('localino:history',(_owner,id)=>histories[localId(id)].state)
    handle('localino:refresh-history',(_owner,id)=>histories[localId(id)].refresh())
    handle('localino:agent-period',(_owner,value)=>{
      if(!value||typeof value!=='object')throw Error('Periodo non valido')
      const {id,period}=value as {id:unknown;period:unknown}
      if(!isAgentPeriod(period))throw Error('Periodo non valido')
      histories[localId(id)].period(period)
    })
    const configureSource = (id:LocalAgentId,enabled:boolean,path:string|null):AgentResult => {
      try { agents.source(id,{enabled,path}); histories[id].configure({enabled,path}); return {ok:true} }
      catch(error){return {ok:false,error:error instanceof Error?error.message:'Collegamento non riuscito.'}}
    }
    handle('localino:connect-agent',(_owner,value)=>{const id=localId(value);return configureSource(id,true,agents.state.sources[id].path??defaultSources[id])})
    handle('localino:disconnect-agent',(_owner,value)=>{const id=localId(value);return configureSource(id,false,agents.state.sources[id].path)})
    handle('localino:choose-agent-source',async(owner,value)=>{
      const id=localId(value)
      const choice=await dialog.showOpenDialog(owner,{title:`Sorgente ${agentLabels[id]}`,properties:[id==='opencode'?'openFile':'openDirectory']})
      return choice.canceled||!choice.filePaths[0]?{ok:true}:configureSource(id,true,choice.filePaths[0])
    })
    handle('localino:recover-preferences',async(owner,target)=>{
      if(target!=='agents'&&target!=='codex')throw Error('Preferenze non valide')
      const result=await dialog.showMessageBox(owner,{type:'question',message:'Ripristinare le preferenze? Il file precedente sarà conservato.',buttons:['Annulla','Ripristina'],defaultId:0,cancelId:0})
      if(result.response!==1)return {ok:true}
      try {
        if(target==='codex'){codexPreferences.recover();await connection.disconnect()}
        else {agents.recover();for(const id of Object.keys(histories) as LocalAgentId[])histories[id].configure(agents.state.sources[id])}
        return {ok:true}
      }catch{return {ok:false,error:'Ripristino non riuscito. Il file precedente è conservato.'}}
    })
    agents.on('change',state=>{broadcast('localino:agents-changed',state);updateUsageActivity();updateTray()})
    for(const id of Object.keys(histories) as LocalAgentId[]){
      histories[id].on('change',state=>{broadcast('localino:history-changed',state);updateTray()})
      histories[id].configure(agents.state.sources[id])
    }
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
    powerMonitor.on('suspend', () => { capture.suspend(); quotas.suspend(); usage.suspend();Object.values(histories).forEach(r=>r.suspend()) })
    powerMonitor.on('resume', () => { capture.resume(); quotas.resume(); usage.resume();Object.values(histories).forEach(r=>r.resume()) })
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
  app.on('will-quit', () => { capture.dispose();foreground.dispose();shortcuts.dispose();tray?.destroy() })
}
