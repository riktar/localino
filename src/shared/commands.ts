export const commands = [
  {id:'selectCodex',label:'Select Codex',area:'App',local:'',global:''},
  {id:'selectClaude',label:'Select Claude Code',area:'App',local:'',global:''},
  {id:'selectPi',label:'Select Pi',area:'App',local:'',global:''},
  {id:'selectOpenCode',label:'Select OpenCode',area:'App',local:'',global:''},
  {id:'home',label:'Open Localino',area:'App',local:'Ctrl+1',global:'Ctrl+Alt+L'},
  {id:'consumi',label:'Advanced usage',area:'App',local:'Ctrl+2',global:'Ctrl+Alt+U'},
  {id:'clipboard',label:'Open Clipboard',area:'App',local:'Ctrl+3',global:'Ctrl+Alt+C'},
  {id:'palette',label:'Commands',area:'App',local:'Ctrl+K'},
  {id:'shortcuts',label:'Settings',area:'App',local:'Ctrl+Comma'},
  {id:'new',label:'New note',area:'App',local:'Ctrl+N'},
  {id:'search',label:'Search notes',area:'Clipboard',local:'Ctrl+F'},
  {id:'edit',label:'Edit note',area:'List',local:'F2'},
  {id:'copy',label:'Copy selected notes',area:'List',local:'Ctrl+C'},
  {id:'complete',label:'Complete / reopen note',area:'List',local:'Ctrl+Enter'},
  {id:'delete',label:'Delete note',area:'List',local:'Delete'},
  {id:'save',label:'Save note',area:'Editor',local:'Ctrl+Enter'},
  {id:'closeEditor',label:'Close editor',area:'Editor',local:''},
  {id:'notesReload',label:'Reload notes',area:'Clipboard',local:''},
  {id:'notesOpen',label:'Show open notes',area:'Clipboard',local:''},
  {id:'notesCompleted',label:'Show completed notes',area:'Clipboard',local:''},
  {id:'notesAll',label:'Show all notes',area:'Clipboard',local:''},
  {id:'connect',label:'Connect / retry',area:'Usage',local:''},
  {id:'reread',label:'Refresh account',area:'Usage',local:''},
  {id:'choose',label:'Choose source',area:'Usage',local:''},
  {id:'disconnect',label:'Disconnect',area:'Usage',local:''},
  {id:'quotas',label:'Refresh quotas',area:'Usage',local:'Ctrl+R'},
  {id:'usage',label:'Refresh usage',area:'Usage',local:'Ctrl+Shift+R'},
  {id:'period7',label:'Last 7 days',area:'Usage',local:''},
  {id:'period30',label:'Last 30 days',area:'Usage',local:''},
  {id:'periodAll',label:'All available',area:'Usage',local:''},
  {id:'table',label:'Toggle daily table',area:'Usage',local:''},
  {id:'panel',label:'Show panel',area:'App',local:''},
  {id:'hide',label:'Hide panel',area:'App',local:'Escape'},
  {id:'quit',label:'Quit Localino',area:'App',local:''},
  {id:'resetBindings',label:'Reset shortcuts',area:'Settings',local:''},
  {id:'closeSettings',label:'Close settings',area:'Settings',local:''},
  {id:'capture',label:'Capture selection',area:'App',local:'',global:'Ctrl+Alt+P'},
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
    if(canonicalKey(b.key)!==b.key)return 'Invalid format.'
    if(b.scope==='global' && !b.key.includes('Ctrl+') && !b.key.includes('Alt+'))return 'A global shortcut requires Ctrl, Cmd or Alt.'
    // Standard editing remains available in text fields, including user-defined shortcuts.
    if(b.scope==='global' && /^(Ctrl\+(A|C|V|X|Z|Y|F)|Delete|Backspace)$/.test(b.key))return 'Reserved for text editing.'
    const area=commands.find(c=>c.id===b.id)!.area
    const conflict=bindings.find(other=>other!==b && other.key===b.key && (b.scope==='global'||other.scope==='global'||area===commands.find(c=>c.id===other.id)!.area||area==='App'||commands.find(c=>c.id===other.id)!.area==='App'||(area==='Clipboard'&&['List','Editor'].includes(commands.find(c=>c.id===other.id)!.area))||(commands.find(c=>c.id===other.id)!.area==='Clipboard'&&['List','Editor'].includes(area))))
    if(conflict)return `Conflicts with ${commands.find(c=>c.id===conflict.id)!.label} (${conflict.scope==='global'?'global':'local'}).`
  }
  return null
}
export function keyFromEvent(e:Pick<KeyboardEvent,'key'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'> & {code?:string}):string|null {
  if(e.metaKey)return null
  const named:Record<string,string>={' ':'Space',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down'}
  const punctuation:Record<string,string>={Comma:'Comma',Period:'Period'}
  const key=e.code&&/^Digit[0-9]$/.test(e.code)?e.code.slice(5):(e.code&&punctuation[e.code])||named[e.key]||e.key
  return canonicalKey([...(e.ctrlKey?['Ctrl']:[]),...(e.altKey?['Alt']:[]),...(e.shiftKey?['Shift']:[]),key].join('+'))
}
