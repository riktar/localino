import { isAgentId, type AgentId } from './agents'

export const transcriptKinds = ['prompt', 'assistant', 'reasoning-summary', 'tool', 'command', 'file', 'output', 'approval', 'input', 'status', 'error', 'unknown'] as const
export type TranscriptKind = typeof transcriptKinds[number]
export type TranscriptOutcome = 'streaming' | 'completed' | 'interrupted' | 'failed' | 'unknown'
export interface TranscriptInput {
  eventId: string
  sessionId: string
  provider: AgentId
  providerSessionId: string | null
  turnId: string | null
  itemId: string
  kind: TranscriptKind
  operation: 'start' | 'append' | 'snapshot' | 'finish' | 'notice'
  text?: string
  offset?: number
  outcome?: TranscriptOutcome
  phase?: 'commentary' | 'final'
  label?: string
}
export interface TranscriptEvent extends TranscriptInput {
  version: 1
  inputHash: string
  sequence: number
  timestamp: number
  disposition: 'applied' | 'duplicate' | 'late' | 'gap'
}
export interface TranscriptInfo {
  version: 1
  sessionId: string
  provider: AgentId
  projectPath: string
  projectName: string
  createdAt: number
  updatedAt: number
  bytes: number
  events: number
  interrupted: boolean
  error: string | null
  reasoning: 'unavailable' | 'published-summary'
}
export interface TranscriptPage {
  info: TranscriptInfo
  events: TranscriptEvent[]
  states: Record<string,TranscriptItemState>
  before: number | null
  after: number | null
}
export const transcriptLimits = { eventBytes: 1024 * 1024, segmentBytes: 4 * 1024 * 1024, pageBytes: 2 * 1024 * 1024, pageEvents: 100, pendingBytes: 8 * 1024 * 1024 } as const
export const transcriptPolicy = 'Stored locally until you explicitly delete it. No automatic expiry or session size cap. Events over 1 MiB and storage failures are reported; output is never silently shortened. Private reasoning is unavailable; only published summaries can be shown.'
export function transcriptId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) }
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && ![...value].some(character=>character.charCodeAt(0)<32)
export function cleanTranscriptInput(value: unknown): TranscriptInput {
  if (!value || typeof value !== 'object') throw Error('Invalid transcript event.')
  const v = value as TranscriptInput
  if (!transcriptId(v.sessionId) || !isAgentId(v.provider) || !identity(v.eventId) || !identity(v.itemId) || v.providerSessionId !== null && !identity(v.providerSessionId) || v.turnId !== null && !identity(v.turnId) || !transcriptKinds.includes(v.kind) || !['start','append','snapshot','finish','notice'].includes(v.operation)) throw Error('Invalid transcript identity or event type.')
  if (v.text !== undefined && typeof v.text !== 'string' || v.offset !== undefined && (!Number.isSafeInteger(v.offset) || v.offset < 0) || v.outcome !== undefined && !['streaming','completed','interrupted','failed','unknown'].includes(v.outcome) || v.phase !== undefined && !['commentary','final'].includes(v.phase) || v.label !== undefined && (typeof v.label !== 'string' || v.label.length > 512)) throw Error('Invalid transcript content.')
  if (v.operation === 'append' && (v.offset === undefined || v.text === undefined)) throw Error('Transcript deltas require an explicit text offset.')
  // Select fields deliberately: transport envelopes, auth and arbitrary provider objects never enter storage.
  return { eventId:v.eventId, sessionId:v.sessionId, provider:v.provider, providerSessionId:v.providerSessionId, turnId:v.turnId, itemId:v.itemId, kind:v.kind, operation:v.operation,
    ...(v.text === undefined ? {} : {text:v.text}), ...(v.offset === undefined ? {} : {offset:v.offset}), ...(v.outcome === undefined ? {} : {outcome:v.outcome}), ...(v.phase === undefined ? {} : {phase:v.phase}), ...(v.label === undefined ? {} : {label:v.label}) }
}
export interface TranscriptItemState { length: number; outcome: TranscriptOutcome; gap: boolean; kind: TranscriptKind }
export interface TranscriptViewItem { key:string; kind:TranscriptKind; text:string; label:string; phase?:'commentary'|'final'; outcome:TranscriptOutcome; continued:boolean; gap:boolean }
export function projectTranscriptPage(page:TranscriptPage):TranscriptViewItem[] {
  const items=new Map<string,TranscriptViewItem>()
  for(const event of page.events) {
    const key=transcriptItemKey(event),state=page.states[key]
    let item=items.get(key)
    if(!item){item={key,kind:event.kind,text:'',label:event.label??event.kind,outcome:state?.outcome??'unknown',continued:event.operation==='append'&&(event.offset??0)>0,gap:state?.gap??false,phase:event.phase};items.set(key,item)}
    if(event.disposition!=='applied')continue
    if(event.operation==='append')item.text+=event.text??''
    else if(event.text!==undefined){item.text=event.text;if(event.operation==='snapshot')item.continued=false}
    if(event.phase)item.phase=event.phase
  }
  return [...items.values()]
}
export function transcriptItemKey(event: TranscriptInput): string { return JSON.stringify([event.provider, event.providerSessionId, event.turnId, event.itemId]) }
export function reduceTranscriptItem(previous: TranscriptItemState | undefined, event: TranscriptInput): { state: TranscriptItemState; disposition: TranscriptEvent['disposition'] } {
  const state = {...(previous ?? {length:0, outcome:'streaming' as const, gap:false, kind:event.kind})}
  if (previous && previous.kind !== event.kind) return {state:{...state,gap:true,outcome:'unknown'},disposition:'gap'}
  if (previous && previous.outcome !== 'streaming' && event.operation !== 'notice') return {state,disposition:'late'}
  if (event.operation === 'append') {
    if (event.offset! < state.length) return {state,disposition:'duplicate'}
    if (event.offset! > state.length) return {state:{...state,gap:true},disposition:'gap'}
    state.length += event.text!.length
  } else if (event.operation === 'snapshot') { state.length = event.text?.length ?? 0 }
  else if (event.operation === 'start' && previous) return {state,disposition:'duplicate'}
  else if (event.text !== undefined) state.length = event.text.length
  if (event.outcome) state.outcome = state.gap && event.outcome === 'completed' ? 'unknown' : event.outcome
  if (event.operation === 'finish' && !event.outcome) state.outcome = state.gap ? 'unknown' : 'completed'
  return {state,disposition:'applied'}
}
