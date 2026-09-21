import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { transcriptLimits, type TranscriptEvent, type TranscriptInfo, type TranscriptInput, type TranscriptPage } from '../../shared/transcript'

export class TranscriptClient extends EventEmitter {
  private readonly worker:Worker
  private readonly pending = new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;bytes:number}>()
  private sequence = 0
  private pendingBytes = 0
  private closed = false
  error:string | null = null
  constructor(path:string,root:string) {
    super();this.worker = new Worker(path,{workerData:{root},stdout:true,stderr:true})
    this.worker.stdout.resume();this.worker.stderr.resume()
    this.worker.on('message',(reply:{id:number;value?:unknown;error?:string})=>{
      const pending = this.pending.get(reply.id);if (!pending) return
      this.pending.delete(reply.id);this.pendingBytes -= pending.bytes
      if (reply.error) { this.error = reply.error;pending.reject(Error(reply.error));this.emit('change') }
      else pending.resolve(reply.value)
    })
    this.worker.on('error',()=>this.fail('Transcript worker failed. New output cannot be saved.'))
    this.worker.on('exit',()=>{ if (!this.closed || this.pending.size) this.fail('Transcript worker stopped. New output cannot be saved.') })
  }
  private fail(message:string):void {
    this.error = message;this.closed = true
    for (const pending of this.pending.values()) pending.reject(Error(message))
    this.pending.clear();this.pendingBytes = 0;this.emit('change')
  }
  private request<T>(method:string,...args:unknown[]):Promise<T> {
    if (this.closed) return Promise.reject(Error(this.error ?? 'Transcript store is closed.'))
    const bytes = Buffer.byteLength(JSON.stringify(args))
    if (this.pendingBytes+bytes > transcriptLimits.pendingBytes) {
      this.error = 'Transcript write queue exceeds 8 MiB. New output was rejected, not truncated; completeness is unknown.'
      this.emit('change');return Promise.reject(Error(this.error))
    }
    const id = ++this.sequence;this.pendingBytes += bytes
    return new Promise<T>((resolve,reject)=>{ this.pending.set(id,{resolve:resolve as (value:unknown)=>void,reject,bytes});this.worker.postMessage({id,method,args}) })
  }
  async create(info:Pick<TranscriptInfo,'sessionId'|'provider'|'projectPath'|'projectName'>):Promise<TranscriptInfo> { const value = await this.request<TranscriptInfo>('create',info);this.emit('change');return value }
  async append(events:TranscriptInput[]):Promise<TranscriptEvent[]> { const value = await this.request<TranscriptEvent[]>('append',events);if (value.length) this.emit('events',value);this.emit('change');return value }
  async list():Promise<TranscriptInfo[]> { const result=await this.request<{sessions:TranscriptInfo[];error:string|null}>('list');if(result.error)this.error=result.error;return result.sessions }
  page(id:string,before?:number):Promise<TranscriptPage> { return this.request('page',id,before) }
  async delete(id:string,confirmed:boolean):Promise<void> { await this.request('delete',id,confirmed);this.emit('change') }
  async dispose():Promise<void> {
    if (this.closed) return
    try { await this.request('close') } finally { this.closed = true;await this.worker.terminate() }
  }
}
