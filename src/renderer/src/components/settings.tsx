import { useEffect, useState } from 'react'
import type { Theme, ThemeState } from '../../../shared/theme'
import { agentLabels, type LocalAgentId } from '../../../shared/agents'
import { useAgents } from './agents'
import { useConnection } from '../hooks/use-connection'
import { AccountCard } from './account-card'
import { ClaudeBridgeCard, useBridge } from './claude-bridge'
import { ShortcutSettings } from './commands'
import { CaptureSettings } from './capture'
import { Button } from './ui/button'

export function Settings():React.JSX.Element {
  const agents=useAgents(),connection=useConnection(),bridge=useBridge(),[error,setError]=useState<string>()
  const action=(promise:Promise<{ok:boolean;error?:string}>)=>void promise.then(result=>setError(result.error)).catch(()=>setError('Could not update connection. Retry.'))
  return <main className="space-y-3 p-3">
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <AppearanceSettings/>
    <details className="settings-section" open><summary>Connections</summary><div className="mt-3 space-y-3">
      <AccountCard state={connection}/>
      {(['claude','pi','opencode'] as LocalAgentId[]).map(id=><details key={id} className="rounded-lg border p-3 text-sm"><summary>{agentLabels[id]} <span className="text-muted-foreground">· {agents.sources[id].enabled?'Connected':'Disconnected'}</span></summary><div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={()=>action(agents.sources[id].enabled?window.localino.disconnectAgent(id):window.localino.connectAgent(id))}>{agents.sources[id].enabled?'Disconnect':'Connect'}</Button><Button size="sm" variant="outline" onClick={()=>action(window.localino.chooseAgentSource(id))}>Choose source</Button></div>
        <p className="break-all text-xs text-muted-foreground">{agents.sources[id].path??'Default source'}</p>
        {id==='claude'&&<ClaudeBridgeCard state={bridge}/>}
      </div></details>)}
      {agents.error&&<><p role="alert" className="text-sm text-destructive">{agents.error}</p><Button size="sm" onClick={()=>action(window.localino.recoverPreferences('agents'))}>Recover preferences</Button></>}
    </div></details>
    <details className="settings-section"><summary>Shortcuts</summary><ShortcutSettings/></details>
    <details className="settings-section"><summary>Capture</summary><div className="mt-3"><CaptureSettings/></div></details>
  </main>
}

function AppearanceSettings(): React.JSX.Element {
  const [state, setState] = useState<ThemeState | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let updated = false, disposed = false
    const off = window.localino.onTheme(next => { updated = true; setState(next) })
    void window.localino.getTheme().then(next => { if (!updated && !disposed) setState(next) })
    return () => { disposed = true; off() }
  }, [])
  const change = async (theme: Theme): Promise<void> => {
    setSaving(true)
    try { setState(await window.localino.setTheme(theme)) }
    catch { setState(previous => ({ preference: previous?.preference ?? 'system', error: 'Could not save appearance. Retry.' })) }
    finally { setSaving(false) }
  }
  return <section className="settings-section" aria-label="Appearance">
    <label className="flex items-center justify-between gap-3 font-medium">Theme
      <select aria-label="Theme" value={state?.preference ?? 'system'} disabled={!state || saving} onChange={event => void change(event.target.value as Theme)} className="rounded-md border bg-card px-3 py-2 font-normal">
        <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
    {state?.error && <p role="alert" className="mt-2 text-xs text-destructive">{state.error}</p>}
  </section>
}
