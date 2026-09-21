import { projectTranscriptPage, reduceTranscriptItem, transcriptItemKey, type TranscriptEvent, type TranscriptItemState, type TranscriptPage } from '../../shared/transcript'
import type { TerminalLine } from '../../shared/terminal'

const MAX_EVENTS=100,MAX_BYTES=2*1024*1024,MAX_MESSAGES=12,MAX_ASSISTANT_TEXT=4000

function chunks(text:string):string[]{
  const result:string[]=[]
  for(let start=0;start<text.length;){
    let end=Math.min(text.length,start+MAX_ASSISTANT_TEXT)
    if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--
    result.push(text.slice(start,end));start=end
  }
  return result
}

/** A bounded live window whose older chat pages are loaded explicitly. */
export class TranscriptWindow {
  private events:TranscriptEvent[]=[]
  private readonly states=new Map<string,TranscriptItemState>()
  private bytes=0
  private cursor:number|null=null
  private pageIndex=0
  private historical=false
  append(events:TranscriptEvent[]):void {if(!this.historical)this.merge(events,'newer')}
  prepend(events:TranscriptEvent[]):void {this.events=[];this.states.clear();this.bytes=0;this.cursor=null;this.historical=true;this.pageIndex=0;this.merge(events,'older')}
  replaceLatest(events:TranscriptEvent[]):void {this.events=[];this.states.clear();this.bytes=0;this.cursor=null;this.pageIndex=0;this.historical=false;this.merge(events,'newer')}
  hasEarlier():boolean {return this.pageIndex+1<this.pages('').length||(this.cursor??1)>1}
  hasLater():boolean {return this.historical||this.pageIndex>0}
  before():number|undefined {return (this.cursor??1)>1?this.cursor!:undefined}
  revealLoadedEarlier():boolean {if(this.pageIndex+1>=this.pages('').length)return false;this.pageIndex++;this.historical=true;return true}
  cacheStats():{events:number;bytes:number}{return {events:this.events.length,bytes:this.bytes}}
  lines(assistantLabel:string):TerminalLine[] {return this.pages(assistantLabel)[this.pageIndex]??[]}
  private items(){const page={events:this.events,states:Object.fromEntries(this.states)} as TranscriptPage;return projectTranscriptPage(page)}
  private pages(assistantLabel:string):TerminalLine[][] {
    const units:TerminalLine[]=[]
    for(const item of this.items()){
      if(!item.text)continue
      if(item.kind==='prompt'){units.push({label:'You',text:item.text,role:'user'});continue}
      const parts=chunks(item.text)
      for(let index=0;index<parts.length;index++)units.push({label:assistantLabel,text:`${index?'…\n':''}${parts[index]}${index<parts.length-1?'\n…':''}`,role:'assistant'})
    }
    const pages:TerminalLine[][]=[]
    let page:TerminalLine[]=[],assistantChars=0
    for(let index=units.length-1;index>=0;index--){
      const unit=units[index],size=unit.role==='assistant'?unit.text.length:0
      if(page.length&&(page.length>=MAX_MESSAGES||assistantChars+size>MAX_ASSISTANT_TEXT+4)){pages.push(page);page=[];assistantChars=0}
      page.unshift(unit);assistantChars+=size
    }
    if(page.length||!pages.length)pages.push(page)
    return pages
  }
  private merge(events:TranscriptEvent[],direction:'older'|'newer'):void {
    if(events.length&&(direction==='older'||this.cursor===null))this.cursor=Math.min(this.cursor??Number.MAX_SAFE_INTEGER,...events.map(event=>event.sequence))
    const known=new Set(this.events.map(event=>event.sequence))
    const accepted=events.filter(event=>(event.kind==='prompt'||event.kind==='assistant')&&!known.has(event.sequence))
    if(!accepted.length)return
    this.events=direction==='older'?[...accepted,...this.events]:[...this.events,...accepted]
    this.events.sort((a,b)=>a.sequence-b.sequence)
    this.bytes=this.events.reduce((total,event)=>total+Buffer.byteLength(JSON.stringify(event)),0)
    let removedThrough=0
    while(this.events.length>MAX_EVENTS||this.bytes>MAX_BYTES){
      const counts=new Map<string,number>()
      for(const event of this.events){const key=transcriptItemKey(event);counts.set(key,(counts.get(key)??0)+1)}
      const indexes=direction==='older'?[...this.events.keys()].reverse():[...this.events.keys()]
      const index=indexes.find(candidate=>(counts.get(transcriptItemKey(this.events[candidate]))??0)>1)??indexes[0]
      const [event]=this.events.splice(index,1)
      if(event){this.bytes-=Buffer.byteLength(JSON.stringify(event));if(direction==='newer')removedThrough=Math.max(removedThrough,event.sequence)}
    }
    if(removedThrough)this.cursor=Math.max(this.cursor??1,removedThrough+1)
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
