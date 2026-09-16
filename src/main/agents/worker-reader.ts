import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { LocalAgentId } from '../../shared/agents'
import { HistoryFailure, type HistoryReader } from './history-resource'

export function workerReader(id: LocalAgentId): HistoryReader {
  return (path, period, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new HistoryFailure('timeout')); return }
    const worker = new Worker(join(__dirname, 'history-worker.js'), { workerData: { id, path, period } })
    let settled = false
    const finish = () => { settled = true; signal.removeEventListener('abort', abort); void worker.terminate() }
    const abort = () => { if (!settled) { finish(); reject(new HistoryFailure('timeout')) } }
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', result => { if (!settled) { finish(); if (result.error) reject(new HistoryFailure(result.error)); else resolve(result.data) } })
    worker.once('error', () => { if (!settled) { finish(); reject(new HistoryFailure('unavailable')) } })
    worker.once('exit', () => { if (!settled) { finish(); reject(new HistoryFailure('unavailable')) } })
  })
}
