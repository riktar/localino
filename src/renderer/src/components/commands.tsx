import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react'
import { commands,defaultBindings,keyFromEvent,type CommandId,type ShortcutState } from '../../../shared/commands'
import { Button } from './ui/button'

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
      const editing=!!target.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]),textarea,select,[contenteditable=true]')
      if(editing && (/^Ctrl\+(A|C|V|X|Z|Y)$/.test(key)||['Delete','Backspace','Enter','Tab'].includes(key)))return
      if(editing && (/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(event.key)||key==='Ctrl+Space'||(!event.ctrlKey&&!event.altKey&&event.key.length===1)))return
      const binding=state.bindings.find(b=>b.scope==='local'&&b.active&&b.key===key&&actions[b.id]&&!actions[b.id]?.disabled&&!(editing&&commands.find(c=>c.id===b.id)?.area==='List'))
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
    <div className="mb-4 flex items-center justify-between"><h2 id="palette-title" className="text-lg font-semibold">Commands</h2><Button variant="ghost" onClick={close}>Close</Button></div>
    <input autoFocus aria-label="Find command" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filtered[index]?`command-${filtered[index].id}`:undefined} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0)}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(i=>filtered.length?(i+(e.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length:0)}if(e.key==='Enter'){e.preventDefault();if(filtered[index])execute(filtered[index].id)}}} className="mb-3 w-full rounded-md border bg-background p-3"/>
    <ul id="command-results" role="listbox" aria-label="Commands" className="max-h-[55vh] space-y-1 overflow-y-auto">{filtered.map((c,i)=>{const reason=actions[c.id]?.disabled??(!actions[c.id]?`Available in ${c.area}.`:undefined);return <li key={c.id} id={`command-${c.id}`} data-command-index={i} role="option" aria-selected={index===i} aria-disabled={!!reason} className={`rounded-md ${i===index?'bg-muted':''}`}><button type="button" aria-disabled={!!reason} onClick={()=>execute(c.id)} className="w-full p-3 text-left"><span className="flex justify-between gap-4 text-sm"><span>{c.label}</span><kbd className="shrink-0 text-xs">{state.bindings.find(b=>b.id===c.id&&b.scope==='local')?.key}</kbd></span><span className="block text-xs text-muted-foreground">{reason??c.area}</span></button></li>})}</ul>
    {!filtered.length&&<p className="p-4 text-sm">No commands found.</p>}
  </dialog>
}
export function ShortcutSettings():React.JSX.Element {
  const registry=useCommandRegistry()!,{state}=registry
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('')
  const apply=async(value:unknown)=>{setBusy(true);setError('');setMessage('');try{const result=await window.localino.updateShortcuts(value);if(!result.ok)setError(result.error??'Could not save.');else setMessage('Saved.')}catch{setError('Could not save. Retry.')}finally{setBusy(false)}}
  useCommands({resetBindings:{run:()=>apply({reset:true}),disabled:busy?'Saving…':undefined}})
  return <section className="mt-3 space-y-3">
    {(error||state.error)&&<p role="alert" className="break-words text-sm text-destructive">{error||state.error}</p>}{message&&<p role="status" className="text-xs">{message}</p>}
    <input type="search" aria-label="Find shortcut" placeholder="Find shortcut" className="w-full rounded-md border p-2 text-sm" value={query} onChange={event=>setQuery(event.target.value)}/>
    {commands.filter(c=>c.label.toLowerCase().includes(query.toLowerCase())).map(command=><details className="rounded-lg border p-2" key={command.id}><summary className="cursor-pointer text-sm">{command.label}</summary>{state.bindings.filter(b=>b.id===command.id).map(b=><BindingRow key={b.scope+':'+b.key} binding={b} busy={busy} save={key=>apply({id:b.id,scope:b.scope,key})}/>)}</details>)}
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>void apply({reset:true})}>Reset defaults</Button>
    <details className="text-xs"><summary>Help</summary><p className="mt-2">Use Ctrl or Cmd, Alt, Shift and a key, such as Cmd+Alt+L. Global shortcuts work while Localino runs. Leave a binding empty to disable it. Text editing keeps its native shortcuts.</p></details>
  </section>
}
function BindingRow({binding:b,busy,save}:{binding:ShortcutState['bindings'][number];busy:boolean;save:(key:string)=>Promise<void>}):React.JSX.Element {
  const [key,setKey]=useState(b.key),label=commands.find(c=>c.id===b.id)!.label,scope=b.scope==='global'?'Global':'Local'
  return <form data-binding onSubmit={e=>{e.preventDefault();void save(key)}} className="mt-3 space-y-2 text-sm">
    <label htmlFor={b.id+'-'+b.scope}>{scope}</label><input id={b.id+'-'+b.scope} aria-label={label+' '+scope} value={key} onChange={e=>setKey(e.target.value)} className="w-full rounded-md border bg-background p-2"/>
    <p className={b.error?'text-destructive':'text-muted-foreground'}>{b.error??(b.active?'Active':b.key?'Inactive':'Disabled')}</p>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} type="submit">Apply</Button><Button type="button" size="sm" variant="ghost" disabled={busy||!b.key} onClick={()=>void save('')}>Disable</Button></div>
  </form>
}
