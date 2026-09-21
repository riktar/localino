import { projectTranscriptPage, reduceTranscriptItem, transcriptItemKey, type TranscriptEvent, type TranscriptItemState, type TranscriptPage } from '../../shared/transcript'
import type { TerminalLine } from '../../shared/terminal'

export class TranscriptWindow {
  private events:TranscriptEvent[]=[]
  private readonly states=new Map<string,TranscriptItemState>()
  private bytes=0
  private sequence=0
  append(events:TranscriptEvent[]):void {
    for(const event of events){
      if(event.sequence<=this.sequence)continue
      this.sequence=event.sequence
      const key=transcriptItemKey(event),previous=this.states.get(key)??(event.operation==='append'?{length:event.offset??0,outcome:'streaming' as const,gap:false,kind:event.kind}:undefined)
      const state=reduceTranscriptItem(previous,event).state
      this.states.set(key,event.disposition==='gap'?{...state,gap:true,outcome:'unknown'}:state)
      this.events.push(event);this.bytes+=Buffer.byteLength(JSON.stringify(event))
      while(this.events.length>100||this.bytes>2*1024*1024)this.bytes-=Buffer.byteLength(JSON.stringify(this.events.shift()))
    }
    const retained=new Set(this.events.map(transcriptItemKey))
    for(const key of this.states.keys())if(!retained.has(key))this.states.delete(key)
  }
  lines():TerminalLine[] {
    const page={events:this.events,states:Object.fromEntries(this.states)} as TranscriptPage
    const items=projectTranscriptPage(page),lines:TerminalLine[]=[]
    if(this.events[0]?.sequence>1)lines.push({label:'History',text:'Recent output. Earlier events remain in Saved transcripts.'})
    const limit=Math.floor(8000/Math.max(1,Math.min(12,items.length)))
    for(const item of items.slice(-12)){
      const truncated=item.text.length>limit
      let start=Math.max(0,item.text.length-limit)
      if(start&&item.text.charCodeAt(start)>=0xdc00&&item.text.charCodeAt(start)<=0xdfff)start++
      lines.push({label:`${item.label}${item.phase?` · ${item.phase}`:''} · ${item.outcome}${item.gap?' · gap':''}`,text:`${item.continued||truncated?'[Earlier text in Saved transcripts]\n':''}${item.text.slice(start)}`})
    }
    return lines
  }
}
