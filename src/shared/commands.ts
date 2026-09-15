export const commands = [
  {id:'home',label:'Apri Home',area:'App',local:'Ctrl+1',global:'Ctrl+Alt+L'},
  {id:'consumi',label:'Apri Consumi',area:'App',local:'Ctrl+2',global:'Ctrl+Alt+U'},
  {id:'clipboard',label:'Apri Clipboard',area:'App',local:'Ctrl+3',global:'Ctrl+Alt+C'},
  {id:'palette',label:'Catalogo comandi',area:'App',local:'Ctrl+K'},
  {id:'shortcuts',label:'Scorciatoie',area:'App',local:'Ctrl+Comma'},
  {id:'new',label:'Nuovo prompt',area:'App',local:'Ctrl+N'},
  {id:'search',label:'Cerca prompt',area:'Clipboard',local:'Ctrl+F'},
  {id:'edit',label:'Modifica prompt',area:'Lista',local:'F2'},
  {id:'copy',label:'Copia prompt',area:'Lista',local:'Ctrl+C'},
  {id:'complete',label:'Completa / riapri prompt',area:'Lista',local:'Ctrl+Enter'},
  {id:'delete',label:'Elimina prompt',area:'Lista',local:'Delete'},
  {id:'save',label:'Salva prompt',area:'Editor',local:'Ctrl+Enter'},
  {id:'closeEditor',label:'Chiudi editor',area:'Editor',local:''},
  {id:'notesReload',label:'Riprova lettura prompt',area:'Clipboard',local:''},
  {id:'notesOpen',label:'Mostra prompt aperti',area:'Clipboard',local:''},
  {id:'notesCompleted',label:'Mostra prompt completati',area:'Clipboard',local:''},
  {id:'notesAll',label:'Mostra tutti i prompt',area:'Clipboard',local:''},
  {id:'connect',label:'Collega Codex / riprova',area:'Consumi',local:''},
  {id:'reread',label:'Rileggi account',area:'Consumi',local:''},
  {id:'choose',label:'Seleziona eseguibile Codex',area:'Consumi',local:''},
  {id:'disconnect',label:'Scollega / annulla collegamento',area:'Consumi',local:''},
  {id:'quotas',label:'Aggiorna quote',area:'Consumi',local:'Ctrl+R'},
  {id:'usage',label:'Aggiorna statistiche',area:'Consumi',local:'Ctrl+Shift+R'},
  {id:'period7',label:'Ultimi 7 giorni',area:'Consumi',local:''},
  {id:'period30',label:'Ultimi 30 giorni',area:'Consumi',local:''},
  {id:'periodAll',label:'Tutti i dati disponibili',area:'Consumi',local:''},
  {id:'table',label:'Apri / chiudi tabella giornaliera',area:'Consumi',local:''},
  {id:'panel',label:'Apri pannello quote',area:'App',local:''},
  {id:'hide',label:'Riduci nella barra',area:'App',local:'Escape'},
  {id:'quit',label:'Esci da Localino',area:'App',local:''},
  {id:'resetBindings',label:'Ripristina scorciatoie predefinite',area:'Scorciatoie',local:''},
  {id:'closeSettings',label:'Chiudi impostazioni scorciatoie',area:'Scorciatoie',local:''},
  {id:'capture',label:'Cattura selezione esterna',area:'App',local:''},
] as const
export type CommandId = typeof commands[number]['id']
export type Scope = 'local'|'global'
export interface Binding {id:CommandId;scope:Scope;key:string;active:boolean;error?:string}
export interface ShortcutState {bindings:Binding[];error?:string}
export type ShortcutResult = {ok:boolean;state:ShortcutState;error?:string}
export const isCommand = (id:unknown):id is CommandId => commands.some(c=>c.id===id)
export function defaultBindings():Binding[] {
  return commands.flatMap(c=>[{id:c.id,scope:'local' as const,key:c.local,active:!!c.local},...('global' in c ? [{id:c.id,scope:'global' as const,key:c.global,active:false}] : [])])
}
export function canonicalKey(value:unknown):string|null {
  if (typeof value!=='string' || value.length>80) return null
  if (!value.trim()) return ''
  const parts=value.trim().split('+').map(p=>p.trim().toLowerCase())
  const aliases:Record<string,string>={control:'Ctrl',ctrl:'Ctrl',alt:'Alt',shift:'Shift',esc:'Escape',escape:'Escape',enter:'Enter',return:'Enter',delete:'Delete',backspace:'Backspace',tab:'Tab',space:'Space',comma:'Comma',',':'Comma',period:'Period','.':'Period',home:'Home',end:'End',up:'Up',down:'Down',left:'Left',right:'Right',pageup:'PageUp',pagedown:'PageDown'}
  const keyPart=parts.pop()!;const key=aliases[keyPart] ?? (/^[a-z0-9]$/.test(keyPart) || /^f([1-9]|1[0-9]|2[0-4])$/.test(keyPart) ? keyPart.toUpperCase():null)
  if(!key || ['Ctrl','Alt','Shift'].includes(key))return null
  const mods=parts.map(p=>aliases[p]);if(mods.some(m=>!['Ctrl','Alt','Shift'].includes(m))||new Set(mods).size!==mods.length)return null
  if (!mods.length && !/^(F\d+|Escape|Delete)$/.test(key))return null
  return [...['Ctrl','Alt','Shift'].filter(m=>mods.includes(m)),key].join('+')
}
export function bindingsError(bindings:Binding[]):string|null {
  for(const b of bindings){
    if(!b.key)continue
    if(canonicalKey(b.key)!==b.key)return 'Formato non valido.'
    if(b.scope==='global' && !b.key.includes('Ctrl+') && !b.key.includes('Alt+'))return 'Una scorciatoia globale richiede Ctrl o Alt.'
    // Standard editing remains available in text fields, including user-defined shortcuts.
    if(b.scope==='global' && /^(Ctrl\+(A|C|V|X|Z|Y|F)|Delete|Backspace)$/.test(b.key))return 'Combinazione riservata alla modifica del testo.'
    const area=commands.find(c=>c.id===b.id)!.area
    const conflict=bindings.find(other=>other!==b && other.key===b.key && (b.scope==='global'||other.scope==='global'||area===commands.find(c=>c.id===other.id)!.area||area==='App'||commands.find(c=>c.id===other.id)!.area==='App'||(area==='Clipboard'&&['Lista','Editor'].includes(commands.find(c=>c.id===other.id)!.area))||(commands.find(c=>c.id===other.id)!.area==='Clipboard'&&['Lista','Editor'].includes(area))))
    if(conflict)return `Collisione con ${commands.find(c=>c.id===conflict.id)!.label} (${conflict.scope==='global'?'globale':'locale'}).`
  }
  return null
}
export function keyFromEvent(e:Pick<KeyboardEvent,'key'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'> & {code?:string}):string|null {
  if(e.metaKey)return null
  const named:Record<string,string>={' ':'Space',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down'}
  const key=e.code&&/^Digit[0-9]$/.test(e.code)?e.code.slice(5):named[e.key]??e.key
  return canonicalKey([...(e.ctrlKey?['Ctrl']:[]),...(e.altKey?['Alt']:[]),...(e.shiftKey?['Shift']:[]),key].join('+'))
}
