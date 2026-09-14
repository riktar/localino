import { LoaderCircle, Terminal } from 'lucide-react'
import type { ConnectionError, ConnectionState } from '../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const errors: Record<ConnectionError, string> = {
  cli_missing: 'Codex non trovato. Installa la CLI Codex oppure seleziona il suo eseguibile.',
  cli_invalid: 'Il percorso Codex non è valido. Seleziona un eseguibile disponibile.',
  incompatible: 'Questa versione di Codex non supporta il collegamento. Aggiorna la CLI e riprova.',
  unauthenticated: 'Accedi al tuo account ChatGPT nella CLI Codex, poi premi Riprova.',
  unsupported_auth: 'Serve un account ChatGPT in Codex. Le API key e gli altri provider non espongono questo abbonamento.',
  timeout: 'Codex non ha risposto entro 15 secondi. Puoi riprovare.',
  transport: 'La connessione con Codex si è interrotta. Puoi riprovare.',
  preferences: 'Impossibile salvare le preferenze. Verifica che la cartella dati di Localino sia scrivibile.',
}

export function AccountCard({ state }: { state: ConnectionState }): React.JSX.Element {
  const connected = state.status === 'connected'
  const busy = state.status === 'connecting'
  return <Card className="py-5 shadow-none">
    <CardContent className="space-y-4">
      <div className="flex items-center gap-3">
        <Terminal className="size-5" aria-hidden="true" />
        <span className="font-medium">Codex</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{connected ? 'Collegato' : busy ? 'Collegamento…' : 'Non collegato'}</span>
      </div>
      {connected ? <>
        <div className="min-w-0 space-y-1">
          <p data-testid="account-email" className="break-all text-sm">{state.account?.email || 'Account Codex'}</p>
          <p className="text-xs text-muted-foreground">Piano: <span className="font-medium">{state.account?.plan && state.account.plan !== 'unknown' ? state.account.plan : 'Non disponibile'}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void window.localino.rereadAccount()}>Rileggi account</Button>
          <Button size="sm" variant="ghost" onClick={() => void window.localino.disconnect()}>Scollega da Localino</Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Hai cambiato account nella CLI? Usa Rileggi account. Scollegare Localino mantiene l'accesso in Codex.</p>
      </> : <>
        <p className="text-sm leading-relaxed text-muted-foreground">Collega l'account Codex già autenticato su questo PC.</p>
        {state.error && <p role="alert" className="text-sm text-destructive">{errors[state.error]}</p>}
        <Button className="w-full" disabled={busy} onClick={() => void window.localino.connect()}>
          {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{busy ? 'Collegamento…' : state.error ? 'Riprova' : 'Collega Codex'}
        </Button>
        {busy ? <Button size="sm" variant="ghost" onClick={() => void window.localino.disconnect()}>Annulla collegamento</Button> : <Button size="sm" variant="ghost" onClick={() => void window.localino.chooseCodex()}>Seleziona eseguibile Codex</Button>}
      </>}
    </CardContent>
  </Card>
}
