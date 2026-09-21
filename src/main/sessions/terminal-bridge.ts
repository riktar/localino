import { Worker } from 'node:worker_threads'
import type { TerminalFrame, TerminalLine, TerminalViewport } from '../../shared/terminal'
import type { InkRequest } from './ink-worker'

interface Subscription { owner: number; viewport: TerminalViewport; send: (frame: TerminalFrame) => void; pending?: TerminalLine[] }

/** Main owns subscriptions and the data source. Renderer messages never supply output. */
export class TerminalBridge {
  private worker?: Worker
  private readonly views = new Map<string, Subscription>()
  private timer?: NodeJS.Timeout
  constructor(private readonly workerPath: string) {}
  open(owner: number, viewport: TerminalViewport, lines: TerminalLine[], send: Subscription['send']): void {
    const previous = this.views.get(viewport.viewId)
    if (previous && (previous.owner !== owner || previous.viewport.sessionId !== viewport.sessionId)) throw Error('Invalid terminal owner')
    if (!previous && [...this.views.values()].filter(view => view.owner === owner).length >= 3) throw Error('Too many terminal views')
    this.views.set(viewport.viewId, { owner, viewport, send })
    this.post({ type: 'open', viewport, lines })
  }
  update(sessionId: string, lines: TerminalLine[]): void {
    for (const view of this.views.values()) if (view.viewport.sessionId === sessionId) view.pending = lines
    if (!this.timer && [...this.views.values()].some(view => view.pending)) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        for (const view of this.views.values()) if (view.pending) {
          this.post({ type: 'update', viewport: view.viewport, lines: view.pending }); view.pending = undefined
        }
      }, 34)
    }
  }
  close(owner: number, viewId: string): void {
    const view = this.views.get(viewId)
    if (!view) return
    if (view.owner !== owner) throw Error('Invalid terminal owner')
    this.views.delete(viewId); this.worker?.postMessage({ type: 'close', viewId } satisfies InkRequest)
    if (!this.views.size) void this.dispose()
  }
  closeOwner(owner: number): void { for (const [id, view] of this.views) if (view.owner === owner) this.close(owner, id) }
  private post(request: InkRequest): void {
    if (!this.worker) {
      const worker = new Worker(this.workerPath, { stdout: true, stderr: true })
      this.worker = worker
      // Capture unexpected library output without copying provider data to application logs.
      worker.stdout.resume(); worker.stderr.resume()
      worker.on('message', (frame: TerminalFrame) => {
        if (this.worker !== worker) return
        const view = this.views.get(frame.viewId)
        if (view?.viewport.sessionId === frame.sessionId) view.send(frame)
      })
      worker.on('error', () => {
        if (this.worker !== worker) return
        for (const view of this.views.values()) view.send({ ...view.viewport, sequence: 0, data: '', error: 'Terminal renderer failed. Reopen this session.' })
        this.worker = undefined; this.views.clear()
      })
    }
    this.worker.postMessage(request)
  }
  async dispose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined; this.views.clear()
    const worker = this.worker; this.worker = undefined
    if (!worker) return
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { void worker.terminate().then(() => resolve()) }, 1500)
      worker.once('exit', () => { clearTimeout(timeout); resolve() })
      worker.postMessage({ type: 'dispose' } satisfies InkRequest)
    })
  }
}
