import React from 'react'
import ReactDOM from 'react-dom/client'
import { ArrowDownRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccountCard } from '@/components/account-card'
import { useConnection } from '@/hooks/use-connection'
import './styles.css'

function App(): React.JSX.Element {
  const state = useConnection()
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
      <footer className="mt-auto space-y-3 pt-4">
        <Button variant="outline" className="w-full" onClick={() => window.localino.hide()}>
          <ArrowDownRight aria-hidden="true" /> Riduci nella barra
        </Button>
        <p className="text-center text-xs text-muted-foreground">Localino rimane a portata di click.</p>
      </footer>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
