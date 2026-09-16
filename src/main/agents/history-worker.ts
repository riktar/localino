import { parentPort, workerData } from 'node:worker_threads'
import { readClaude } from './claude'
import { readPi } from './pi'
import { readOpenCode } from './opencode'
import { HistoryFailure } from './history-resource'

void (async () => {
  try {
    const reader = workerData.id === 'claude' ? readClaude : workerData.id === 'pi' ? readPi : workerData.id === 'opencode' ? readOpenCode : null
    if (!reader) throw new HistoryFailure('unsupported')
    parentPort!.postMessage({ data: await reader(workerData.path, workerData.period) })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const kind = error instanceof HistoryFailure ? error.kind : code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'denied' : 'unavailable'
    parentPort!.postMessage({ error: kind })
  }
})()
