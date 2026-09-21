import { projectTranscriptPage, reduceTranscriptItem, transcriptItemKey, type TranscriptEvent, type TranscriptItemState, type TranscriptPage } from '../../shared/transcript'
import type { TerminalLine } from '../../shared/terminal'

/** A bounded live window that can be expanded backwards explicitly by the user. */
export class TranscriptWindow {
  private events:TranscriptEvent[]=[]
  private readonly states=new Map<string,TranscriptItemState>()
  private bytes=0
  private expanded=false
  private cursor:number|null=null
  private visibleMessages=12
  append(events:TranscriptEvent[]):void { this.merge(events,false) }
  prepend(events:TranscriptEvent[]):void { this.expanded=true;this.merge(events,true) }
  hasEarlier():boolean { return this.cursor!==null&&this.cursor>1||this.items().length>this.visibleMessages }
  before():number|undefined { return this.hasEarlier()?this.cursor!:undefined }
  revealLoadedEarlier():boolean {const count=this.items().length;if(count<=this.visibleMessages)return false;this.visibleMessages=Math.min(count,this.visibleMessages+12);return true}
  lines(assistantLabel:string):TerminalLine[] {
    const items=this.items().slice(-this.visibleMessages),assistants=Math.max(1,items.filter(item=>item.kind==='assistant').length),assistantLimit=Math.max(1,Math.floor(4000/assistants))
    return items.flatMap(item=>{
      if(!item.text)return []
      const text=item.kind==='assistant'&&item.text.length>assistantLimit?`…\n${item.text.slice(-assistantLimit)}`:item.text
      return [{label:item.kind==='prompt'?'You':assistantLabel,text,role:item.kind==='prompt'?'user' as const:'assistant' as const}]
    })
  }
  private items(){const page={events:this.events,states:Object.fromEntries(this.states)} as TranscriptPage;return projectTranscriptPage(page)}
  private merge(events:TranscriptEvent[],older:boolean):void {
    if(events.length)this.cursor=Math.min(this.cursor??Number.MAX_SAFE_INTEGER,...events.map(event=>event.sequence))
    const known=new Set(this.events.map(event=>event.sequence))
    const accepted=events.filter(event=>(event.kind==='prompt'||event.kind==='assistant')&&!known.has(event.sequence))
    if(!accepted.length)return
    this.events=older?[...accepted,...this.events]:[...this.events,...accepted]
    this.events.sort((a,b)=>a.sequence-b.sequence)
    this.bytes=this.events.reduce((total,event)=>total+Buffer.byteLength(JSON.stringify(event)),0)
    if(!this.expanded)while(this.events.length>100||this.bytes>2*1024*1024){const event=this.events.shift();if(event)this.bytes-=Buffer.byteLength(JSON.stringify(event))}
    if(!this.expanded&&this.events[0])this.cursor=this.events[0].sequence
    this.rebuild()
  }
  private rebuild():void {
    this.states.clear()
    for(const event of this.events){
      const key=transcriptItemKey(event),previous=this.states.get(key)??(event.operation==='append'?{length:event.offset??0,outcome:'streaming' as const,gap:false,kind:event.kind}:undefined)
      const state=reduceTranscriptItem(previous,event).state
      this.states.set(key,event.disposition==='gap'?{...state,gap:true,outcome:'unknown'}:state)
    }
  }
}
