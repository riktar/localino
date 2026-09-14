import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Quotas, ResourceState } from '../../../shared/contracts'
import { countdown, durationLabel, freshness } from '../../../shared/quotas'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function QuotaCard({ state }: { state: ResourceState<Quotas> }): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer) }, [])
  return <section className="space-y-3" aria-labelledby="quotas-title">
    <div className="flex items-center justify-between gap-2">
      <h2 id="quotas-title" className="text-sm font-medium">Quote disponibili</h2>
      <Button size="sm" variant="ghost" disabled={state.refreshing} onClick={() => void window.localino.refreshQuotas()}><RefreshCw className={state.refreshing ? 'animate-spin' : ''} aria-hidden="true" />Aggiorna</Button>
    </div>
    <div className="text-xs text-muted-foreground" role="status">
      <p className={state.stale || state.error ? 'font-medium text-destructive' : ''}>{freshness(state)}{state.refreshing && state.lastSuccessAt !== null ? ' · Lettura in corso' : ''}</p>
      <p>Ultima lettura: {state.lastSuccessAt === null ? 'nessuna' : new Date(state.lastSuccessAt).toLocaleString('it-IT')}</p>
    </div>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error === 'unsupported' ? 'Questa CLI non espone le quote. Aggiorna Codex e riprova.' : state.error === 'timeout' ? 'Lettura quote scaduta dopo 15 secondi.' : 'Impossibile aggiornare le quote.'} Puoi riprovare con Aggiorna.</p>}
    {state.data?.buckets.map(bucket => <Card key={bucket.id} className="py-4 shadow-none" data-bucket={bucket.id}><CardContent className="space-y-4">
      <h3 className="break-words text-sm font-semibold">{bucket.name}</h3>
      {bucket.windows.length === 0 && <p className="text-sm text-muted-foreground">Finestre non disponibili</p>}
      {bucket.windows.map(window => <div key={window.kind} className="space-y-1.5 text-xs" data-window={window.kind}>
        <div className="flex flex-wrap justify-between gap-1"><span>{durationLabel(window.durationMins)} · {window.kind === 'primary' ? 'Primaria' : 'Secondaria'}</span><strong>{window.usedPercent === null ? 'Non disponibile' : `${Math.max(0,100-window.usedPercent)}% rimanente`}</strong></div>
        {window.usedPercent !== null && <>
          <div role="progressbar" aria-label={`${bucket.name}, ${durationLabel(window.durationMins)}, quota utilizzata`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,window.usedPercent)} aria-valuetext={`${window.usedPercent}% utilizzato`} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${window.usedPercent >= 100 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100,window.usedPercent)}%` }} /></div>
          <p className="text-muted-foreground">{window.usedPercent}% utilizzato{window.usedPercent > 100 ? ' · Limite superato per questa finestra' : window.usedPercent === 100 ? ' · Limite raggiunto per questa finestra' : ''}</p>
        </>}
        <p className="text-muted-foreground">Reset: {window.resetsAt === null ? 'Non disponibile' : <><time dateTime={new Date(window.resetsAt).toISOString()}>{new Date(window.resetsAt).toLocaleString('it-IT')}</time> · {countdown(window.resetsAt,now)}</>}</p>
      </div>)}
    </CardContent></Card>)}
    {state.data && state.data.buckets.length === 0 && <p className="text-sm text-muted-foreground">Nessun limite disponibile.</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">Lettura ogni 60 secondi, anche con il pannello chiuso. Il servizio può rendere disponibili i consumi in ritardo. I reset sono nel fuso di questo PC.</p>
  </section>
}
