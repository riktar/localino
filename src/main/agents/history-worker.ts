import { parentPort, workerData } from 'node:worker_threads'
import { readClaude } from './claude'
import { HistoryFailure } from './history-resource'

void (async () => {
  try {
    if (workerData.id !== 'claude') throw new HistoryFailure('unsupported')
    parentPort!.postMessage({ data: await readClaude(workerData.path, workerData.period) })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const kind = error instanceof HistoryFailure ? error.kind : code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'denied' : 'unavailable'
    parentPort!.postMessage({ error: kind })
  }
})()
