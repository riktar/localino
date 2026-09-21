import { parentPort, workerData } from 'node:worker_threads'
import { TranscriptStore } from './transcript-store'
import type { TranscriptInfo, TranscriptInput } from '../../shared/transcript'

const port = parentPort!
const store = new TranscriptStore(workerData.root as string)
port.on('message',(request:{id:number;method:string;args:unknown[]})=>{
  try {
    let value:unknown
    switch (request.method) {
      case 'create': value = store.create(request.args[0] as TranscriptInfo);break
      case 'append': value = store.append(request.args[0] as TranscriptInput[]);break
      case 'list': value = {sessions:store.list(),error:store.error};break
      case 'page': value = store.page(request.args[0] as string,request.args[1] as number | undefined);break
      case 'delete': value = store.delete(request.args[0] as string,request.args[1] === true);break
      case 'close': store.flush();port.postMessage({id:request.id,value:null});port.close();return
      default: throw Error('Invalid transcript operation.')
    }
    port.postMessage({id:request.id,value})
  } catch (error) { port.postMessage({id:request.id,error:error instanceof Error ? error.message : 'Transcript operation failed.'}) }
})
