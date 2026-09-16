import { useEffect, useState, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
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
import { useCommands } from './commands'

export function Dashboard(): React.JSX.Element {
  const account = useConnection(); const quotas = useQuotas(); const usage = useUsage()
  const [period,setPeriod] = useState<Period>('30')
  const [today,setToday] = useState(localDate())
  useEffect(() => { const timer = setInterval(() => setToday(localDate()),1000); return () => clearInterval(timer) },[])
  const connected = account.status === 'connected'
  const dailyTable=useRef<HTMLDetailsElement>(null)
  const unavailable=!connected?'Connect Codex first.':undefined
  const periodDisabled=unavailable??(!usage.data?'Usage unavailable.':undefined)
  useCommands({
    connect:{run:()=>window.localino.connect(),disabled:connected||account.status==='connecting'?'Already connected or connecting.':undefined},
    reread:{run:()=>window.localino.rereadAccount(),disabled:unavailable},
    choose:{run:()=>window.localino.chooseCodex(),disabled:account.status==='connecting'?'Connecting…':undefined},
    disconnect:{run:()=>window.localino.disconnect(),disabled:account.status==='disconnected'?'Already disconnected.':undefined},
    quotas:{run:()=>window.localino.refreshQuotas(),disabled:unavailable??(quotas.refreshing?'Refreshing…':undefined)},
    usage:{run:()=>window.localino.refreshUsage(),disabled:unavailable??(usage.refreshing?'Refreshing…':undefined)},
    period7:{run:()=>setPeriod('7'),disabled:periodDisabled},period30:{run:()=>setPeriod('30'),disabled:periodDisabled},periodAll:{run:()=>setPeriod('all'),disabled:periodDisabled},
    table:{run:()=>{if(dailyTable.current)dailyTable.current.open=!dailyTable.current.open},disabled:periodDisabled},
  })
  const data = connected ? usage.data : null
  const view = data ? usagePeriod(data,period,today) : null
  const metrics = data ? [
    ['Lifetime tokens',numberLabel(data.summary.lifetimeTokens)],
    ['Service daily peak',numberLabel(data.summary.peakDailyTokens)],
    ['Longest turn',durationSeconds(data.summary.longestRunningTurnSec)],
    ['Current streak',numberLabel(data.summary.currentStreakDays)],
    ['Longest streak',numberLabel(data.summary.longestStreakDays)],
  ] : []
  return <main className="mx-auto max-w-[1440px] space-y-7 p-6 lg:p-8" data-dashboard>
    <header className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Codex usage</h1></div>
    </header>
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {!connected ? <Card><CardContent className="text-sm text-muted-foreground">Connect Codex to view usage.</CardContent></Card> : <>
          <section aria-labelledby="summary-title" className="space-y-3" data-usage-updated-at={usage.lastSuccessAt ?? ''}>
            <div className="flex items-center justify-between gap-4"><h2 id="summary-title" className="font-medium">Account summary</h2><Button size="sm" variant="outline" disabled={usage.refreshing} onClick={() => void window.localino.refreshUsage()}><RefreshCw className={usage.refreshing ? 'animate-spin' : ''} aria-hidden="true" />Refresh usage</Button></div>
            <p className="text-xs text-muted-foreground">Lifetime service metrics · Unaffected by the period filter.</p>
            <div role="status" className={`text-xs ${usage.stale || usage.error ? 'text-destructive' : 'text-muted-foreground'}`}><p>{freshness(usage)}{usage.refreshing && usage.lastSuccessAt !== null ? ' · Refreshing' : ''}</p><p>Updated: {usage.lastSuccessAt === null ? 'Never' : new Date(usage.lastSuccessAt).toLocaleString('en-US')}</p></div>
            {usage.error && <p role="alert" className="text-sm text-destructive">{usage.error === 'unsupported' ? 'Usage unsupported. Update Codex and retry.' : usage.error === 'timeout' ? 'Usage request timed out. Retry.' : 'Could not update usage. Retry.'}</p>}
            {metrics.length > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5" data-summary>{metrics.map(([name,value]) => <Card key={name} className="py-4 shadow-none"><CardContent className="space-y-2 px-4"><p className="text-xs text-muted-foreground">{name}</p><p className="break-words text-xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</div>}
          </section>
          {data && view && <Card className="min-w-0 shadow-none"><CardContent className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Tokens over time</h2><p className="mt-1 text-xs text-muted-foreground">Based on reported days.</p></div><label className="flex items-center gap-2 text-xs">Period<select aria-label="Period" className="max-w-full rounded-md border bg-card p-2 text-sm" value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All available</option></select></label></div>
            <p className="text-xs text-muted-foreground" data-coverage>Coverage: {view.covered}/{view.expected} reported days{view.start && view.end ? ` · ${view.start} → ${view.end}` : ''}. Missing days are not zero.</p>
            {(data.issues > 0 || view.overflow) && <p role="alert" className="text-sm text-destructive">Partial data: {data.issues > 0 ? 'invalid or conflicting records excluded.' : 'total exceeds numeric precision.'}</p>}
            <div className="grid grid-cols-3 gap-3" data-period-metrics>{[
              [view.partial ? 'Partial total' : 'Period total',numberLabel(view.total)],
              ['Mean per reported day',numberLabel(view.mean)],
              ['Period peak',view.peak ? `${numberLabel(view.peak.tokens)} · ${view.peak.date}` : 'Unavailable'],
            ].map(([name,value]) => <div key={name} className="min-w-0 rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{name}</p><p className="mt-1 break-words font-semibold tabular-nums">{value}</p></div>)}</div>
            {view.days.length > 0 ? <ChartContainer config={{tokens:{label:'Token',color:'var(--ring)'}}} className="h-[260px] w-full" aria-label="Daily tokens; exact values in the table">
              <LineChart accessibilityLayer data={view.rows} margin={{left:12,right:20,top:12,bottom:8}}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="timestamp" type="number" domain={[Date.parse(`${view.start}T00:00:00Z`),Date.parse(`${view.end}T00:00:00Z`)]} ticks={view.rows.filter((_,index)=>index%Math.max(1,Math.ceil(view.rows.length/6))===0).map(row=>row.timestamp)} tickFormatter={value => new Date(Number(value)).toISOString().slice(5,10)} tickMargin={8} minTickGap={35} />
                <YAxis tickFormatter={value => Number(value).toLocaleString('en-US',{notation:'compact'})} width={60} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_label,payload) => { const date: unknown = payload?.[0]?.payload?.date; return typeof date === 'string' ? date : 'Date unavailable' }} formatter={value => <span className="font-mono">{numberLabel(Number(value))} token</span>} />} />
                <Line type="linear" dataKey="tokens" stroke="var(--color-tokens)" strokeWidth={2} dot={{r:3}} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer> : <p className="rounded-lg bg-muted/60 p-8 text-center text-sm text-muted-foreground">No daily data for this period.</p>}
            <details ref={dailyTable} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Daily table</summary><table className="mt-3 w-full text-left text-sm" data-usage-table><caption className="mb-3 text-left text-xs text-muted-foreground">Service dates, without timezone conversion. Empty rows show missing intervals.</caption><thead><tr className="border-b"><th scope="col" className="py-2">Date</th><th scope="col" className="py-2 text-right">Token</th></tr></thead><tbody>{view.rows.map(row => <tr className="border-b last:border-0" key={row.date}><th scope="row" className="py-2 font-normal">{row.date}{row.endDate && row.endDate!==row.date ? ` → ${row.endDate}` : ''}</th><td className="py-2 text-right tabular-nums">{numberLabel(row.tokens)}</td></tr>)}</tbody></table></details>
          </CardContent></Card>}
        </>}
      </div>
      <aside className="min-w-0 space-y-6"><details className="rounded-xl border p-3"><summary>Connection</summary><div className="mt-3"><AccountCard state={account}/></div></details>{connected && <>
        <details className="rounded-xl border p-3"><summary>Quota details</summary><div className="mt-3"><QuotaCard state={quotas}/></div></details>
        {quotas.data && (quotas.data.availableResets != null || quotas.data.buckets.some(b => b.credits)) && <details className="rounded-xl border p-3"><summary>Service credits</summary><Card className="py-4 shadow-none"><CardContent className="space-y-3 text-sm">{quotas.data.availableResets != null && <p>Available resets: {numberLabel(quotas.data.availableResets)}</p>}{quotas.data.buckets.filter(b=>b.credits).map(b=><div key={b.id} className="space-y-1"><h3 className="text-xs font-semibold">{b.name}</h3><p>{b.credits!.unlimited === true ? 'Unlimited credits' : b.credits!.hasCredits === true ? 'Credits available' : b.credits!.hasCredits === false ? 'No credits available' : 'Credit status unavailable'}</p>{b.credits!.balance !== null && <p>Reported balance: {b.credits!.balance}</p>}</div>)}<p className="text-xs text-muted-foreground">Currency not provided. Credits do not remove quota limits.</p></CardContent></Card></details>}
      </>}</aside>
    </div>
  </main>
}
