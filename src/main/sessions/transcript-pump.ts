import { transcriptLimits, type TranscriptInput } from '../../shared/transcript'
import type { TranscriptClient } from './transcript-client'

/** Batch disk/IPC work while preserving every event and its order. */
export class TranscriptPump {
  private queue:TranscriptInput[]=[]
  private bytes=0
  private timer?:NodeJS.Timeout
  private flight?:Promise<void>
  private failed=false
  constructor(private readonly store:Pick<TranscriptClient,'append'>|undefined,private readonly failure:(message:string)=>void){}
  push(events:TranscriptInput[]):void {
    if(!this.store||this.failed||!events.length)return
    const size=Buffer.byteLength(JSON.stringify(events))
    if(this.bytes+size>transcriptLimits.pendingBytes){this.fail('Transcript queue is full. Output was not silently shortened; the session was stopped.');return}
    this.bytes+=size;this.queue.push(...events)
    if(!this.timer&&!this.flight)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},34)
  }
  async flush():Promise<void> {
    if(this.timer){clearTimeout(this.timer);this.timer=undefined}
    if(this.flight)return this.flight
    if(this.failed||!this.store||!this.queue.length)return
    this.flight=(async()=>{
      while(this.queue.length&&!this.failed){
        const batch:TranscriptInput[]=[];let bytes=0
        while(this.queue.length&&batch.length<128){const next=this.queue[0],size=Buffer.byteLength(JSON.stringify(next));if(batch.length&&bytes+size>512*1024)break;bytes+=size;batch.push(this.queue.shift()!)}
        try {await this.store!.append(batch)} catch {this.fail('Transcript storage failed. New output is not saved; the session was stopped.');return}
        this.bytes=Math.max(0,this.bytes-bytes)
      }
      this.bytes=0
    })().finally(()=>{this.flight=undefined})
    return this.flight
  }
  private fail(message:string):void {this.failed=true;this.queue=[];this.bytes=0;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.failure(message)}
}
