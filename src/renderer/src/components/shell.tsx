import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BarChart3, ClipboardList, Keyboard } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Dashboard } from './dashboard'
import { Clipboard, type LeaveGuard } from './clipboard'
import { destinations, destinationLabels, type Destination } from '../../../shared/navigation'
import { CommandProvider,ShortcutSettings,useCommandRegistry,useCommands } from './commands'
import type { NotesState } from '../../../shared/notes'

export function Shell(): React.JSX.Element {
  return <CommandProvider><ShellContent /></CommandProvider>
}
function ShellContent(): React.JSX.Element {
  const registry=useCommandRegistry()!
  const [destination, setDestination] = useState<Destination>('home')
  const content = useRef<HTMLDivElement>(null)
  const guard = useRef<LeaveGuard|null>(null)
  const settingsOrigin=useRef<{destination:Destination;element:HTMLElement|null}>({destination:'home',element:null})
  const returnFocus=useRef<HTMLElement|null>(null)
  const [notesState,setNotesState]=useState<NotesState|null>(null)
  const [clipboardBusy,setClipboardBusy]=useState(false)
  useEffect(()=>{const off=window.localino.onNotes(setNotesState);void window.localino.getNotes().then(setNotesState);return off},[])
  useEffect(() => {
    const off = window.localino.onNavigate(next=>setDestination(previous=>{
      if(next==='shortcuts'&&previous!=='shortcuts')settingsOrigin.current={destination:previous,element:document.activeElement as HTMLElement}
      return next
    }))
    void window.localino.getDestination().then(setDestination)
    return off
  }, [])
  useEffect(() => window.localino.onActionRequest(request => {
    void (async () => {const proceed=await (guard.current?.()??Promise.resolve(true));await window.localino.resolveAction(request.id,proceed)})()
  }),[])
  useEffect(() => {
    content.current?.focus(); window.scrollTo(0, 0)
    if(returnFocus.current){const origin=returnFocus.current;returnFocus.current=null;requestAnimationFrame(()=>{
      const match=origin.isConnected?origin:Array.from(document.querySelectorAll<HTMLElement>(origin.tagName)).find(e=>e.id===origin.id&&e.getAttribute('type')===origin.getAttribute('type')&&e.getAttribute('aria-label')===origin.getAttribute('aria-label')&&e.textContent===origin.textContent)
      match?.focus()
    })}
  }, [destination])
  useEffect(()=>window.localino.onCommand(registry.run),[registry.run])
  const navigate = (next: Destination) => { void window.localino.navigate(next) }
  useCommands({
    home:{run:()=>navigate('home')},consumi:{run:()=>navigate('consumi')},clipboard:{run:()=>navigate('clipboard')},shortcuts:{run:()=>navigate('shortcuts')},
    palette:{run:registry.open},hide:{run:()=>window.localino.hide()},quit:{run:()=>window.localino.quit()},panel:{run:()=>window.localino.openPanel()},
    capture:{run:()=>{},disabled:'Cattura disponibile dopo il completamento della funzione nativa.'},
  })
  // A command may request the Clipboard editor from any destination. The mounted
  // Clipboard consumes the request only after the existing navigation guard permits it.
  const [newRequest,setNewRequest]=useState(0)
  useCommands({new:{run:()=>{setNewRequest(n=>n+1);navigate('clipboard')},disabled:!notesState||notesState.error?'Libreria non disponibile.':clipboardBusy?'Operazione in corso.':undefined}})
  useCommands({closeSettings:{run:()=>{returnFocus.current=settingsOrigin.current.element;navigate(settingsOrigin.current.destination)},disabled:destination!=='shortcuts'?'Apri prima le impostazioni.':undefined}})
  return <div className="min-h-screen">
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-6 py-3">
      <span className="flex items-center gap-2 font-semibold"><span className="rounded-lg bg-primary px-2 py-1" aria-hidden="true">l.</span> localino</span>
      <Button size="sm" variant="outline" onClick={registry.open}>Comandi</Button>
      <nav aria-label="Navigazione principale" className="flex flex-wrap gap-1">
        {destinations.map(next => <Button key={next} size="sm" variant={next === destination ? 'default' : 'ghost'} aria-current={next === destination ? 'page' : undefined} onClick={() => navigate(next)}>{destinationLabels[next]}</Button>)}
      </nav>
    </header>
    {registry.state.bindings.some(b=>b.error)&&<p role="alert" className="px-6 py-2 text-sm text-destructive">Una o più scorciatoie globali non sono disponibili. Apri Scorciatoie per cambiare la combinazione.</p>}
    <div ref={content} tabIndex={-1} className="outline-none" data-destination={destination}>
      {destination === 'consumi' ? <Dashboard /> : destination === 'clipboard' ? <Clipboard guard={guard} newRequest={newRequest} consumeNew={()=>setNewRequest(0)} onBusy={setClipboardBusy} /> : destination==='shortcuts' ? <ShortcutSettings/> : <main className="mx-auto max-w-5xl space-y-8 p-6 lg:p-10">
        {destination === 'home' ? <>
          <div className="space-y-3 pt-5"><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Il tuo spazio di lavoro</p><h1 className="text-4xl font-semibold tracking-tight">Benvenuto in Localino</h1><p className="max-w-xl text-muted-foreground">Tieni d'occhio i consumi dei tuoi agenti e raccogli le idee per il prossimo prompt.</p></div>
          <div className="grid grid-cols-2 gap-5">
            <Card><CardContent className="space-y-4"><BarChart3 aria-hidden="true" className="text-muted-foreground" /><h2 className="text-xl font-semibold">Consumi</h2><p className="text-sm text-muted-foreground">Account Codex, quote disponibili e statistiche delle tue attività.</p><Button onClick={() => navigate('consumi')}>Apri Consumi <ArrowUpRight aria-hidden="true" /></Button></CardContent></Card>
            <Card><CardContent className="space-y-4"><ClipboardList aria-hidden="true" className="text-muted-foreground" /><h2 className="text-xl font-semibold">Clipboard</h2><p className="text-sm text-muted-foreground">Uno spazio locale per prompt e appunti, anche senza un account collegato.</p><Button variant="outline" onClick={() => navigate('clipboard')}>Apri Clipboard <ArrowUpRight aria-hidden="true" /></Button></CardContent></Card>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted p-4"><p className="text-sm">Usa Ctrl+K per cercare un comando, Tab per spostarti e Invio per eseguire.</p><Button variant="ghost" onClick={() => navigate('shortcuts')}><Keyboard aria-hidden="true" />Scopri le scorciatoie</Button></div>
        </> : <><h1 className="text-3xl font-semibold">{destinationLabels[destination]}</h1><p className="text-muted-foreground">Naviga con Tab e attiva i pulsanti con Invio. Le scorciatoie configurabili saranno disponibili con il completamento di questo incremento.</p></>}
        <footer><Button variant="outline" onClick={() => window.localino.hide()}><ArrowDownRight aria-hidden="true" />Riduci nella barra</Button><p className="mt-3 text-xs text-muted-foreground">Il monitor rimane attivo nella barra di sistema.</p></footer>
      </main>}
    </div>
  </div>
}
