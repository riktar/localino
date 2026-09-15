import { useEffect, useState } from 'react'
import { ArrowDownRight, RefreshCw } from 'lucide-react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { AccountCard } from './account-card'
import { QuotaCard } from './quota-card'
import { useConnection } from '@/hooks/use-connection'
import { useQuotas } from '@/hooks/use-quotas'
import { useUsage } from '@/hooks/use-usage'
import { durationSeconds, localDate, numberLabel, usagePeriod, type Period } from '../../../shared/usage'
import { freshness } from '../../../shared/quotas'

export function Dashboard(): React.JSX.Element {
  const account = useConnection(); const quotas = useQuotas(); const usage = useUsage()
  const [period,setPeriod] = useState<Period>('30')
  const [today,setToday] = useState(localDate())
  useEffect(() => { const timer = setInterval(() => setToday(localDate()),1000); return () => clearInterval(timer) },[])
  const connected = account.status === 'connected'
  const data = connected ? usage.data : null
  const view = data ? usagePeriod(data,period,today) : null
  const metrics = data ? [
    ['Token complessivi',numberLabel(data.summary.lifetimeTokens)],
    ['Picco giornaliero del servizio',numberLabel(data.summary.peakDailyTokens)],
    ['Turno più lungo',durationSeconds(data.summary.longestRunningTurnSec)],
    ['Giorni consecutivi attuali',numberLabel(data.summary.currentStreakDays)],
    ['Record giorni consecutivi',numberLabel(data.summary.longestStreakDays)],
  ] : []
  return <main className="mx-auto max-w-[1440px] space-y-7 p-6 lg:p-8" data-dashboard>
    <header className="flex items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">localino / Codex</p><h1 className="text-2xl font-semibold tracking-tight">Statistiche Codex</h1><p className="mt-1 text-sm text-muted-foreground">Il tuo account, dai limiti ai giorni di attività.</p></div>
      <Button variant="outline" onClick={() => window.localino.hide()}><ArrowDownRight aria-hidden="true" />Riduci nella barra</Button>
    </header>
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {!connected ? <Card><CardContent className="text-sm text-muted-foreground">Collega Codex per leggere le statistiche dell'account.</CardContent></Card> : <>
          <section aria-labelledby="summary-title" className="space-y-3" data-usage-updated-at={usage.lastSuccessAt ?? ''}>
            <div className="flex items-center justify-between gap-4"><h2 id="summary-title" className="font-medium">Riepilogo dell'account</h2><Button size="sm" variant="outline" disabled={usage.refreshing} onClick={() => void window.localino.refreshUsage()}><RefreshCw className={usage.refreshing ? 'animate-spin' : ''} aria-hidden="true" />Aggiorna statistiche</Button></div>
            <p className="text-xs text-muted-foreground">Statistiche cumulative riportate dal servizio. Il filtro periodo non modifica questi valori.</p>
            <div role="status" className={`text-xs ${usage.stale || usage.error ? 'text-destructive' : 'text-muted-foreground'}`}><p>{freshness(usage)}{usage.refreshing && usage.lastSuccessAt !== null ? ' · Lettura in corso' : ''}</p><p>Ultima lettura statistiche: {usage.lastSuccessAt === null ? 'nessuna' : new Date(usage.lastSuccessAt).toLocaleString('it-IT')}</p></div>
            {usage.error && <p role="alert" className="text-sm text-destructive">{usage.error === 'unsupported' ? 'Le statistiche non sono supportate da questa versione di Codex. Aggiorna la CLI e riprova.' : usage.error === 'timeout' ? 'La lettura delle statistiche è scaduta dopo 15 secondi.' : 'Impossibile aggiornare le statistiche.'} Le quote rimangono disponibili separatamente.</p>}
            {metrics.length > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5" data-summary>{metrics.map(([name,value]) => <Card key={name} className="py-4 shadow-none"><CardContent className="space-y-2 px-4"><p className="text-xs text-muted-foreground">{name}</p><p className="break-words text-xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</div>}
          </section>
          {data && view && <Card className="min-w-0 shadow-none"><CardContent className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Token nel tempo</h2><p className="mt-1 text-xs text-muted-foreground">Calcoli Localino sui giorni ricevuti dal servizio.</p></div><label className="flex items-center gap-2 text-xs">Periodo<select aria-label="Periodo" className="max-w-full rounded-md border bg-card p-2 text-sm" value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="7">Ultimi 7 giorni</option><option value="30">Ultimi 30 giorni</option><option value="all">Tutti i dati disponibili</option></select></label></div>
            <p className="text-xs text-muted-foreground" data-coverage>Copertura: {view.covered}/{view.expected} giorni con dato{view.start && view.end ? ` · ${view.start} → ${view.end}` : ''}. I giorni mancanti non valgono zero.</p>
            {(data.issues > 0 || view.overflow) && <p role="alert" className="text-sm text-destructive">Dati incompleti: {data.issues > 0 ? 'date, valori invalidi o duplicati in conflitto esclusi dai calcoli.' : 'totale oltre la precisione numerica disponibile.'}</p>}
            <div className="grid grid-cols-3 gap-3" data-period-metrics>{[
              [view.partial ? 'Totale parziale' : 'Totale del periodo',numberLabel(view.total)],
              ['Media per giorno disponibile',numberLabel(view.mean)],
              ['Picco del periodo',view.peak ? `${numberLabel(view.peak.tokens)} · ${view.peak.date}` : 'Non disponibile'],
            ].map(([name,value]) => <div key={name} className="min-w-0 rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{name}</p><p className="mt-1 break-words font-semibold tabular-nums">{value}</p></div>)}</div>
            {view.days.length > 0 ? <ChartContainer config={{tokens:{label:'Token',color:'#946316'}}} className="h-[260px] w-full" aria-label="Token giornalieri; valori esatti disponibili nella tabella">
              <LineChart accessibilityLayer data={view.rows} margin={{left:12,right:20,top:12,bottom:8}}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="timestamp" type="number" domain={[Date.parse(`${view.start}T00:00:00Z`),Date.parse(`${view.end}T00:00:00Z`)]} ticks={view.rows.filter((_,index)=>index%Math.max(1,Math.ceil(view.rows.length/6))===0).map(row=>row.timestamp)} tickFormatter={value => new Date(Number(value)).toISOString().slice(5,10)} tickMargin={8} minTickGap={35} />
                <YAxis tickFormatter={value => Number(value).toLocaleString('it-IT',{notation:'compact'})} width={60} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_label,payload) => { const date: unknown = payload?.[0]?.payload?.date; return typeof date === 'string' ? date : 'Data non disponibile' }} formatter={value => <span className="font-mono">{numberLabel(Number(value))} token</span>} />} />
                <Line type="linear" dataKey="tokens" stroke="var(--color-tokens)" strokeWidth={2} dot={{r:3}} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer> : <p className="rounded-lg bg-muted/60 p-8 text-center text-sm text-muted-foreground">Nessun dato giornaliero disponibile per questo periodo.</p>}
            <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Tabella dei dati giornalieri</summary><table className="mt-3 w-full text-left text-sm" data-usage-table><caption className="mb-3 text-left text-xs text-muted-foreground">Date del servizio, senza conversione di fuso. Le righe senza dato mostrano l'intervallo mancante.</caption><thead><tr className="border-b"><th scope="col" className="py-2">Data</th><th scope="col" className="py-2 text-right">Token</th></tr></thead><tbody>{view.rows.map(row => <tr className="border-b last:border-0" key={row.date}><th scope="row" className="py-2 font-normal">{row.date}{row.endDate && row.endDate!==row.date ? ` → ${row.endDate}` : ''}</th><td className="py-2 text-right tabular-nums">{numberLabel(row.tokens)}</td></tr>)}</tbody></table></details>
          </CardContent></Card>}
          <p className="text-xs leading-relaxed text-muted-foreground">Statistiche aggiornate ogni 5 minuti mentre Consumi è visibile. I token riguardano l'account: non misurano costi, produttività o il solo lavoro svolto in Localino. Nessuna cronologia statistica salvata sul PC.</p>
        </>}
      </div>
      <aside className="min-w-0 space-y-6"><AccountCard state={account} />{connected && <>
        <QuotaCard state={quotas} />
        {quotas.data && (quotas.data.availableResets != null || quotas.data.buckets.some(b => b.credits)) && <Card className="py-4 shadow-none"><CardContent className="space-y-3 text-sm"><h2 className="font-medium">Crediti del servizio</h2>{quotas.data.availableResets != null && <p>Reset disponibili: {numberLabel(quotas.data.availableResets)}</p>}{quotas.data.buckets.filter(b=>b.credits).map(b=><div key={b.id} className="space-y-1"><h3 className="text-xs font-semibold">{b.name}</h3><p>{b.credits!.unlimited === true ? 'Crediti illimitati' : b.credits!.hasCredits === true ? 'Crediti presenti' : b.credits!.hasCredits === false ? 'Nessun credito disponibile' : 'Stato crediti non disponibile'}</p>{b.credits!.balance !== null && <p>Saldo riportato: {b.credits!.balance}</p>}</div>)}<p className="text-xs text-muted-foreground">Unità monetaria non indicata. I crediti non rendono illimitate le quote.</p></CardContent></Card>}
      </>}</aside>
    </div>
  </main>
}
