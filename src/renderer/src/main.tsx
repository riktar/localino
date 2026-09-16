import React from 'react'
import ReactDOM from 'react-dom/client'
import { ArrowDownRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccountCard } from '@/components/account-card'
import { useConnection } from '@/hooks/use-connection'
import { useQuotas } from '@/hooks/use-quotas'
import { QuotaCard } from '@/components/quota-card'
import { Shell } from '@/components/shell'
import { CommandProvider,useCommands } from '@/components/commands'
import { CaptureView } from '@/components/capture'
import './styles.css'

function App(): React.JSX.Element {
  const state = useConnection()
  const quotas = useQuotas()
  const unavailable=state.status!=='connected'?'Collega prima Codex.':undefined
  useCommands({
    home:{run:()=>window.localino.navigate('home')},consumi:{run:()=>window.localino.navigate('consumi')},clipboard:{run:()=>window.localino.navigate('clipboard')},shortcuts:{run:()=>window.localino.navigate('shortcuts')},
    capture:{run:()=>window.localino.requestCapture()},
    palette:{run:()=>window.localino.requestCommand('palette')},new:{run:()=>window.localino.requestCommand('new')},hide:{run:()=>window.localino.hide()},quit:{run:()=>window.localino.quit()},
    connect:{run:()=>window.localino.connect(),disabled:state.status==='connected'||state.status==='connecting'?'Account già collegato o collegamento in corso.':undefined},
    reread:{run:()=>window.localino.rereadAccount(),disabled:unavailable},choose:{run:()=>window.localino.chooseCodex(),disabled:state.status==='connecting'?'Collegamento in corso.':undefined},
    disconnect:{run:()=>window.localino.disconnect(),disabled:state.status==='disconnected'?'Account già scollegato.':undefined},quotas:{run:()=>window.localino.refreshQuotas(),disabled:unavailable??(quotas.refreshing?'Lettura in corso.':undefined)},
  })
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-xl font-semibold text-primary-foreground" aria-hidden="true">l.</div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">localino</h1>
          <p className="text-xs text-muted-foreground">Un posto per i tuoi agenti.</p>
        </div>
      </header>
      <section className="space-y-4" aria-labelledby="accounts-title">
        <div className="flex items-center justify-between">
          <h2 id="accounts-title" className="text-sm font-medium">Abbonamenti</h2>
          <span className="text-xs text-muted-foreground">{state.status === 'connected' ? '1 collegato' : '0 collegati'}</span>
        </div>
        <AccountCard state={state} />
      </section>
      {state.status === 'connected' && <QuotaCard state={quotas} />}
      <footer className="mt-auto space-y-3 pt-4">
        <Button className="w-full" onClick={() => void window.localino.openDashboard()}>Apri dashboard</Button>
        <Button variant="outline" className="w-full" onClick={() => window.localino.hide()}>
          <ArrowDownRight aria-hidden="true" /> Riduci nella barra
        </Button>
        <p className="text-center text-xs text-muted-foreground">Localino rimane a portata di click.</p>
      </footer>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{new URLSearchParams(location.search).get('view') === 'capture' ? <CaptureView/> : new URLSearchParams(location.search).get('view') === 'main' ? <Shell /> : <CommandProvider><App /></CommandProvider>}</React.StrictMode>,
)
