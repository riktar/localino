import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { cleanTranscriptInput, reduceTranscriptItem, transcriptId, transcriptItemKey, transcriptLimits, type TranscriptEvent, type TranscriptInfo, type TranscriptInput, type TranscriptItemState, type TranscriptPage } from '../../shared/transcript'
import { isAgentId } from '../../shared/agents'

interface Segment { name: string; first: number; last: number; bytes: number }
class EventIndex {
  private bits:Buffer|undefined
  private positions(id:string):number[]{const hash=createHash('sha256').update(id).digest();return [0,4,8,12].map(offset=>hash.readUInt32LE(offset)%(1024*1024*8))}
  add(id:string):void {this.bits??=Buffer.alloc(1024*1024);for(const bit of this.positions(id))this.bits[bit>>>3]|=1<<(bit&7)}
  has(id:string):boolean {return !!this.bits&&this.positions(id).every(bit=>(this.bits![bit>>>3]&(1<<(bit&7)))!==0)}
}
interface SessionData { info: TranscriptInfo; segments: Segment[]; items: Map<string,TranscriptItemState>; ids: EventIndex; recent:TranscriptEvent[]; recentBytes:number; loaded: boolean; writable: boolean; freshSegment: boolean }
const digest = (text:string):string => createHash('sha256').update(text).digest('hex')
function atomic(file:string, value:unknown):void {
  const temporary = `${file}.${randomUUID()}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try { writeFileSync(fd,JSON.stringify(value));fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary,file)
}
// Runs only in the transcript worker. The output bytes are streamed, never read as a complete session.
function* lines(file:string):Generator<string> {
  const fd = openSync(file,'r'), chunk = Buffer.alloc(64*1024)
  let pending = Buffer.alloc(0)
  try {
    for (;;) {
      const count = readSync(fd,chunk,0,chunk.length,null)
      if (!count) break
      pending = Buffer.concat([pending,chunk.subarray(0,count)])
      for (let end = pending.indexOf(10); end >= 0; end = pending.indexOf(10)) {
        yield pending.subarray(0,end).toString('utf8');pending = pending.subarray(end+1)
      }
      if (pending.length > transcriptLimits.eventBytes + 4096) throw Error('Oversized record preserved.')
    }
    if (pending.length) throw Error('Interrupted tail preserved.')
  } finally { closeSync(fd) }
}
function decode(line:string):TranscriptEvent {
  const wrapper = JSON.parse(line) as {event:TranscriptEvent;checksum:string}
  if (!wrapper.event || digest(JSON.stringify(wrapper.event)) !== wrapper.checksum) throw Error('Invalid record checksum.')
  const event = wrapper.event
  cleanTranscriptInput(event)
  if (event.version !== 1 || !/^[a-f0-9]{64}$/.test(event.inputHash) || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !['applied','duplicate','late','gap'].includes(event.disposition)) throw Error('Invalid record schema.')
  return event
}
function metadata(value:unknown,id:string):TranscriptInfo {
  const v=value as TranscriptInfo|null
  if(!v||v.version!==1||v.sessionId!==id||!isAgentId(v.provider)||typeof v.projectPath!=='string'||typeof v.projectName!=='string'||!Number.isSafeInteger(v.events)||v.events<0||!Number.isSafeInteger(v.bytes)||v.bytes<0||!Number.isFinite(v.createdAt)||!Number.isFinite(v.updatedAt))throw Error('Invalid transcript metadata.')
  return {version:1,sessionId:id,provider:v.provider,projectPath:v.projectPath,projectName:v.projectName,createdAt:v.createdAt,updatedAt:v.updatedAt,events:v.events,bytes:v.bytes,interrupted:v.interrupted===true,error:typeof v.error==='string'?v.error:null,reasoning:v.reasoning==='published-summary'?'published-summary':'unavailable'}
}
export class TranscriptStore {
  private readonly sessions = new Map<string,SessionData>()
  error:string | null = null
  constructor(private readonly root:string, private readonly beforeWrite:()=>void = ()=>{}) {
    mkdirSync(root,{recursive:true})
    for (const id of readdirSync(root)) {
      if (!transcriptId(id) || !statSync(join(root,id)).isDirectory()) continue
      try {
        const info = metadata(JSON.parse(readFileSync(join(root,id,'session.json'),'utf8')),id)
        const data:SessionData = {info:{...info,interrupted:false},segments:[],items:new Map(),ids:new EventIndex(),recent:[],recentBytes:0,loaded:false,writable:true,freshSegment:true}
        try {
          const manifest = JSON.parse(readFileSync(join(root,id,'manifest.json'),'utf8')) as {info:TranscriptInfo}
          const saved=metadata(manifest.info,id)
          if(saved.provider!==info.provider||saved.projectPath!==info.projectPath)throw Error()
          data.info = {...saved,interrupted:saved.interrupted || (manifest as {active?:boolean}).active === true}
        } catch {
          data.info.error = 'Transcript index is unavailable. Original files are preserved and will be scanned.'
          const file=join(root,id,'manifest.json')
          if(existsSync(file))try{copyFileSync(file,`${file}.corrupt-${randomUUID()}`)}catch{data.writable=false}
        }
        const snapshot=join(root,id,'snapshot.json')
        if(existsSync(snapshot))try{const value=JSON.parse(readFileSync(snapshot,'utf8'));if(value.version!==1||!Array.isArray(value.recent))throw Error()}catch{
          data.info.error='Transcript snapshot is unavailable. Original files are preserved and will be scanned.'
          try{copyFileSync(snapshot,`${snapshot}.corrupt-${randomUUID()}`)}catch{data.writable=false}
        }
        this.sessions.set(id,data)
      } catch { this.error = 'A transcript has unreadable session metadata. Its directory was preserved; it cannot be opened until the metadata is repaired.' }
    }
  }
  create(info:Pick<TranscriptInfo,'sessionId'|'provider'|'projectPath'|'projectName'>):TranscriptInfo {
    if (!transcriptId(info.sessionId)) throw Error('Invalid transcript session.')
    const existing = this.sessions.get(info.sessionId)
    if (existing) {
      if (existing.info.provider !== info.provider || existing.info.projectPath !== info.projectPath) throw Error('Transcript session identity mismatch.')
      return {...existing.info}
    }
    const now = Date.now(),metadata:TranscriptInfo = {version:1,...info,createdAt:now,updatedAt:now,bytes:0,events:0,interrupted:false,error:null,reasoning:'unavailable'}
    mkdirSync(join(this.root,info.sessionId))
    atomic(join(this.root,info.sessionId,'session.json'),metadata)
    const data:SessionData = {info:metadata,segments:[],items:new Map(),ids:new EventIndex(),recent:[],recentBytes:0,loaded:true,writable:true,freshSegment:true}
    this.sessions.set(info.sessionId,data);this.checkpoint(data)
    return {...metadata}
  }
  list():TranscriptInfo[] { return [...this.sessions.values()].map(data=>({...data.info})).sort((a,b)=>b.updatedAt-a.updatedAt) }
  private load(id:string):SessionData {
    const data = this.sessions.get(id)
    if (!data) throw Error('Transcript not found.')
    if (data.loaded) return data
    data.loaded = true;data.info.bytes = 0;data.info.events = 0
    const directory = join(this.root,id)
    for (const name of readdirSync(directory).filter(name=>/^events-\d{8}\.jsonl$/.test(name)).sort()) {
      const segment:Segment = {name,first:data.info.events+1,last:data.info.events,bytes:statSync(join(directory,name)).size}
      data.info.bytes += segment.bytes
      try {
        for (const line of lines(join(directory,name))) {
          try {
            const event = decode(line)
            if (event.sessionId !== id || event.provider !== data.info.provider || event.sequence <= data.info.events) throw Error('Record identity or order mismatch.')
            if (event.sequence !== data.info.events+1) data.info.error = 'Transcript contains a sequence gap. Original files preserved.'
            data.info.events = event.sequence;segment.last = event.sequence
            data.ids.add(event.eventId)
            const key = transcriptItemKey(event),reduced = reduceTranscriptItem(data.items.get(key),event)
            if(event.disposition==='gap')reduced.state.gap=true
            data.items.set(key,reduced.state)
            this.remember(data,event)
            if (event.kind === 'reasoning-summary') data.info.reasoning = 'published-summary'
          } catch { data.info.error = 'Transcript contains a corrupt record. Original files preserved; completeness is unknown.' }
        }
      } catch { data.info.error = 'Transcript has an interrupted or oversized tail. Original files preserved; completeness is unknown.' }
      data.segments.push(segment)
    }
    if ([...data.items.values()].some(item=>item.outcome === 'streaming')) {
      data.info.interrupted = true
      for (const item of data.items.values()) if (item.outcome === 'streaming') item.outcome = 'interrupted'
    }
    if(data.writable)try { this.checkpoint(data) } catch { data.writable = false;data.info.error = 'Transcript index could not be saved. Existing output remains readable; new writes are disabled.' }
    return data
  }
  append(values:TranscriptInput[]):TranscriptEvent[] {
    const result:TranscriptEvent[] = [], touched = new Set<SessionData>()
    const handles = new Map<string,number>()
    let durabilityFailed=false
    try { for (const value of values) {
      const input = cleanTranscriptInput(value),data = this.load(input.sessionId)
      if (data.info.provider !== input.provider) throw Error('Transcript provider mismatch.')
      if (!data.writable) throw Error(data.info.error ?? 'Transcript storage is not writable.')
      const fingerprint = digest(JSON.stringify(input)),duplicate = data.ids.has(input.eventId)?this.find(data,event=>event.eventId===input.eventId)?.inputHash:undefined
      if (duplicate) {
        if (duplicate !== fingerprint) { data.info.error = 'Conflicting transcript event identity; output completeness is unknown.';this.checkpoint(data);throw Error(data.info.error) }
        continue
      }
      const key = transcriptItemKey(input),reduced = reduceTranscriptItem(data.items.get(key),input)
      if(input.operation==='append'&&reduced.disposition==='duplicate'&&this.find(data,event=>transcriptItemKey(event)===key&&event.operation==='append'&&event.offset===input.offset&&event.disposition==='applied')?.text!==input.text) {
        reduced.disposition='gap';reduced.state.gap=true
      }
      const event:TranscriptEvent = {...input,...(input.outcome!==undefined||input.operation==='finish'?{outcome:reduced.state.outcome}:{}),version:1,inputHash:fingerprint,sequence:data.info.events+1,timestamp:Date.now(),disposition:reduced.disposition}
      const serialized = JSON.stringify(event)
      if (Buffer.byteLength(serialized) > transcriptLimits.eventBytes) { data.info.error = 'Transcript event exceeds 1 MiB. It was rejected, not truncated; output completeness is unknown.';this.checkpoint(data);throw Error(data.info.error) }
      const bytes = Buffer.from(JSON.stringify({event,checksum:digest(serialized)})+'\n')
      let segment = data.segments.at(-1)
      if (data.freshSegment || !segment || segment.bytes + bytes.length > transcriptLimits.segmentBytes) {
        const next = Number(segment?.name.slice(7,15) ?? 0)+1
        segment = {name:`events-${String(next).padStart(8,'0')}.jsonl`,first:event.sequence,last:event.sequence-1,bytes:0}
        data.segments.push(segment);data.freshSegment = false
      }
      try {
        this.beforeWrite()
        const path=join(this.root,input.sessionId,segment.name)
        let fd=handles.get(path)
        if(fd===undefined){fd=openSync(path,'a',0o600);handles.set(path,fd)}
        let written = 0
        while (written < bytes.length) written += writeSync(fd,bytes,written,bytes.length-written)
        segment.bytes += bytes.length;segment.last = event.sequence
        data.info.bytes += bytes.length;data.info.events = event.sequence;data.info.updatedAt = event.timestamp
        if (event.kind === 'reasoning-summary') data.info.reasoning = 'published-summary'
        data.items.set(key,reduced.state);data.ids.add(input.eventId)
        this.remember(data,event)
        touched.add(data);result.push(event)
      } catch {
        data.writable = false;data.freshSegment = true;data.info.error = 'Transcript storage is not writable (disk full or I/O failure). New output is not saved. Existing files are preserved.'
        try { this.checkpoint(data) } catch { /* The error remains available in memory even when the disk is full. */ }
        throw Error(data.info.error)
      }
    } } finally {
      for(const fd of handles.values()) {try {fsyncSync(fd)} catch {durabilityFailed=true} finally {closeSync(fd)} }
      if(durabilityFailed) for(const data of touched){data.writable=false;data.info.error='Transcript durability checkpoint failed. New writes are disabled.'}
    }
    if(durabilityFailed)throw Error('Transcript durability checkpoint failed. New writes are disabled.')
    for (const data of touched) {
      try { this.checkpoint(data) } catch { data.writable = false;data.info.error = 'Transcript durability checkpoint failed. Output may not be durable; new writes are disabled.';throw Error(data.info.error) }
    }
    return result
  }
  page(id:string, before?:number):TranscriptPage {
    const data = this.load(id),end = before ?? data.info.events+1
    if (!Number.isSafeInteger(end) || end < 1) throw Error('Invalid transcript cursor.')
    const events:TranscriptEvent[] = []
    let total = 0
    for (const segment of [...data.segments].reverse()) {
      if (segment.first >= end) continue
      const candidates:TranscriptEvent[] = []
      for (const event of this.acceptedRecords(data,segment)) {
        if (event.sequence < end) { candidates.push(event);if (candidates.length > transcriptLimits.pageEvents) candidates.shift() }
      }
      for (const event of candidates.reverse()) {
        const bytes = Buffer.byteLength(JSON.stringify(event))
        if (events.length >= transcriptLimits.pageEvents || total+bytes > transcriptLimits.pageBytes) break
        total += bytes;events.unshift(event)
      }
      if (events.length >= transcriptLimits.pageEvents || total >= transcriptLimits.pageBytes-transcriptLimits.eventBytes) break
    }
    const states:Record<string,TranscriptItemState>={}
    for(const event of events){const key=transcriptItemKey(event),state=data.items.get(key);if(state)states[key]={...state,...(data.info.error?{gap:true,outcome:'unknown' as const}:{})}}
    return {info:{...data.info},events,states,before:events[0] && events[0].sequence > 1 ? events[0].sequence : null,after:end <= data.info.events ? end : null}
  }
  delete(id:string,confirmed:boolean):void {
    if (!confirmed) throw Error('Transcript deletion requires confirmation.')
    if (!transcriptId(id) || !this.sessions.has(id)) throw Error('Transcript not found.')
    // The only recursive deletion target is a validated, known child of the fixed store root.
    rmSync(join(this.root,id),{recursive:true});this.sessions.delete(id)
  }
  flush():void { for (const data of this.sessions.values()) if (data.loaded&&data.writable) this.checkpoint(data) }
  private find(data:SessionData,predicate:(event:TranscriptEvent)=>boolean):TranscriptEvent|undefined {
    // Bloom positives are always checked against exact durable records. False positives never discard output.
    for(const segment of [...data.segments].reverse()) {
      for(const event of this.acceptedRecords(data,segment))if(predicate(event))return event
    }
    return undefined
  }
  private *acceptedRecords(data:SessionData,segment:Segment):Generator<TranscriptEvent> {
    // Match replay's ownership and strictly increasing sequence, including the preceding segment boundary.
    let sequence=segment.first-1
    try {for(const line of lines(join(this.root,data.info.sessionId,segment.name))) {
      try {
        const event=decode(line)
        if(event.sessionId!==data.info.sessionId||event.provider!==data.info.provider||event.sequence<=sequence||event.sequence>segment.last)continue
        sequence=event.sequence;yield event
      } catch {/* Rejected records remain on disk, outside the readable stream. */}
    }} catch {/* Preserve interrupted tail. */}
  }
  private remember(data:SessionData,event:TranscriptEvent):void {
    data.recent.push(event);data.recentBytes+=Buffer.byteLength(JSON.stringify(event))
    while(data.recent.length>20||data.recentBytes>transcriptLimits.pageBytes)data.recentBytes-=Buffer.byteLength(JSON.stringify(data.recent.shift()))
  }
  private checkpoint(data:SessionData):void {
    const directory = join(this.root,data.info.sessionId)
    const current = data.segments.at(-1)
    if (current && existsSync(join(directory,current.name))) {
      const fd = openSync(join(directory,current.name),'r+');try { fsyncSync(fd) } finally { closeSync(fd) }
    }
    atomic(join(directory,'manifest.json'),{version:1,info:data.info,segments:data.segments,active:[...data.items.values()].some(item=>item.outcome === 'streaming')})
    // A small, disposable derived snapshot; JSONL remains the authority.
    atomic(join(directory,'snapshot.json'),{version:1,sequence:data.info.events,items:data.items.size,streaming:[...data.items.values()].filter(item=>item.outcome === 'streaming').length,recent:data.recent})
  }
}
