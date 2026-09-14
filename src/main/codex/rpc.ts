import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

export class RpcError extends Error {
  constructor(public readonly kind: 'timeout' | 'transport' | 'incompatible', public readonly rpcCode?: number) {
    super(kind)
  }
}

export type ReadMethod = 'account/read' | 'account/rateLimits/read' | 'account/usage/read'
type RpcMethod = 'initialize' | ReadMethod
export interface RpcClient {
  start(): Promise<void>
  request(method: ReadMethod, params?: object): Promise<unknown>
  stop(): Promise<void>
  on(event: 'notification' | 'failure', listener: (...args: unknown[]) => void): this
}

export class CodexRpc extends EventEmitter implements RpcClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private buffer = ''
  private stopping = false
  private stopPromise: Promise<void> | null = null
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(private executable: string, private args = ['app-server'], private timeoutMs = 15_000) { super() }

  async start(): Promise<void> {
    if (this.child || this.stopping) throw new RpcError('transport')
    const child = spawn(this.executable, this.args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stderr.resume() // Raw diagnostics may contain account data. Never forward or persist them.
    child.stdin.on('error', () => this.fail(new RpcError('transport')))
    child.on('error', () => this.fail(new RpcError('transport')))
    child.on('exit', () => this.fail(new RpcError('transport')))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    await this.send('initialize', { clientInfo: { name: 'localino', title: 'Localino', version: '0.1.0' } })
    if (this.stopping || child.exitCode !== null) throw new RpcError('transport')
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
  }

  request(method: ReadMethod, params: object = {}): Promise<unknown> {
    return this.send(method, params)
  }

  private send(method: RpcMethod, params: object): Promise<unknown> {
    if (!['initialize', 'account/read', 'account/rateLimits/read', 'account/usage/read'].includes(method)) return Promise.reject(new RpcError('incompatible'))
    const child = this.child
    if (!child || this.stopping || child.exitCode !== null || child.signalCode !== null) return Promise.reject(new RpcError('transport'))
    return new Promise((resolve, reject) => {
      const id = this.sequence++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcError('timeout'))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) this.fail(new RpcError('transport'))
      })
    })
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 8 * 1024 * 1024) { this.fail(new RpcError('incompatible')); void this.stop(); return }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      let message: Record<string, unknown>
      try { message = JSON.parse(line) } catch { this.fail(new RpcError('incompatible')); void this.stop(); return }
      if (!message || typeof message !== 'object') continue
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id)!
        this.pending.delete(message.id)
        clearTimeout(waiter.timer)
        if (message.error) {
          const code = (message.error as { code?: number }).code
          waiter.reject(new RpcError(code === -32601 ? 'incompatible' : 'transport', code))
        } else if ('result' in message) waiter.resolve(message.result)
        else waiter.reject(new RpcError('incompatible'))
      } else if (!('id' in message) && (message.method === 'account/updated' || message.method === 'account/rateLimits/updated')) {
        this.emit('notification', message.method)
      }
    }
  }

  private fail(error: RpcError): void {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error) }
    this.pending.clear()
    if (!this.stopping) this.emit('failure', error)
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    this.fail(new RpcError('transport'))
    const child = this.child
    this.stopPromise = new Promise(resolve => {
      if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) { resolve(); return }
      const timer = setTimeout(() => child.kill(), 2_000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.stdin.end()
    })
    return this.stopPromise
  }
}
