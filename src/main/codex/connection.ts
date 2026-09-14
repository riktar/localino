import { EventEmitter } from 'node:events'
import type { Account, ConnectionState } from '../../shared/contracts'
import type { PreferenceStore } from './preferences'
import { CliError, resolveCodex } from './resolve'
import { CodexRpc, RpcError, type ReadMethod, type RpcClient } from './rpc'

export class Connection extends EventEmitter {
  state: ConnectionState = { status: 'disconnected', account: null, error: null }
  generation = 0
  private client: RpcClient | null = null
  private queue: Promise<void> = Promise.resolve()
  private cliPath: string | null
  private factory: (path: string) => RpcClient

  constructor(private store: PreferenceStore, factory = (path: string): RpcClient => new CodexRpc(path), private resolve = resolveCodex) {
    super()
    this.cliPath = store.load().cliPath
    this.factory = factory
  }

  autoConnect(): Promise<void> { return this.store.load().enabled ? this.connect() : Promise.resolve() }

  private update(state: ConnectionState): void { this.state = state; this.emit('change', state) }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(operation, operation)
    return this.queue
  }

  connect(path?: string): Promise<void> {
    const generation = ++this.generation
    if (path !== undefined) this.cliPath = path
    this.update({ status: 'connecting', account: null, error: null })
    // Cancel pending requests immediately; new processes are still created serially.
    const stop = this.client?.stop() ?? Promise.resolve()
    return this.enqueue(async () => {
      await stop
      if (generation !== this.generation) return
      await this.client?.stop()
      this.client = null
      try {
        const executable = await this.resolve(this.cliPath)
        if (generation !== this.generation) return
        this.cliPath = executable
        const client = this.factory(executable)
        this.client = client
        client.on('failure', () => {
          if (generation === this.generation && this.state.status === 'connected') {
            this.update({ status: 'error', account: null, error: 'transport' })
            void client.stop()
          }
        })
        client.on('notification', method => {
          if (generation !== this.generation) return
          if (method === 'account/updated' && this.state.status === 'connected') void this.connect()
          else if (method === 'account/rateLimits/updated') this.emit('ratesChanged')
        })
        await client.start()
        const result = await client.request('account/read', { refreshToken: false }) as { account?: { type?: unknown; email?: unknown; planType?: unknown } } | null
        if (generation !== this.generation) return
        if (!result || !('account' in result)) throw new RpcError('incompatible')
        if (!result.account) { this.update({ status: 'error', account: null, error: 'unauthenticated' }); await client.stop(); return }
        if (result.account.type !== 'chatgpt') { this.update({ status: 'error', account: null, error: 'unsupported_auth' }); await client.stop(); return }
        const account: Account = {
          email: typeof result.account.email === 'string' ? result.account.email.slice(0, 320) : null,
          plan: typeof result.account.planType === 'string' ? result.account.planType.slice(0, 80) : null,
        }
        try { this.store.save({ enabled: true, cliPath: executable }) } catch {
          this.update({ status: 'error', account: null, error: 'preferences' }); await client.stop(); return
        }
        this.update({ status: 'connected', account, error: null })
      } catch (error) {
        if (generation === this.generation) this.update({ status: 'error', account: null, error: error instanceof CliError || error instanceof RpcError ? error.kind : 'transport' })
        await this.client?.stop()
      }
    })
  }

  disconnect(): Promise<void> {
    ++this.generation
    this.update({ status: 'disconnected', account: null, error: null })
    this.cliPath = null
    try { this.store.save({ enabled: false, cliPath: null }) } catch { this.update({ status: 'error', account: null, error: 'preferences' }) }
    const stop = this.client?.stop() ?? Promise.resolve()
    return this.enqueue(async () => { await stop; await this.client?.stop(); this.client = null })
  }

  async shutdown(): Promise<void> {
    ++this.generation
    this.update({ status: 'disconnected', account: null, error: null })
    await this.client?.stop()
    await this.queue
  }

  read(method: Exclude<ReadMethod, 'account/read'>): Promise<unknown> {
    if (this.state.status !== 'connected' || !this.client) return Promise.reject(new RpcError('transport'))
    return this.client.request(method)
  }
}
