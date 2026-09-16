import { AgentSummary } from './agent-summary'
import { Settings as PanelSettings } from './settings'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Command, Settings, X } from 'lucide-react'
import { Button } from './ui/button'
import { AgentCommands, AgentDashboard } from './agents'
import { Clipboard, type LeaveGuard } from './clipboard'
import { CommandProvider, useCommandRegistry, useCommands } from './commands'
import { CaptureEditor } from './capture'
import type { CaptureDraft, CapturedNote } from '../../../shared/capture'
import type { Destination } from '../../../shared/navigation'

export function Panel(): React.JSX.Element {
  return <CommandProvider><PanelContent/></CommandProvider>
}
function PanelContent(): React.JSX.Element {
  const registry=useCommandRegistry()!
  const guard=useRef<LeaveGuard|null>(null)
  const openList=useRef<(()=>Promise<void>)|null>(null)
  const captureGuard=useRef<LeaveGuard|null>(null)
  const [destination,setDestination]=useState<Destination>('panel')
  const [captured,setCaptured]=useState<CapturedNote|null>(null)
  const [capture,setCapture]=useState<CaptureDraft|null>(null)
  const [newRequest,setNewRequest]=useState(0)
  const [newDisabled,setNewDisabled]=useState<string|undefined>('Library unavailable.')
  const settingsButton=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    const off=window.localino.onNavigate(next=>{setDestination(next);if(next==='panel')requestAnimationFrame(()=>settingsButton.current?.focus())})
    void window.localino.getDestination().then(setDestination)
    return off
  },[])
  useEffect(()=>{
    const receive=(next:CapturedNote|null)=>{if(next)setCaptured(previous=>!previous||next.sequence>=previous.sequence?next:previous)}
    const off=window.localino.onCapturedNote(receive);void window.localino.getCapturedNote().then(receive);return off
  },[])
  useEffect(()=>{
    const off=window.localino.onCaptureDraft(setCapture);void window.localino.getCaptureDraft().then(setCapture);return off
  },[])
  useEffect(()=>window.localino.onActionRequest(request=>{
    void (async()=>{
      const proceed=await (captureGuard.current?.()??Promise.resolve(true)) && await (guard.current?.()??Promise.resolve(true))
      await window.localino.resolveAction(request.id,proceed)
    })()
  }),[])
  useEffect(()=>window.localino.onCommand(registry.run),[registry.run])
  useCommands({
    localino:{run:()=>window.localino.navigate('panel')},panel:{run:()=>window.localino.openPanel()},
    advancedUsage:{run:()=>window.localino.openDashboard()},clipboard:{run:async()=>{if(await window.localino.navigate('panel'))await openList.current?.()}},
    shortcuts:{run:()=>window.localino.navigate('settings')},palette:{run:registry.open},
    new:{run:async()=>{if(await window.localino.navigate('panel'))setNewRequest(n=>n+1)},disabled:capture?'Finish capture first.':newDisabled},
    hide:{run:()=>window.localino.hide()},quit:{run:()=>window.localino.quit()},capture:{run:()=>window.localino.requestCapture()},
    closeSettings:{run:()=>window.localino.navigate('panel'),disabled:destination!=='settings'?'Open settings first.':undefined},
  })
  const recovering=!!capture&&!capture.acquiring
  return <div className="panel" data-destination={destination}>
    <AgentCommands/>
    <header className="panel-header">
      {destination==='settings'?<Button size="icon" variant="ghost" aria-label="Back" onClick={()=>void window.localino.navigate('panel')}><ArrowLeft/></Button>:<span className="brand-mark" aria-hidden="true">l.</span>}
      <h1>{destination==='settings'?'Settings':'Localino'}</h1>
      <div className="ml-auto flex">
        <Button size="icon" variant="ghost" aria-label="Commands" title="Commands" onClick={registry.open}><Command/></Button>
        <Button ref={settingsButton} size="icon" variant="ghost" aria-label="Settings" title="Settings" onClick={()=>void window.localino.navigate('settings')}><Settings/></Button>
        <Button size="icon" variant="ghost" aria-label="Hide panel" title="Hide panel" onClick={()=>window.localino.hide()}><X/></Button>
      </div>
    </header>
    <div className="panel-content" hidden={recovering}>
      <section hidden={destination==='settings'} className="panel-root">
        <AgentSummary/>
        <Clipboard openList={openList} onAvailability={setNewDisabled} active={destination==='panel'&&!recovering} captured={captured} guard={guard} newRequest={newRequest} consumeNew={()=>setNewRequest(0)}/>
      </section>
      <div hidden={destination!=='settings'} className="panel-settings">{destination==='settings'&&<PanelSettings/>}</div>
    </div>
    {recovering&&<CaptureEditor guard={captureGuard}/>}
  </div>
}
export function UsageWindow(): React.JSX.Element {
  return <CommandProvider><UsageContent/></CommandProvider>
}
function UsageContent(): React.JSX.Element {
  const registry=useCommandRegistry()!
  useCommands({localino:{run:()=>window.localino.openPanel()},panel:{run:()=>window.localino.openPanel()},clipboard:{run:()=>window.localino.requestCommand('clipboard')},
    shortcuts:{run:()=>window.localino.navigate('settings')},new:{run:()=>window.localino.requestCommand('new')},
    palette:{run:registry.open},hide:{run:()=>window.localino.hide()},quit:{run:()=>window.localino.quit()},capture:{run:()=>window.localino.requestCapture()}})
  return <><header className="panel-header"><Button variant="ghost" onClick={()=>void window.localino.openPanel()}><ArrowLeft/>Back to panel</Button><Button className="ml-auto" variant="ghost" onClick={registry.open}>Commands</Button></header><AgentCommands/><AgentDashboard/></>
}
