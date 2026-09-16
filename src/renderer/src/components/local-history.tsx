import { useEffect, useState } from 'react'
import { agentCapabilities, agentLabels, type AgentPeriod, type HistoryState, type LocalAgentId } from '../../../shared/agents'
import { useCommands } from './commands'
import { Button } from './ui/button'

export function useHistory(id: LocalAgentId): HistoryState | null {
  const [state,setState]=useState<HistoryState|null>(null)
  useEffect(()=>{
    let updated=false,disposed=false
    const off=window.localino.onHistory(next=>{if(next.agent===id){updated=true;setState(next)}})
    void window.localino.getHistory(id).then(next=>{if(!updated&&!disposed)setState(next)})
    return ()=>{disposed=true;off()}
  },[id])
  return state?.agent===id?state:null
}
const number=(value:number|null|undefined)=>value===null||value===undefined?'Non disponibile':value.toLocaleString('it-IT')
const errors={missing:'La sorgente non esiste. Seleziona la cartella corretta.',denied:'Accesso alla sorgente negato.',invalid:'Archivio non leggibile.',unsupported:'Formato non supportato: la fonte potrebbe essere cambiata.',busy:'Archivio occupato: riprova.',timeout:'Lettura interrotta dopo 15 secondi. Puoi riprovare o cambiare fonte.',unavailable:'Lettura non riuscita: riprova.'}

export function LocalHistory({id}:{id:LocalAgentId}): React.JSX.Element {
  const state=useHistory(id), capability=agentCapabilities[id]
  const [error,setError]=useState<string>(),[table,setTable]=useState(false)
  const action=async(operation:Promise<{ok:boolean;error?:string}>)=>{setError(undefined);try{const result=await operation;setError(result.error)}catch{setError('Operazione non riuscita.')}}
  const connect=()=>action(window.localino.connectAgent(id)),choose=()=>action(window.localino.chooseAgentSource(id)),disconnect=()=>action(window.localino.disconnectAgent(id))
  const refresh=()=>window.localino.refreshHistory(id),period=(value:AgentPeriod)=>window.localino.setAgentPeriod(id,value)
  const unavailable=!state?.enabled?'Collega prima la cronologia locale.':state.refreshing?'Lettura in corso.':undefined
  useCommands({
    connect:{label:`Collega ${agentLabels[id]}`,run:connect,disabled:state?.enabled?'Fonte già collegata.':undefined},choose:{label:`Seleziona fonte ${agentLabels[id]}`,run:choose},disconnect:{run:disconnect,disabled:!state?.enabled?'Fonte già scollegata.':undefined},
    reread:{run:()=>{},disabled:`${agentLabels[id]} legge uno storico locale, senza account Codex.`},
    quotas:{run:()=>{},disabled:id==='claude'?'Quote disponibili soltanto tramite il bridge Claude opzionale.':`${agentLabels[id]} non espone quote account universali.`},
    usage:{run:refresh,disabled:unavailable},period7:{run:()=>period('7'),disabled:unavailable},period30:{run:()=>period('30'),disabled:unavailable},periodAll:{run:()=>period('all'),disabled:unavailable},
    table:{run:()=>setTable(value=>!value),disabled:capability.daily?unavailable:'Questa fonte non fornisce una serie giornaliera.'},
  })
  const data=state?.data
  const metrics=[['Input',data?.totals.input],['Output',data?.totals.output],['Cache letta',data?.totals.cacheRead],['Cache scritta',data?.totals.cacheWrite],['Reasoning',data?.totals.reasoning],['Totale token',data?.totals.total]] as const
  const maxInput=Math.max(1,...(data?.days.map(day=>day.input??0)??[]))
  return <main className="mx-auto max-w-5xl space-y-5 p-6" data-agent={id} data-history-updated-at={state?.lastSuccessAt??''}>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Consumi {agentLabels[id]}</h1><p className="text-sm text-muted-foreground">Storico locale · File conservati su questo PC</p></header>
    <div className="flex flex-wrap gap-2">
      {!state?.enabled?<Button onClick={()=>void connect()}>Collega {agentLabels[id]}</Button>:<Button variant="outline" onClick={()=>void disconnect()}>Scollega da Localino</Button>}
      <Button variant="outline" onClick={()=>void choose()}>Seleziona {id==='opencode'?'database':'cartella'}</Button>
      <Button variant="outline" disabled={!!unavailable} onClick={()=>void refresh()}>Aggiorna statistiche</Button>
    </div>
    <p className="break-all text-xs text-muted-foreground">Fonte: {state?.source??'Non collegata'}</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {state?.error&&<p role="alert" className="text-sm text-destructive">{errors[state.error]}</p>}
    <p role="status" className="text-sm">{!state?.enabled?'Collega volontariamente la fonte per leggerla.':state.refreshing?'Lettura in corso…':state.stale?'Dati non aggiornati: ultima lettura conservata.':data?.partial?'Copertura parziale.':data?'Lettura completata.':'Nessuna lettura riuscita.'}</p>
    {state?.enabled&&<label className="block text-sm">Periodo <select aria-label="Periodo" className="ml-2 rounded-md border bg-background p-2" value={state.period} onChange={event=>void period(event.target.value as AgentPeriod)}><option value="7">Ultimi 7 giorni</option><option value="30">Ultimi 30 giorni</option><option value="all">Tutti i dati disponibili</option></select></label>}
    {data&&<>
      <p className="text-sm">{data.semantics==='events'?'Giorni di calendario nel fuso locale, incluso oggi.':'Totali di tutte le attività delle sessioni aggiornate nel periodo; finestra mobile di 24 ore per giorno. Non indica quando i token sono stati consumati.'}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-history-summary>{metrics.map(([label,value])=><div key={label} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-lg font-semibold">{number(value)}</p></div>)}</div>
      <p className="text-sm">Sessioni con dati: {data.sessions} · Record conteggiati: {data.records} · Record o file esclusi/ambigui: {data.issues}</p>
      {!data.records&&!data.issues&&<p>Nessun consumo registrato nel periodo.</p>}
      <p className="text-sm">Costo storico: {capability.costs&&data.totals.cost!==null?`${data.totals.cost.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})} USD (stima della fonte, non fattura)`:'Non disponibile'}</p>
      {data.limitations?.map(note=><p key={note} className="text-xs text-muted-foreground">{note}</p>)}
      {capability.daily&&<section className="space-y-3" aria-label="Serie giornaliera input">
        <h2 className="font-medium">Input per giorno</h2><p className="text-xs text-muted-foreground">Sono mostrati soltanto i giorni con record. Un giorno assente non prova consumo zero.</p>
        <div className="max-h-64 space-y-2 overflow-auto">{data.days.map(day=><div key={day.date} className="text-xs"><span>{day.date} · {number(day.input)}</span><div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{width:`${(day.input??0)/maxInput*100}%`}}/></div></div>)}</div>
        <Button variant="outline" onClick={()=>setTable(value=>!value)}>{table?'Chiudi':'Apri'} tabella giornaliera</Button>
        {table&&<div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Giorno</th><th>Input</th><th>Token totali</th><th>Costo USD</th></tr></thead><tbody>{data.days.map(day=><tr key={day.date}><td>{day.date}</td><td>{number(day.input)}</td><td>{number(day.tokens)}</td><td>{number(day.cost)}</td></tr>)}</tbody></table></div>}
      </section>}
    </>}
    <p className="text-xs text-muted-foreground">Ultimo tentativo: {state?.lastAttemptAt?new Date(state.lastAttemptAt).toLocaleString('it-IT'):'Mai'}<br/>Ultima lettura riuscita: {state?.lastSuccessAt?new Date(state.lastSuccessAt).toLocaleString('it-IT'):'Mai'}<br/>Ultimo evento nel periodo: {data?.sampledAt?new Date(data.sampledAt).toLocaleString('it-IT'):'Non disponibile'}</p>
    <p className="text-sm text-muted-foreground">{id==='claude'?'Le quote richiedono il bridge Claude opzionale. La cronologia è indipendente dal contesto corrente.':'Nessuna quota account universale fornita da questa fonte.'}</p>
    <Button variant="outline" onClick={()=>void window.localino.openDashboard()}>Apri dashboard</Button>
    <Button variant="ghost" onClick={()=>window.localino.hide()}>Riduci nella barra</Button>
  </main>
}
