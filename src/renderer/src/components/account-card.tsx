import type { ConnectionError, ConnectionState } from '../../../shared/contracts'
import { Button } from './ui/button'

export const connectionErrors: Record<ConnectionError,string> = {
  cli_missing:'Codex not found. Choose its executable.', cli_invalid:'Invalid Codex path. Choose an executable.',
  incompatible:'Update Codex, then retry.', unauthenticated:'Sign in to ChatGPT in the Codex CLI, then retry.',
  unsupported_auth:'A ChatGPT account is required for subscription quotas.', timeout:'Codex timed out. Retry.',
  transport:'Connection interrupted. Retry.', preferences:'Preferences unavailable. Check access or recover them.',
}
export function AccountCard({state}:{state:ConnectionState}):React.JSX.Element {
  const connected=state.status==='connected',busy=state.status==='connecting'
  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Codex connection">
    <div className="flex justify-between text-sm"><strong>Codex</strong><span>{connected?'Connected':busy?'Connecting…':'Disconnected'}</span></div>
    {state.error&&<p role="alert" className="text-sm text-destructive">{connectionErrors[state.error]}</p>}
    <div className="flex flex-wrap gap-2">
      {connected?<><Button size="sm" variant="outline" onClick={()=>void window.localino.rereadAccount()}>Refresh account</Button><Button size="sm" variant="ghost" onClick={()=>void window.localino.disconnect()}>Disconnect</Button></>:<><Button size="sm" disabled={busy} onClick={()=>void window.localino.connect()}>{state.error?'Retry':'Connect'}</Button>{busy&&<Button size="sm" variant="ghost" onClick={()=>void window.localino.disconnect()}>Cancel</Button>}</>}
    </div>
    <details className="text-sm"><summary className="cursor-pointer">Details</summary><div className="mt-3 space-y-2">
      {connected&&<><p data-testid="account-email" className="break-all">{state.account?.email||'Codex account'}</p><p>Plan: {state.account?.plan&&state.account.plan!=='unknown'?state.account.plan:'Unavailable'}</p></>}
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>void window.localino.chooseCodex()}>Choose executable</Button>
      {state.error==='preferences'&&<Button size="sm" variant="outline" onClick={()=>void window.localino.recoverPreferences('codex')}>Recover preferences</Button>}
      <p className="text-xs text-muted-foreground">Disconnecting Localino keeps your CLI signed in.</p>
    </div></details>
  </section>
}
