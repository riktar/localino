import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Connection } from '../../src/main/codex/connection'
import { FilePreferences, type PreferenceStore, type Preferences } from '../../src/main/codex/preferences'
import { CliError, resolveCodex } from '../../src/main/codex/resolve'
import { CodexRpc, RpcError, type RpcClient } from '../../src/main/codex/rpc'
import { isTrustedSender } from '../../src/main/security'

const fixture = resolve('tests/fixtures/rpc-server.mjs')
const fakeResolve = async () => process.execPath
class MemoryStore implements PreferenceStore {
  value: Preferences = { enabled: false, cliPath: null }
  load() { return this.value }
  save(value: Preferences) { this.value = value }
}
class FakeClient extends EventEmitter implements RpcClient {
  stopped = false
  calls: string[] = []
  account: unknown = { type: 'chatgpt', email: 'synthetic@example.test', planType: 'unknown' }
  async start() { this.calls.push('initialize') }
  async request(method: string) { this.calls.push(method); return { account: this.account } }
  async stop() { this.stopped = true }
}

test('RPC handshake, read-only contract and orderly shutdown of a real subprocess', async () => {
  const rpc = new CodexRpc(process.execPath, [fixture])
  await rpc.start()
  assert.deepEqual(await rpc.request('account/read'), { account: { type: 'chatgpt', email: null, planType: null } })
  await assert.rejects(rpc.request('account/logout' as never), (e: RpcError) => e.kind === 'incompatible')
  await rpc.stop()
  await assert.rejects(rpc.request('account/read'))
})

test('RPC incompatible/crash/malformed responses are sanitized and disposed', async () => {
  for (const mode of ['incompatible','crash','malformed']) {
    const rpc = new CodexRpc(process.execPath, [fixture, mode], 500)
    await assert.rejects(rpc.start(), (e: Error) => !e.message.includes('sensitive'))
    await rpc.stop()
  }
})

test('default timeout is 15 seconds, stop kills a subprocess that ignores EOF', { timeout: 22_000 }, async () => {
  const rpc = new CodexRpc(process.execPath, [fixture, 'silent'])
  const start = Date.now()
  await assert.rejects(rpc.start(), (e: RpcError) => e.kind === 'timeout')
  assert.ok(Date.now() - start >= 14_900 && Date.now() - start < 18_000)
  await rpc.stop()
  const stubborn = new CodexRpc(process.execPath, [fixture, 'ignore-eof'])
  await stubborn.start()
  const stopping = Date.now()
  await stubborn.stop()
  assert.ok(Date.now() - stopping >= 1_900 && Date.now() - stopping < 4_000)
})

test('first launch does not start a client; connect remembers only preferences; disconnect never logs out', async () => {
  const store = new MemoryStore(); const clients: FakeClient[] = []
  const connection = new Connection(store, () => { const client = new FakeClient(); clients.push(client); return client }, fakeResolve)
  await connection.autoConnect(); assert.equal(clients.length, 0)
  await connection.connect(); assert.equal(connection.state.status, 'connected')
  assert.deepEqual(Object.keys(store.value).sort(), ['cliPath','enabled'])
  assert.equal(store.value.enabled, true)
  await connection.disconnect()
  assert.equal(connection.state.account, null); assert.equal(store.value.enabled, false)
  assert.equal(clients[0].stopped, true); assert.equal(clients[0].calls.includes('account/logout'), false)
})

test('null/API-key account, missing CLI and preferences failures have distinct states', async () => {
  for (const [account, expected] of [[null, 'unauthenticated'], [{ type: 'apiKey' }, 'unsupported_auth']] as const) {
    const client = new FakeClient(); client.account = account
    const connection = new Connection(new MemoryStore(), () => client, fakeResolve)
    await connection.connect(); assert.equal(connection.state.error, expected); assert.equal(client.stopped, true)
  }
  const missing = new Connection(new MemoryStore(), undefined, async () => { throw new CliError('cli_missing') })
  await missing.connect(); assert.equal(missing.state.error, 'cli_missing')
  const connection = new Connection({ load: () => ({ enabled: false, cliPath: null }), save: () => { throw Error('sensitive') } }, () => new FakeClient(), fakeResolve)
  await connection.connect(); assert.equal(connection.state.error, 'preferences'); await connection.shutdown()
})

test('new generation immediately clears identity and drops old results; account event re-reads', async () => {
  const clients: FakeClient[] = []
  let release: (() => void) | undefined
  const connection = new Connection(new MemoryStore(), () => {
    const client = new FakeClient(); clients.push(client)
    if (clients.length === 1) client.request = async () => { await new Promise<void>(r => { release = r }); return { account: { type: 'chatgpt', email: 'old@example.test' } } }
    return client
  }, fakeResolve)
  const first = connection.connect()
  await new Promise(r => setImmediate(r))
  const second = connection.connect()
  assert.equal(connection.state.account, null)
  release!(); await first; await second
  assert.equal(connection.state.account?.email, 'synthetic@example.test')
  assert.equal(clients[0].stopped, true)
  clients[1].emit('notification', 'account/updated')
  assert.equal(connection.state.account, null)
  await new Promise(r => setImmediate(r))
  assert.equal(clients.length, 3)
  clients[2].emit('failure', new Error('raw secret'))
  assert.equal(connection.state.error, 'transport'); assert.equal(connection.state.account, null)
  await connection.shutdown()
})

test('disconnect during connection cancels results and restored preferences reconnect freshly', async () => {
  const store = new MemoryStore(); store.value.enabled = true
  const connection = new Connection(store, () => new FakeClient(), fakeResolve)
  await connection.autoConnect(); assert.equal(connection.state.status, 'connected')
  const reconnect = connection.connect(); const disconnect = connection.disconnect()
  await Promise.all([reconnect,disconnect]); assert.equal(connection.state.status, 'disconnected')
})

test('account event during pending initial read invalidates that identity and serially reconnects', async () => {
  const clients: FakeClient[] = []
  let release!: () => void
  const connection = new Connection(new MemoryStore(), () => {
    const client = new FakeClient(); clients.push(client)
    if (clients.length === 1) client.request = async () => {
      await new Promise<void>(r => { release = r })
      return { account: { type: 'chatgpt', email: 'stale@example.test' } }
    }
    return client
  }, fakeResolve)
  const identities: (string | null | undefined)[] = []
  connection.on('change', state => identities.push(state.account?.email))
  const first = connection.connect()
  await new Promise(r => setImmediate(r))
  const generation = connection.generation
  clients[0].emit('notification', 'account/updated')
  assert.ok(connection.generation > generation)
  assert.equal(connection.state.account, null)
  assert.equal(clients[0].stopped, true)
  release(); await first; await new Promise(r => setImmediate(r))
  assert.equal(clients.length, 2)
  assert.equal(connection.state.account?.email, 'synthetic@example.test')
  assert.equal(identities.includes('stale@example.test'), false)
  await connection.shutdown()
})

test('preferences whitelist, corrupt file and executable discovery', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'localino-unit-'))
  const file = join(folder,'connection.json'); const store = new FilePreferences(file)
  writeFileSync(file,'broken'); assert.equal(store.load().enabled,false)
  assert.throws(()=>store.save({ enabled: true, cliPath: process.execPath }))
  assert.equal(readFileSync(file,'utf8'),'broken')
  store.recover()
  store.save({ enabled: true, cliPath: process.execPath })
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file,'utf8'))).sort(), ['cliPath','enabled'])
  assert.equal(await resolveCodex(process.execPath),process.execPath)
  await assert.rejects(resolveCodex(join(folder,'absent.exe')), (e: CliError) => e.kind === 'cli_invalid')
  await assert.rejects(resolveCodex(null,{ PATH: '' }), (e: CliError) => e.kind === 'cli_missing')
})

test('IPC sender must be a live owned webContents and its main frame', () => {
  const frame = {}; const trusted = { mainFrame: frame, isDestroyed: () => false }
  const check = isTrustedSender as unknown as (s: unknown,f: unknown,a: unknown[]) => boolean
  assert.equal(check(trusted,frame,[trusted]),true)
  assert.equal(check(trusted,{},[trusted]),false)
  assert.equal(check({},frame,[trusted]),false)
  assert.equal(check({ ...trusted,isDestroyed:()=>true },frame,[]),false)
})
