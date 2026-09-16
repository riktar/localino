import { readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export async function openCodeSource(dataDir:string, configured=process.env.OPENCODE_DB):Promise<string> {
  if(configured) {
    if(configured===':memory:')throw Error('OpenCode usa un database in memoria: seleziona un archivio salvato.')
    return isAbsolute(configured)?configured:join(dataDir,configured)
  }
  let candidates:string[]=[]
  try { candidates=(await readdir(dataDir,{withFileTypes:true})).filter(entry=>entry.isFile()&&/\.db$/i.test(entry.name)).map(entry=>entry.name) }
  catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Cartella OpenCode non accessibile: seleziona il database.')}
  if(candidates.length>1)throw Error('Sono presenti più database OpenCode. Seleziona esplicitamente quello da leggere.')
  return join(dataDir,candidates[0]??'opencode.db')
}
