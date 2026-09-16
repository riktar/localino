import { useEffect,useState } from 'react'
import type { BridgeState } from '../../../shared/agents'
import {Button} from './ui/button'

export function useBridge():BridgeState|null {
  const [state,setState]=useState<BridgeState|null>(null)
  useEffect(()=>{let updated=false,disposed=false;const off=window.localino.onBridge(value=>{updated=true;setState(value)});void window.localino.getBridge().then(value=>{if(!updated&&!disposed)setState(value)});return()=>{disposed=true;off()}},[])
  return state
}
export function ClaudeBridgeCard({state}:{state:BridgeState|null}):React.JSX.Element {
  const [busy,setBusy]=useState(false),[diagnosis,setDiagnosis]=useState<string>()
  const toggle=async()=>{setBusy(true);try{await window.localino.setBridgeEnabled(!state?.enabled)}finally{setBusy(false)}}
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Quote Claude dalla status line" data-bridge-received-at={state?.receivedAt??''}>
    <h2 className="font-semibold">Quote e costo della sessione Claude</h2>
    <p className="text-sm text-muted-foreground">Bridge facoltativo nelle impostazioni utente. Conserva il comando status line precedente e lo ripristina alla disattivazione, se non lo hai modificato nel frattempo. Riceve solo quote, costo e identità della sessione; non interroga l’account.</p>
    <p className="break-all text-xs">File interessato: {state?.settingsPath??'Caricamento…'}</p>
    <div className="flex flex-wrap gap-2"><Button disabled={!state||busy} onClick={()=>void toggle()}>{busy?'Operazione in corso…':state?.enabled?'Disattiva bridge Claude':'Attiva bridge Claude'}</Button><Button variant="outline" disabled={!state?.enabled} onClick={()=>void window.localino.refreshBridge()}>Rileggi quote dalla cache</Button><Button variant="outline" onClick={()=>void window.localino.diagnoseBridge().then(setDiagnosis)}>Controlla override nel progetto</Button></div>
    {state?.error&&<p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {diagnosis&&<p className="break-words text-sm">{diagnosis}</p>}
    <p role="status" className="text-sm">{!state?.enabled?'Bridge disattivato.':state.quotas.error?'Cache non leggibile: ultimo snapshot conservato.':state.quotas.stale?'Snapshot obsoleto: nessun payload valido negli ultimi 120 secondi.':state.effective?'Collegamento confermato da un payload recente.':'Configurato, in attesa di un payload Claude.'}</p>
    {state?.enabled&&<>
      <p className="break-all text-xs">Sessione dell’ultimo payload valido: {state.sessionId??'Non disponibile'} · Ricevuto: {state.receivedAt===null?'Mai':new Date(state.receivedAt).toLocaleString('it-IT')}</p>
      {state.quotas.data?.buckets.map(bucket=><div key={bucket.id} className="rounded-lg bg-muted p-3 text-sm" data-bridge-window={bucket.id}><strong>{bucket.name}</strong>{bucket.windows.map(window=><div key={window.kind}><p>{window.usedPercent===null?'Percentuale non disponibile':`${window.usedPercent.toLocaleString('it-IT')}% utilizzato`}</p><p>Reset: {window.resetsAt===null?'Non disponibile':new Date(window.resetsAt).toLocaleString('it-IT')}</p></div>)}</div>)}
      {!state.quotas.data?.buckets.length&&<p className="text-sm">Quote non ricevute. Dipendono dal piano e dai campi esposti da Claude; non sono ricavate dai token.</p>}
      <p className="text-sm">Costo di questa sessione: {state.cost===null?'Non disponibile':`${state.cost.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:4})} USD stimati, non fattura`}. È distinto dallo storico e dall’abbonamento.</p>
      <p className="text-xs text-muted-foreground">Aggiorna rilegge soltanto la cache. I nuovi dati dipendono dall’attività di Claude, anche quando Localino è nella barra. I reset trascorsi non azzerano i valori. Progetti, flag o policy gestite possono prevalere: controlla /status in Claude e l’autorizzazione della cartella. Localino non sovrascrive gli override.</p>
    </>}
  </section>
}
