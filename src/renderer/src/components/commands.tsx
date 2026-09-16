import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react'
import { commands,defaultBindings,keyFromEvent,type CommandId,type ShortcutState } from '../../../shared/commands'
import { Button } from './ui/button'
import { CaptureSettings } from './capture'

export interface CommandAction {run:()=>unknown;disabled?:string;label?:string}
type Actions=Partial<Record<CommandId,CommandAction>>
interface Registry {register:(actions:Actions)=>()=>void;run:(id:CommandId)=>void;state:ShortcutState;open:()=>void}
const Context=createContext<Registry|null>(null)
export const useCommandRegistry=():Registry|null=>useContext(Context)
export function useCommands(actions:Actions):void {
  const registry=useCommandRegistry();const latest=useRef(actions);latest.current=actions
  const signature=JSON.stringify(Object.entries(actions).map(([id,a])=>[id,a?.disabled,a?.label]))
  const register=registry?.register
  useEffect(()=>{
    if(!register)return
    const entries=Object.fromEntries(Object.entries(latest.current).map(([id,a])=>[id,{disabled:a?.disabled,label:a?.label,run:()=>latest.current[id as CommandId]?.run()}]))
    return register(entries)
  },[register,signature])
}
export function CommandProvider({children}:{children:ReactNode}):React.JSX.Element {
  const [actions,setActions]=useState<Actions>({})
  const [state,setState]=useState<ShortcutState>({bindings:defaultBindings()})
  const [palette,setPalette]=useState(false)
  const register=useCallback((entries:Actions)=>{setActions(prev=>({...prev,...entries}));return ()=>setActions(prev=>{const next={...prev};for(const key of Object.keys(entries) as CommandId[])delete next[key];return next})},[])
  const run=useCallback((id:CommandId)=>{const action=actions[id];if(action&&!action.disabled)void action.run()},[actions])
  const open=useCallback(()=>setPalette(true),[])
  useEffect(()=>{const off=window.localino.onShortcuts(setState);void window.localino.getShortcuts().then(setState);return off},[])
  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.getModifierState('AltGraph')||document.querySelector('dialog[open]'))return
      const target=event.target as HTMLElement
      if(target.closest('[data-binding]'))return
      const key=keyFromEvent(event);if(!key)return
      const editing=!!target.closest('input,textarea,select,[contenteditable=true]')
      if(editing && (/^Ctrl\+(A|C|V|X|Z|Y)$/.test(key)||['Delete','Backspace','Enter','Tab'].includes(key)))return
      if(editing && (/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(event.key)||key==='Ctrl+Space'||(!event.ctrlKey&&!event.altKey&&event.key.length===1)))return
      const binding=state.bindings.find(b=>b.scope==='local'&&b.active&&b.key===key&&actions[b.id]&&!actions[b.id]?.disabled&&!(editing&&commands.find(c=>c.id===b.id)?.area==='Lista'))
      if(binding){event.preventDefault();run(binding.id)}
    }
    window.addEventListener('keydown',keydown);return ()=>window.removeEventListener('keydown',keydown)
  },[actions,run,state])
  return <Context.Provider value={{register,run,state,open}}>{children}{palette&&<Palette actions={actions} state={state} close={()=>setPalette(false)} run={run}/>}</Context.Provider>
}
function Palette({actions,state,close,run}:{actions:Actions;state:ShortcutState;close:()=>void;run:(id:CommandId)=>void}):React.JSX.Element {
  const dialog=useRef<HTMLDialogElement>(null);const [query,setQuery]=useState('');const [index,setIndex]=useState(0)
  const filtered=commands.map(c=>({...c,label:actions[c.id]?.label??c.label})).filter(c=>(c.label+' '+c.area).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  useEffect(()=>{const origin=document.activeElement as HTMLElement;dialog.current!.showModal();return ()=>{if(origin?.isConnected)origin.focus()}},[])
  useEffect(()=>{dialog.current?.querySelector(`[data-command-index="${index}"]`)?.scrollIntoView({block:'nearest'})},[index])
  const execute=(id:CommandId)=>{if(!actions[id]||actions[id]?.disabled)return;close();requestAnimationFrame(()=>run(id))}
  return <dialog ref={dialog} onCancel={e=>{e.preventDefault();close()}} aria-labelledby="palette-title" className="m-auto w-[min(92vw,620px)] rounded-xl border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/30">
    <div className="mb-4 flex items-center justify-between"><h2 id="palette-title" className="text-lg font-semibold">Catalogo comandi</h2><Button variant="ghost" onClick={close}>Chiudi</Button></div>
    <input autoFocus aria-label="Cerca comando" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filtered[index]?`command-${filtered[index].id}`:undefined} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0)}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(i=>filtered.length?(i+(e.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length:0)}if(e.key==='Enter'){e.preventDefault();if(filtered[index])execute(filtered[index].id)}}} className="mb-3 w-full rounded-md border bg-background p-3"/>
    <ul id="command-results" role="listbox" aria-label="Comandi" className="max-h-[55vh] space-y-1 overflow-y-auto">{filtered.map((c,i)=>{const reason=actions[c.id]?.disabled??(!actions[c.id]?`Disponibile nel contesto ${c.area}.`:undefined);return <li key={c.id} id={`command-${c.id}`} data-command-index={i} role="option" aria-selected={index===i} aria-disabled={!!reason} className={`rounded-md ${i===index?'bg-muted':''}`}><button type="button" aria-disabled={!!reason} onClick={()=>execute(c.id)} className="w-full p-3 text-left"><span className="flex justify-between gap-4 text-sm"><span>{c.label}</span><kbd className="shrink-0 text-xs">{state.bindings.find(b=>b.id===c.id&&b.scope==='local')?.key}</kbd></span><span className="block text-xs text-muted-foreground">{reason??c.area}</span></button></li>})}</ul>
    {!filtered.length&&<p className="p-4 text-sm">Nessun comando trovato.</p>}
  </dialog>
}
export function ShortcutSettings():React.JSX.Element {
  const registry=useCommandRegistry()!;const {state}=registry
  const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
  const apply=async(value:unknown)=>{setBusy(true);setError('');setMessage('');try{const result=await window.localino.updateShortcuts(value);if(!result.ok)setError(result.error??'Modifica non riuscita.');else setMessage('Scorciatoie salvate.')}catch{setError('Modifica non riuscita. Riprova.')}finally{setBusy(false)}}
  useCommands({resetBindings:{run:()=>apply({reset:true}),disabled:busy?'Salvataggio in corso.':undefined}})
  return <main className="mx-auto max-w-5xl space-y-5 p-6"><header><h1 className="text-3xl font-semibold">Scorciatoie</h1><p className="mt-2 text-sm text-muted-foreground">Le combinazioni globali funzionano mentre Localino è in esecuzione. Lascia vuoto per disabilitare. Formati: Ctrl+Alt+L, Ctrl+Shift+R, F2, Ctrl+Comma.</p><p className="mt-2 text-sm text-muted-foreground">Nei campi testo, copia, incolla, selezione e cancellazione mantengono il comportamento normale. Invio inserisce una nuova riga.</p></header>
    {(error||state.error)&&<p role="alert" className="break-words text-sm text-destructive">{error||state.error}</p>}<p role="status" className="text-sm">{message}</p>
    <div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={()=>void apply({reset:true})}>Ripristina default</Button><Button variant="ghost" onClick={()=>registry.run('closeSettings')}>Chiudi impostazioni</Button></div>
    <CaptureSettings/>
    <div className="space-y-3">{state.bindings.map(b=><BindingRow key={`${b.id}:${b.scope}:${b.key}`} binding={b} busy={busy} save={key=>apply({id:b.id,scope:b.scope,key})}/>)}</div>
  </main>
}
function BindingRow({binding:b,busy,save}:{binding:ShortcutState['bindings'][number];busy:boolean;save:(key:string)=>Promise<void>}):React.JSX.Element {
  const [key,setKey]=useState(b.key);const label=commands.find(c=>c.id===b.id)!.label;const scope=b.scope==='global'?'Globale':'Locale'
  return <form data-binding onSubmit={e=>{e.preventDefault();void save(key)}} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3"><div className="min-w-48 flex-1"><label htmlFor={`${b.id}-${b.scope}`} className="text-sm font-medium">{label} · {scope}</label><p className={`text-xs ${b.error?'text-destructive':'text-muted-foreground'}`}>{b.error??(b.active?'Attiva':b.key?'Non attiva':'Disabilitata')}</p></div><input id={`${b.id}-${b.scope}`} aria-label={`${label} ${scope}`} value={key} onChange={e=>setKey(e.target.value)} className="w-44 rounded-md border bg-background p-2 text-sm"/><Button size="sm" variant="outline" disabled={busy} type="submit">Applica</Button><Button type="button" size="sm" variant="ghost" disabled={busy||!b.key} onClick={()=>void save('')}>Disabilita</Button></form>
}
