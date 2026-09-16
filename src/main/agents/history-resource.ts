import { EventEmitter } from 'node:events'
import type { AgentPeriod, AgentSource, HistoryData, HistoryError, HistoryState, LocalAgentId } from '../../shared/agents'

export class HistoryFailure extends Error { constructor(public kind: HistoryError) { super(kind) } }
export type HistoryReader = (path: string, period: AgentPeriod, signal: AbortSignal) => Promise<HistoryData>
interface Clock { now(): number; every(callback: () => void): () => void }
const clock: Clock = { now: () => Date.now(), every: fn => { const timer = setInterval(fn, 1000); return () => clearInterval(timer) } }

/** Each adapter has one independently cancellable resource. No source reads before opt-in. */
export class HistoryResource extends EventEmitter {
  state: HistoryState
  private active = false
  private suspended = false
  private epoch = 0
  private controller: AbortController | null = null
  private flight: Promise<void> | null = null
  private due = Infinity
  private stopClock: () => void
  constructor(id: LocalAgentId, private read: HistoryReader, private time = clock) {
    super()
    this.state = { agent: id, enabled: false, source: null, period: '7', data: null, lastAttemptAt: null, lastSuccessAt: null, refreshing: false, stale: false, error: null }
    this.stopClock = time.every(() => this.tick())
  }
  private publish(): void { this.emit('change', this.state) }
  private cancel(): void { ++this.epoch; this.controller?.abort(); this.controller = null; this.flight = null }
  configure(source: AgentSource): void {
    this.cancel()
    this.state = { ...this.state, enabled: source.enabled, source: source.path, data: null, lastAttemptAt: null, lastSuccessAt: null, refreshing: false, stale: false, error: null }
    this.due = 0; this.publish()
    if (source.enabled) void this.refresh()
  }
  period(period: AgentPeriod): void {
    if (period === this.state.period) return
    this.cancel()
    this.state = { ...this.state, period, data: null, lastAttemptAt: null, lastSuccessAt: null, refreshing: false, stale: false, error: null }
    this.publish(); void this.refresh()
  }
  setActive(active: boolean): void {
    const opening = active && !this.active
    this.active = active
    if (!active && this.flight) { this.cancel(); this.state = { ...this.state, refreshing: false, stale: !!this.state.data }; this.publish() }
    if (opening && this.state.enabled) { this.state = { ...this.state, stale: !!this.state.data }; this.publish(); void this.refresh() }
  }
  private tick(): void {
    const stale = !!this.state.data && (!!this.state.error || (this.active && this.time.now() - (this.state.lastSuccessAt ?? 0) >= 120_000) || this.state.stale)
    if (stale !== this.state.stale) { this.state = { ...this.state, stale }; this.publish() }
    if (this.active && !this.suspended && this.state.enabled && this.time.now() >= this.due) void this.refresh()
  }
  refresh(): Promise<void> {
    if (this.flight) return this.flight
    if (!this.state.enabled || this.suspended) return Promise.resolve()
    const epoch = this.epoch
    const controller = new AbortController(); this.controller = controller
    this.state = { ...this.state, refreshing: true, lastAttemptAt: this.time.now() }; this.publish()
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new HistoryFailure('timeout')) }, 15_000) })
    const { source, period } = this.state
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new HistoryFailure('timeout')), { once: true }))
    const work = source ? Promise.resolve().then(() => this.read(source, period, controller.signal)) : Promise.reject(new HistoryFailure('missing'))
    this.flight = Promise.race([work, timeout, cancelled]).then(data => {
      if (epoch !== this.epoch) return
      this.state = { ...this.state, data, lastSuccessAt: this.time.now(), error: null, stale: false }
    }).catch(error => {
      if (epoch !== this.epoch) return
      this.state = { ...this.state, error: error instanceof HistoryFailure ? error.kind : 'unavailable', stale: !!this.state.data }
    }).finally(() => {
      clearTimeout(timer)
      if (epoch !== this.epoch) return
      this.flight = null; this.controller = null; this.due = this.time.now() + 60_000
      this.state = { ...this.state, refreshing: false }; this.publish()
    })
    return this.flight
  }
  suspend(): void { this.suspended = true; this.cancel(); this.state = { ...this.state, refreshing: false, stale: !!this.state.data }; this.publish() }
  resume(): void { this.suspended = false; if (this.active) void this.refresh() }
  dispose(): void { this.cancel(); this.stopClock(); this.removeAllListeners() }
}
