import { selectedText } from '../shared/note-selection'
import { nativeHelper } from './platform'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Connection } from './codex/connection'
import { FilePreferences } from './codex/preferences'
import { isTrustedSender } from './security'
import { Resource } from './codex/resource'
import { normalizeQuotas, quotaResets, quotaSummary } from '../shared/quotas'
import { normalizeUsage } from '../shared/usage'
import { isDestination, type Destination } from '../shared/navigation'
import { NotesStore } from './notes'
import type { ActionRequest, WindowAction } from '../shared/actions'
import { Shortcuts } from './shortcuts'
import { Capture } from './capture'
import { Foreground } from './foreground'
import { panelBounds } from './window-position'
import type { CapturedNote } from '../shared/capture'
import { homedir } from 'node:os'
import { AgentPreferences } from './agents/preferences'
import { HistoryResource } from './agents/history-resource'
import { openCodeSource } from './agents/opencode-source'
import { ClaudeBridge } from './agents/bridge'
import { workerReader } from './agents/worker-reader'
import { agentLabels, agentCapabilities, isAgentId, isLocalAgentId, isAgentPeriod, type AgentId, type AgentResult, type LocalAgentId } from '../shared/agents'

const customData = app.commandLine.getSwitchValue('user-data-dir')
if (customData) { mkdirSync(resolve(customData), { recursive: true }); app.setPath('userData', resolve(customData)) }
const codexPreferences = new FilePreferences(join(app.getPath('userData'), 'connection.json'))
const connection = new Connection(codexPreferences)
const agents = new AgentPreferences(join(app.getPath('userData'), 'agents.json'))
const bridge = new ClaudeBridge(join(app.getPath('userData'),'claude-bridge'),join(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),'settings.json'),app.isPackaged?join(process.resourcesPath,'native',nativeHelper('StatusLine')):join(__dirname,'..','native',nativeHelper('StatusLine')),[process.platform==='darwin'?'/Library/Application Support/ClaudeCode/managed-settings.json':join(process.env.ProgramFiles||'C:\\Program Files','ClaudeCode','managed-settings.json')])
const histories = Object.fromEntries(['claude', 'pi', 'opencode'].map(id => [id, new HistoryResource(id as LocalAgentId, workerReader(id as LocalAgentId))])) as Record<LocalAgentId, HistoryResource>
const defaultSources: Record<LocalAgentId, string> = {
  claude: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'), pi: join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions'),
  opencode: join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db'),
}
const notes = new NotesStore(join(app.getPath('userData'),'notes.json'))
const quotas = new Resource(connection, { method: 'account/rateLimits/read', normalize: normalizeQuotas, interval: 60_000, staleAfter: 180_000, resets: quotaResets })
connection.on('ratesChanged', () => void quotas.refresh())
const usage = new Resource(connection, { method: 'account/usage/read', normalize: normalizeUsage, interval: 300_000, staleAfter: 300_000 })
usage.setActive(false)

const captureExecutable = app.isPackaged ? join(process.resourcesPath,'native',nativeHelper('Capture')) : join(__dirname,'../native',nativeHelper('Capture'))
const capture = new Capture(join(app.getPath('userData'),'capture.json'), captureExecutable)
const foreground = new Foreground(captureExecutable)
let captureCompleting = false
let quitAfterCapture = false
let capturedNote: CapturedNote | null = null
let captureSequence = 0
let presentationReady = false
let rendererPresented = false
let presentationDone: (() => void) | null = null
let captureOrigin: { visible: boolean; destination: Destination } | null = null
let panelLoaded = false
let panel: BrowserWindow | null = null
let dashboard: BrowserWindow | null = null
let destination: Destination = 'panel'
let tray: Tray | null = null
let quitting = false
let quitReady = false
let unsaved = false
let actionSequence = 0
let pendingAction: ActionRequest | null = null
let resolvePendingAction: ((proceed:boolean)=>void) | null = null
const shortcuts = new Shortcuts(join(app.getPath('userData'),'shortcuts.json'),globalShortcut,id=>{
  if(id==='localino')void showMain('panel')
  if(id==='clipboard')void showMain('panel').then(accepted=>{if(accepted)panel?.webContents.send('localino:command','clipboard')})
  if(id==='advancedUsage')void showMain('usage')
  if(id==='capture')capture.request()
  const selected = ({selectCodex:'codex', selectClaude:'claude', selectPi:'pi', selectOpenCode:'opencode'} as Record<string, AgentId>)[id]
  if(selected){void selectAgent(selected);showPanel()}
})

async function selectAgent(id: AgentId): Promise<AgentResult> {
  try { agents.select(id); return {ok:true} }
  catch (error) { return {ok:false,error:error instanceof Error ? error.message : 'Could not select agent.'} }
}

function requestGuard(action: WindowAction): Promise<boolean> {
  if (!panel || panel.isDestroyed() || pendingAction) return Promise.resolve(false)
  const result = new Promise<boolean>(resolve=>{resolvePendingAction=resolve})
  pendingAction = {id:++actionSequence,action}
  panel.webContents.send('localino:action-request',pendingAction)
  showPanel()
  return result
}
function hideWindow(window: BrowserWindow): void {
  if (window === panel && (unsaved || capture.draft)) requestGuard({kind:'hide'})
  else if (window === dashboard) { window.hide(); showPanel() }
  else window.hide()
}
const ownedWindows = (): BrowserWindow[] => [panel,dashboard].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed())
function broadcast(channel: string, value: unknown): void { for (const window of ownedWindows()) window.webContents.send(channel,value) }
function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
}
async function loadWindow(window: BrowserWindow, view: 'main' | 'usage' = 'main'): Promise<void> {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view',view)
    await window.loadURL(url.toString())
  } else await window.loadFile(join(__dirname,'../renderer/index.html'), {query:{view}})
}
async function presentCapture(): Promise<void> {
  if (!capture.draft || capture.draft.acquiring || captureCompleting || !panelLoaded || !panel) return
  if (!captureOrigin) captureOrigin = {visible: panel.isVisible(), destination}
  panel.webContents.send('localino:capture-draft',capture.draft)
  showPanel()
  await foreground.focus(panel.getNativeWindowHandle(),process.pid)
}
async function saveCapturedPrompt(id: number, text: unknown): Promise<{ok:boolean;error?:string}> {
  if(captureCompleting)return {ok:false,error:'Saving…'}
  captureCompleting=true
  let noteId: string | undefined
  const result = await capture.save(id,text,async value=>{
    const saved=await notes.mutate({kind:'create',text:value})
    if(saved.ok)noteId=saved.state.notes[0].id
    return saved
  },false)
  if(result.ok && noteId){
    try {
      panel?.webContents.send('localino:capture-draft', null)
      presentationReady=false;rendererPresented=false
      const presented=new Promise<void>(resolve=>{presentationDone=resolve})
      capturedNote={sequence:++captureSequence,noteId,captureId:id,elapsedMs:capture.draft?.elapsedMs}
      await showMain('panel', true)
      if(panel&&!panel.isDestroyed()){
        if(!panel.isVisible())panel.show()
        panel.webContents.send('localino:note-captured',capturedNote)
        const focused=await foreground.focus(panel.getNativeWindowHandle(),process.pid)
        presentationReady=true
        if(rendererPresented)capture.presented(id)
        if(capturedNote?.captureId===id&&!focused){capturedNote={...capturedNote,focusFailed:true};panel.webContents.send('localino:note-captured',capturedNote);panel.flashFrame(true)}
      }
      await Promise.race([presented,new Promise<void>(resolve=>setTimeout(resolve,1000))])
    } catch {if(panel&&!panel.isDestroyed())panel.flashFrame(true)} finally {presentationDone=null;capture.finish(id,false);captureOrigin=null;captureCompleting=false;if(quitAfterCapture){quitAfterCapture=false;app.quit()}}
  }else{
    captureCompleting=false
    capture.saveError(result.error??'Could not save. Your text is safe. Retry.')
    // A failed save must remain recoverable, including when exit was requested.
    quitAfterCapture=false
  }
  return result
}
capture.on('selection',draft=>{void saveCapturedPrompt(draft.id,draft.text)})
capture.on('draft',()=>{void presentCapture()})
capture.on('raise',()=>{void presentCapture()})
capture.on('finished',()=>{panel?.webContents.send('localino:capture-draft',null)})
capture.on('timing',draft=>{
  if(!captureCompleting)panel?.webContents.send('localino:capture-draft',draft)
  if(capturedNote && capturedNote.captureId===draft.id){capturedNote={...capturedNote,visibleMs:draft.visibleMs};panel?.webContents.send('localino:note-captured',capturedNote);presentationDone?.()}
})
capture.on('status',state=>broadcast('localino:capture-status',state))

function updateUsageActivity(): void {
  if (quitting) return
  const visible = !!dashboard && !dashboard.isDestroyed() && dashboard.isVisible() && !dashboard.isMinimized()
  usage.setActive(visible && agents.state.selected === 'codex')
  const localVisible = visible || (!!panel && !panel.isDestroyed() && panel.isVisible() && !panel.isMinimized())
  for (const id of Object.keys(histories) as LocalAgentId[]) histories[id].setActive(localVisible && agents.state.selected === id)
}
async function showMain(next: Destination = 'panel', preserveDraft = false): Promise<boolean> {
  if (!panelLoaded || !panel) return false
  if (!preserveDraft && (unsaved || capture.draft) && next !== destination) return requestGuard({kind:'navigate',destination:next})
  if (next !== 'usage') {
    destination = next
    panel.webContents.send('localino:navigated',next)
    showPanel()
    return true
  }
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = new BrowserWindow({width:1120,height:800,minWidth:800,minHeight:600,title:'Localino — Usage',backgroundColor:'#faf9f6',show:false,autoHideMenuBar:true,
      webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
    const window = dashboard
    secureWindow(window)
    window.on('page-title-updated',event=>event.preventDefault())
    window.on('show',updateUsageActivity);window.on('hide',updateUsageActivity)
    window.on('minimize',updateUsageActivity);window.on('restore',updateUsageActivity)
    window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();showPanel()}})
    window.on('closed',()=>{dashboard=null;updateUsageActivity()})
    await loadWindow(window,'usage')
  }
  panel.hide()
  if(dashboard.isMinimized())dashboard.restore()
  dashboard.show();dashboard.focus();updateUsageActivity()
  return true
}
function positionPanel(anchor = false): void {
  if (!panel || panel.isDestroyed()) return
  const bounds=panel.getBounds()
  const trayBounds=anchor ? tray?.getBounds() : undefined
  const validAnchor=trayBounds && trayBounds.width>0 ? trayBounds : undefined
  const area=screen.getDisplayNearestPoint(validAnchor ? {x:validAnchor.x,y:validAnchor.y} : screen.getCursorScreenPoint()).workArea
  panel.setBounds(panelBounds(area,bounds,validAnchor))
}
function showPanel(anchor = false): void {
  if (!panelLoaded || !panel || panel.isDestroyed()) return
  dashboard?.hide()
  positionPanel(anchor)
  if(panel.isMinimized())panel.restore()
  panel.show();panel.focus()
  void quotas.refresh()
}
function updateTray(): void {
  if (!tray) return
  const selected=agents.state.selected
  tray.setToolTip(('Localino · '+agentLabels[selected]+(selected==='codex' ? ' · '+quotaSummary(quotas.state) : '')).slice(0,127))
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open Localino',click:()=>showPanel(true)},
    {type:'separator'}, {label:'Quit',click:()=>app.quit()},
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
  app.on('second-instance', () => { void showMain('panel') })
  app.on('activate', () => { void showMain('panel') })
  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    if (capture.isSaving || captureCompleting) { quitAfterCapture=true; return }
    if ((unsaved || capture.draft) && !quitting) { requestGuard({kind:'quit'}); return }
    if (quitting) return
    quitting = true
    capture.dispose();foreground.dispose()
    shortcuts.dispose()
    quotas.dispose()
    usage.dispose()
    Object.values(histories).forEach(resource=>resource.dispose())
    bridge.dispose()
    void connection.shutdown().finally(() => { quitReady = true; app.quit() })
  })
  app.on('window-all-closed', () => { if (quitting) app.quit() })

  app.whenReady().then(async () => {
    app.setAppUserModelId('app.localino.desktop')
    Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([
      {label:'Localino',submenu:[{label:'Hide Localino',accelerator:'Cmd+H',click:()=>{if(panel)hideWindow(panel)}},{type:'separator'},{label:'Quit Localino',accelerator:'Cmd+Q',click:()=>app.quit()}]},
      {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    ]):null)
    panel = new BrowserWindow({
      width: 420,
      height: 640,
      minWidth: 360,
      minHeight: 460,
      title: 'Localino',
      backgroundColor: '#faf9f6',
      show: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    secureWindow(panel)
    panel.on('minimize',()=>hideWindow(panel!));panel.on('show',updateUsageActivity);panel.on('hide',updateUsageActivity);panel.on('minimize',updateUsageActivity);panel.on('restore',updateUsageActivity)
    panel.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        if(panel)hideWindow(panel)
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
      if (typeof value === 'boolean' && panel && isTrustedSender(event.sender,event.senderFrame,[panel.webContents])) unsaved = value
    })
    handle('localino:resolve-action',async(owner,value) => {
      if (owner !== panel || !value || typeof value !== 'object') throw Error('Access denied')
      const response = value as {id:unknown;proceed:unknown}
      if (!pendingAction || response.id !== pendingAction.id || typeof response.proceed !== 'boolean') throw Error('Request expired')
      const {action} = pendingAction; pendingAction = null
      const done=resolvePendingAction;resolvePendingAction=null
      if (!response.proceed) {done?.(false);return}
      unsaved = false
      if (action.kind === 'navigate') await showMain(action.destination,true)
      else if (action.kind === 'hide') owner.hide()
      else app.quit()
      done?.(true)
    })
    handle('localino:captured-note',owner=>{if(owner!==panel)throw Error('Access denied');return capturedNote})
    handle('localino:captured-note-presented',(owner,sequence)=>{
      if(owner!==panel||typeof sequence!=='number')throw Error('Access denied')
      if(capturedNote?.sequence===sequence){rendererPresented=true;if(presentationReady)capture.presented(capturedNote.captureId);owner.flashFrame(false)}
    })
    handle('localino:capture-status',()=>capture.state)
    handle('localino:capture-request',()=>capture.request())
    handle('localino:capture-enable',(_owner,value)=>capture.setEnabled(value))
    handle('localino:capture-retry',()=>capture.start())
    handle('localino:capture-permissions',()=>{if(process.platform==='darwin')capture.permissions()})
    handle('localino:capture-draft',owner=>{if(owner!==panel)throw Error('Access denied');return capture.draft})
    handle('localino:capture-presented',(owner,id)=>{
      if(owner!==panel||typeof id!=='number')throw Error('Access denied')
      if(owner.isVisible())capture.presented(id)
      else owner.once('show',()=>capture.presented(id))
    })
    handle('localino:capture-cancel',(owner,id)=>{
      if(owner!==panel||typeof id!=='number')throw Error('Access denied')
      if(capture.draft?.id===id&&!capture.isSaving&&!captureCompleting){
        const origin=captureOrigin;captureOrigin=null;capture.finish(id,true)
        if(origin){destination=origin.destination;owner.webContents.send('localino:navigated',destination);if(!origin.visible)owner.hide()}
      }
    })
    handle('localino:capture-save',(owner,value)=>{
      if(owner!==panel||!value||typeof value!=='object')throw Error('Access denied')
      const request=value as {id:unknown;text:unknown}
      if(typeof request.id!=='number')throw Error('Invalid request')
      return saveCapturedPrompt(request.id,request.text)
    })
    await capture.init()
    handle('localino:quit',() => app.quit())
    handle('localino:shortcuts',()=>shortcuts.state)
    handle('localino:update-shortcuts',(_owner,value)=>shortcuts.update(value))
    handle('localino:panel',()=>{dashboard?.hide();showPanel()})
    handle('localino:request-command',async (_owner,id)=>{
      if(id!=='new'&&id!=='palette')throw Error('Invalid command')
      if(await showMain('panel'))panel?.webContents.send('localino:command',id)
    })
    shortcuts.on('change',state=>broadcast('localino:shortcuts-changed',state))
    await shortcuts.init()
    handle('localino:notes',() => notes.get())
    handle('localino:reload-notes',() => notes.reload())
    handle('localino:mutate-note',(_owner,value) => notes.mutate(value))
    handle('localino:copy-notes',async (_owner,value) => {
      const result=selectedText(await notes.get(),value)
      if(!result.ok)return result
      try {await clipboard.writeText(result.text);return await clipboard.readText()===result.text?{ok:true}:{ok:false,error:'Could not copy. Retry.'}}
      catch{return {ok:false,error:'Clipboard unavailable. Retry.'}}
    })
    notes.on('change',state => broadcast('localino:notes-changed',state))
    handle('localino:connection', () => connection.state)
    handle('localino:agents', () => agents.state)
    handle('localino:select-agent', (_owner,id) => { if(!isAgentId(id))throw Error('Invalid agent'); return selectAgent(id) })
    const localId = (id:unknown):LocalAgentId => { if(!isLocalAgentId(id))throw Error('Invalid agent');return id }
    handle('localino:bridge',()=>bridge.state)
    handle('localino:bridge-enable',(_owner,enabled)=>{if(typeof enabled!=='boolean')throw Error('Invalid value');return bridge.setEnabled(enabled)})
    handle('localino:bridge-refresh',()=>bridge.refresh())
    handle('localino:bridge-diagnose',async(owner)=>{
      const choice=await dialog.showOpenDialog(owner,{title:'Check Claude project overrides (read only)',properties:['openDirectory']})
      return bridge.diagnose(choice.canceled?undefined:choice.filePaths[0])
    })
    handle('localino:history',(_owner,id)=>histories[localId(id)].state)
    handle('localino:refresh-history',(_owner,value)=>{const id=localId(value);if(!agentCapabilities[id].history)throw Error('Reader unavailable');return histories[id].refresh()})
    handle('localino:agent-period',(_owner,value)=>{
      if(!value||typeof value!=='object')throw Error('Invalid period')
      const {id,period}=value as {id:unknown;period:unknown}
      if(!isAgentPeriod(period))throw Error('Invalid period')
      histories[localId(id)].period(period)
    })
    const configureSource = (id:LocalAgentId,enabled:boolean,path:string|null):AgentResult => {
      try { agents.source(id,{enabled,path}); histories[id].configure({enabled,path}); return {ok:true} }
      catch(error){return {ok:false,error:error instanceof Error?error.message:'Could not connect. Retry.'}}
    }
    handle('localino:connect-agent',async(_owner,value)=>{
      const id=localId(value)
      try {return configureSource(id,true,agents.state.sources[id].path??(id==='opencode'?await openCodeSource(dirname(defaultSources.opencode)):defaultSources[id]))}
      catch(error){return {ok:false,error:error instanceof Error?error.message:'Source unavailable.'}}
    })
    handle('localino:disconnect-agent',(_owner,value)=>{const id=localId(value);return configureSource(id,false,agents.state.sources[id].path)})
    handle('localino:choose-agent-source',async(owner,value)=>{
      const id=localId(value)
      const choice=await dialog.showOpenDialog(owner,{title:`${agentLabels[id]} source`,properties:[id==='opencode'?'openFile':'openDirectory']})
      return choice.canceled||!choice.filePaths[0]?{ok:true}:configureSource(id,true,choice.filePaths[0])
    })
    handle('localino:recover-preferences',async(owner,target)=>{
      if(target!=='agents'&&target!=='codex')throw Error('Invalid preferences')
      const result=await dialog.showMessageBox(owner,{type:'question',message:'Recover preferences? The previous file will be preserved.',buttons:['Cancel','Recover'],defaultId:0,cancelId:0})
      if(result.response!==1)return {ok:true}
      try {
        if(target==='codex'){codexPreferences.recover();await connection.disconnect()}
        else {agents.recover();for(const id of Object.keys(histories) as LocalAgentId[])histories[id].configure(agents.state.sources[id])}
        return {ok:true}
      }catch{return {ok:false,error:'Recovery failed. Previous file preserved.'}}
    })
    agents.on('change',state=>{broadcast('localino:agents-changed',state);updateUsageActivity();updateTray()})
    bridge.on('change',state=>{broadcast('localino:bridge-changed',state);updateTray()})
    await bridge.start()
    for(const id of Object.keys(histories) as LocalAgentId[]){
      histories[id].on('change',state=>{broadcast('localino:history-changed',state);updateTray()})
      histories[id].configure(agents.state.sources[id])
    }
    handle('localino:quotas', () => quotas.state)
    handle('localino:refresh-quotas', () => quotas.refresh())
    handle('localino:open-dashboard', () => showMain('usage'))
    handle('localino:destination', () => destination)
    handle('localino:navigate', (_owner, value) => {
      if (!isDestination(value)) throw new Error('Invalid destination')
      return showMain(value)
    })
    handle('localino:usage', () => usage.state)
    handle('localino:refresh-usage', () => usage.refresh())
    handle('localino:connect', () => connection.connect())
    handle('localino:reread', () => connection.connect())
    handle('localino:disconnect', () => connection.disconnect())
    handle('localino:choose-codex', async owner => {
      const choice = await dialog.showOpenDialog(owner, { title: 'Choose Codex', properties: ['openFile'], ...(process.platform==='win32'?{filters:[{name:'Codex',extensions:['exe']}]}:{}) })
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
    tray.on('click',()=>{if(panel?.isVisible())hideWindow(panel);else showPanel(true)})
    screen.on('display-added',()=>positionPanel());screen.on('display-removed',()=>positionPanel())
    screen.on('display-metrics-changed',()=>positionPanel())
    await loadWindow(panel)
    panelLoaded=true
    showPanel(true)
    void connection.autoConnect()
  }).catch((error: unknown) => {
    console.error('Could not start Localino', error)
    app.exit(1)
  })
  app.on('will-quit', () => { capture.dispose();foreground.dispose();shortcuts.dispose();tray?.destroy() })
}
