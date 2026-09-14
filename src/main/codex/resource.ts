import { EventEmitter } from 'node:events'
import type { ResourceState } from '../../shared/contracts'
import type { Connection } from './connection'
import { RpcError, type ReadMethod } from './rpc'

interface Clock { now(): number; every(callback: () => void): () => void }
const clock: Clock = { now: () => Date.now(), every: callback => { const timer = setInterval(callback,1000); return () => clearInterval(timer) } }
interface Options<T> {
  method: Exclude<ReadMethod,'account/read'>
  normalize: (value: unknown) => T
  interval: number
  staleAfter: number
  resets?: (value: T) => number[]
}

/** One request per resource, independent failures, in-memory data scoped to a connection generation. */
export class Resource<T> extends EventEmitter {
  state: ResourceState<T> = { data: null, lastSuccessAt: null, refreshing: false, stale: false, error: null }
  private epoch = 0
  private flight: Promise<void> | null = null
  private nextAttempt = Infinity
  private failures = 0
  private suspended = false
  private active = true
  private seenResets = new Set<number>()
  private cancelClock: () => void
  constructor(private connection: Connection, private options: Options<T>, private time = clock) {
    super()
    connection.on('change', this.accountChanged)
    this.cancelClock = time.every(() => this.tick())
  }
  private publish(): void { this.emit('change', this.state) }
  private accountChanged = (): void => {
    ++this.epoch; this.flight = null; this.failures = 0; this.nextAttempt = Infinity; this.seenResets.clear()
    this.state = { data: null, lastSuccessAt: null, refreshing: false, stale: false, error: null }; this.publish()
    if (this.connection.state.status === 'connected' && this.active) void this.refresh()
  }
  private isStale(): boolean {
    return this.state.data !== null && (!!this.state.error || this.state.lastSuccessAt === null || this.time.now() - this.state.lastSuccessAt >= this.options.staleAfter || (this.options.resets?.(this.state.data) ?? []).some(t => t <= this.time.now()))
  }
  private tick(): void {
    const stale = this.isStale()
    if (stale !== this.state.stale) { this.state = { ...this.state, stale }; this.publish() }
    if (this.suspended || !this.active || this.connection.state.status !== 'connected') return
    const expired = this.state.data === null ? [] : (this.options.resets?.(this.state.data) ?? []).filter(t => t <= this.time.now() && !this.seenResets.has(t))
    for (const reset of expired) this.seenResets.add(reset)
    if (expired.length || this.time.now() >= this.nextAttempt) void this.refresh()
  }
  refresh(): Promise<void> {
    if (this.flight) return this.flight
    if (this.suspended || this.connection.state.status !== 'connected') return Promise.resolve()
    const epoch = this.epoch
    this.state = { ...this.state, refreshing: true }; this.publish()
    this.flight = (async () => {
      try {
        const raw = await this.connection.read(this.options.method)
        if (epoch !== this.epoch) return
        let data: T
        try { data = this.options.normalize(raw) } catch { throw Error('invalid') }
        this.state = { data, lastSuccessAt: this.time.now(), error: null, refreshing: false, stale: false }
        this.failures = 0; this.nextAttempt = this.time.now() + this.options.interval
      } catch (error) {
        if (epoch !== this.epoch) return
        this.failures++
        this.state = { ...this.state, refreshing: false, error: error instanceof RpcError ? error.kind === 'incompatible' ? 'unsupported' : error.kind === 'timeout' ? 'timeout' : 'unavailable' : 'invalid' }
        this.nextAttempt = this.time.now() + Math.min(300_000, this.options.interval * 2 ** Math.min(this.failures - 1, 4))
      } finally {
        if (epoch === this.epoch) { this.flight = null; this.state = { ...this.state, stale: this.isStale() }; this.publish() }
      }
    })()
    return this.flight
  }
  suspend(): void { this.suspended = true }
  resume(): void { this.suspended = false; if (this.active) void this.refresh() }
  setActive(active: boolean): void {
    this.active = active
    if (active && (this.state.lastSuccessAt === null || this.time.now() - this.state.lastSuccessAt >= this.options.interval)) void this.refresh()
  }
  dispose(): void { ++this.epoch; this.cancelClock(); this.connection.off('change', this.accountChanged); this.removeAllListeners() }
}
