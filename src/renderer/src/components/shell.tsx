import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BarChart3, ClipboardList, Keyboard } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Dashboard } from './dashboard'
import { Clipboard, type LeaveGuard } from './clipboard'
import { destinations, destinationLabels, type Destination } from '../../../shared/navigation'

export function Shell(): React.JSX.Element {
  const [destination, setDestination] = useState<Destination>('home')
  const content = useRef<HTMLDivElement>(null)
  const guard = useRef<LeaveGuard|null>(null)
  useEffect(() => {
    const off = window.localino.onNavigate(setDestination)
    void window.localino.getDestination().then(setDestination)
    return off
  }, [])
  useEffect(() => window.localino.onActionRequest(request => {
    void (async () => {const proceed=await (guard.current?.()??Promise.resolve(true));await window.localino.resolveAction(request.id,proceed)})()
  }),[])
  useEffect(() => { content.current?.focus(); window.scrollTo(0, 0) }, [destination])
  const navigate = (next: Destination) => { void window.localino.navigate(next) }
  return <div className="min-h-screen">
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-6 py-3">
      <span className="flex items-center gap-2 font-semibold"><span className="rounded-lg bg-primary px-2 py-1" aria-hidden="true">l.</span> localino</span>
      <nav aria-label="Navigazione principale" className="flex flex-wrap gap-1">
        {destinations.map(next => <Button key={next} size="sm" variant={next === destination ? 'default' : 'ghost'} aria-current={next === destination ? 'page' : undefined} onClick={() => navigate(next)}>{destinationLabels[next]}</Button>)}
      </nav>
    </header>
    <div ref={content} tabIndex={-1} className="outline-none" data-destination={destination}>
      {destination === 'consumi' ? <Dashboard /> : destination === 'clipboard' ? <Clipboard guard={guard} /> : <main className="mx-auto max-w-5xl space-y-8 p-6 lg:p-10">
        {destination === 'home' ? <>
          <div className="space-y-3 pt-5"><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Il tuo spazio di lavoro</p><h1 className="text-4xl font-semibold tracking-tight">Benvenuto in Localino</h1><p className="max-w-xl text-muted-foreground">Tieni d'occhio i consumi dei tuoi agenti e raccogli le idee per il prossimo prompt.</p></div>
          <div className="grid grid-cols-2 gap-5">
            <Card><CardContent className="space-y-4"><BarChart3 aria-hidden="true" className="text-muted-foreground" /><h2 className="text-xl font-semibold">Consumi</h2><p className="text-sm text-muted-foreground">Account Codex, quote disponibili e statistiche delle tue attività.</p><Button onClick={() => navigate('consumi')}>Apri Consumi <ArrowUpRight aria-hidden="true" /></Button></CardContent></Card>
            <Card><CardContent className="space-y-4"><ClipboardList aria-hidden="true" className="text-muted-foreground" /><h2 className="text-xl font-semibold">Clipboard</h2><p className="text-sm text-muted-foreground">Uno spazio locale per prompt e appunti, anche senza un account collegato.</p><Button variant="outline" onClick={() => navigate('clipboard')}>Apri Clipboard <ArrowUpRight aria-hidden="true" /></Button></CardContent></Card>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted p-4"><p className="text-sm">Usa Tab per spostarti e Invio per aprire una sezione.</p><Button variant="ghost" onClick={() => navigate('shortcuts')}><Keyboard aria-hidden="true" />Scopri le scorciatoie</Button></div>
        </> : <><h1 className="text-3xl font-semibold">{destinationLabels[destination]}</h1><p className="text-muted-foreground">Naviga con Tab e attiva i pulsanti con Invio. Le scorciatoie configurabili saranno disponibili con il completamento di questo incremento.</p></>}
        <footer><Button variant="outline" onClick={() => window.localino.hide()}><ArrowDownRight aria-hidden="true" />Riduci nella barra</Button><p className="mt-3 text-xs text-muted-foreground">Il monitor rimane attivo nella barra di sistema.</p></footer>
      </main>}
    </div>
  </div>
}
