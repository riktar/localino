/** Bounds apply before JSON parsing, including chunked responses without Content-Length. */
export async function boundedJson(response:Response,limit=2*1024*1024):Promise<unknown>{
  if(!response.body)throw Error('Empty provider response.')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[]
  let bytes=0
  try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw Error('Oversized provider response.');chunks.push(value)}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))
}

export async function readProviderEvents(response:Response,receive:(event:Record<string,unknown>)=>void):Promise<void>{
  if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('Provider event stream unavailable.')
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true})
  let pending='',data:string[]=[],bytes=0
  const line=(value:string):void=>{
    if(value===''){
      if(data.length){const event:unknown=JSON.parse(data.join('\n'));if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid provider event.');receive(event as Record<string,unknown>)}
      data=[];bytes=0
    }else if(value.startsWith('data:')){const text=value.slice(5).replace(/^ /,'');bytes+=Buffer.byteLength(text);if(bytes>2*1024*1024)throw Error('Oversized provider event.');data.push(text)}
  }
  try{for(;;){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let index:number;while((index=pending.indexOf('\n'))>=0){line(pending.slice(0,index).replace(/\r$/,''));pending=pending.slice(index+1)}if(Buffer.byteLength(pending)>2*1024*1024)throw Error('Oversized provider event line.')}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(pending||data.length)throw Error('Provider event stream was interrupted.')
}
