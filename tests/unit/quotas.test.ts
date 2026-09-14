import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Connection } from '../../src/main/codex/connection'
import { Resource } from '../../src/main/codex/resource'
import { RpcError } from '../../src/main/codex/rpc'
import { countdown, durationLabel, normalizeQuotas, quotaResets, quotaSummary } from '../../src/shared/quotas'

const settle = () => new Promise<void>(r => setImmediate(r))
class Clock {
  value = 1_800_000_000_000
  callback = () => {}
  now = () => this.value
  every = (callback: () => void) => { this.callback = callback; return () => { this.callback = () => {} } }
  async advance(ms: number) { this.value += ms; this.callback(); await settle() }
}
class Source extends EventEmitter {
  state = {status:'disconnected'}
  calls = 0
  result: unknown = { rateLimits: { primary: { usedPercent: 12 } } }
  fetch = async (): Promise<unknown> => this.result
  read = () => { this.calls++; return this.fetch() }
  connect() { this.state.status='connected'; this.emit('change') }
  disconnect() { this.state.status='disconnected'; this.emit('change') }
}
function setup() {
  const source = new Source(); const clock = new Clock()
  const resource = new Resource(source as unknown as Connection,{method:'account/rateLimits/read',normalize:normalizeQuotas,interval:60_000,staleAfter:180_000,resets:quotaResets},clock)
  return {source,clock,resource}
}

test('dynamic map wins over legacy, null windows omitted and labels fall back to IDs', () => {
  const q=normalizeQuotas({rateLimits:{primary:{usedPercent:99}},rateLimitsByLimitId:{unknown:{limitName:null,primary:null,secondary:null},codex:{limitName:'Codex',primary:{usedPercent:0,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:120,windowDurationMins:10080}}}})
  assert.equal(q.buckets.length,2)
  assert.equal(q.buckets[1].name,'unknown'); assert.equal(q.buckets[1].windows.length,0)
  assert.deepEqual(q.buckets[0].windows.map(w=>w.usedPercent),[0,120])
  assert.equal(q.buckets[0].windows[0].resetsAt,1800000000000)
  assert.equal(normalizeQuotas({rateLimits:{primary:{usedPercent:20}},rateLimitsByLimitId:{}}).buckets.length,0)
})
test('invalid values remain missing instead of zero, legacy and duration/reset formatting', () => {
  for(const invalid of [null,undefined,-1,'0',Infinity,NaN]) {
    const window=normalizeQuotas({rateLimits:{primary:{usedPercent:invalid,windowDurationMins:invalid,resetsAt:invalid}}}).buckets[0].windows[0]
    assert.equal(window.usedPercent,null); assert.equal(window.durationMins,null); assert.equal(window.resetsAt,null)
  }
  assert.throws(()=>normalizeQuotas({unexpected:true}))
  assert.equal(durationLabel(300),'5 ore'); assert.equal(durationLabel(10080),'7 giorni')
  assert.equal(countdown(0,1),'Reset da verificare'); assert.equal(countdown(60000,0),'tra 1 min')
  assert.equal(countdown(3600000,0),'tra 1 h 0 min')
})
test('60s polling, coalesced refresh, suspend/resume, disconnect and stale response isolation', async () => {
  const {source,clock,resource}=setup()
  await clock.advance(60000); assert.equal(source.calls,0)
  source.connect(); await settle(); assert.equal(source.calls,1)
  await clock.advance(59999); assert.equal(source.calls,1)
  await clock.advance(1); assert.equal(source.calls,2)
  let release!: (value:unknown)=>void
  source.fetch=()=>new Promise(r=>{release=r})
  const first=resource.refresh(); const second=resource.refresh()
  assert.equal(first,second); assert.equal(source.calls,3)
  resource.suspend(); await clock.advance(240000); assert.equal(source.calls,3); assert.equal(resource.state.stale,true)
  release(source.result); await first
  resource.resume(); assert.equal(source.calls,4)
  source.disconnect(); assert.equal(resource.state.data,null)
  release(source.result); await settle(); assert.equal(resource.state.data,null)
  await clock.advance(600000); assert.equal(source.calls,4)
  resource.dispose()
})

test('malformed containers never create a false success or discard the last valid snapshot', async () => {
  for (const bad of [{rateLimitsByLimitId:'malformed'},{rateLimits:3},{rateLimitsByLimitId:{codex:null}},{rateLimitsByLimitId:null}]) {
    const {source,resource}=setup()
    source.result=bad; source.connect(); await settle()
    assert.equal(resource.state.error,'invalid'); assert.equal(resource.state.lastSuccessAt,null); assert.equal(resource.state.data,null)
    source.result={rateLimits:{primary:{usedPercent:20}}}; await resource.refresh()
    const snapshot=resource.state.data; const timestamp=resource.state.lastSuccessAt
    source.result=bad; await resource.refresh()
    assert.equal(resource.state.error,'invalid'); assert.equal(resource.state.stale,true)
    assert.equal(resource.state.data,snapshot); assert.equal(resource.state.lastSuccessAt,timestamp)
    resource.dispose()
  }
})
test('failure preserves timestamp and data, backoff caps at 5min, manual retry resets schedule', async () => {
  const {source,clock,resource}=setup()
  source.connect(); await settle(); const timestamp=resource.state.lastSuccessAt
  source.fetch=async()=>{throw new RpcError('transport')}
  await resource.refresh(); assert.equal(resource.state.stale,true); assert.equal(resource.state.lastSuccessAt,timestamp)
  let previous=source.calls
  for(const delay of [60000,120000,240000,300000,300000]) {
    await clock.advance(delay-1); assert.equal(source.calls,previous)
    await clock.advance(1); assert.equal(source.calls,++previous)
  }
  source.fetch=async()=>source.result; await resource.refresh()
  assert.equal(resource.state.error,null); assert.equal(resource.state.stale,false)
  previous=source.calls; await clock.advance(60000); assert.equal(source.calls,previous+1)
  resource.dispose()
})
test('reset triggers one reread and expired service value stays stale without inferred zero', async () => {
  const {source,clock,resource}=setup()
  source.result={rateLimits:{primary:{usedPercent:95,resetsAt:(clock.now()+10000)/1000}}}
  source.connect(); await settle(); await clock.advance(10000)
  assert.equal(source.calls,2); assert.equal(resource.state.stale,true)
  assert.equal(resource.state.data?.buckets[0].windows[0].usedPercent,95)
  await clock.advance(1000); assert.equal(source.calls,2)
  resource.dispose()
})
test('resources have independent error and request state; full read replaces partial event data', async () => {
  const {source,clock,resource}=setup()
  const other=new Resource(source as unknown as Connection,{method:'account/usage/read',normalize:()=>{throw Error('invalid')},interval:300000,staleAfter:300000},{now:clock.now,every:()=>()=>{}})
  source.connect(); await settle()
  assert.equal(resource.state.error,null); assert.equal(other.state.error,'invalid')
  source.result={rateLimitsByLimitId:{other:{primary:{usedPercent:20}},codex:{primary:null,secondary:null}}}
  await resource.refresh()
  assert.equal(resource.state.data?.buckets.length,2)
  assert.equal(resource.state.data?.buckets[0].windows.length,0)
  assert.match(quotaSummary(resource.state),/^codex: finestre non disponibili/)
  resource.dispose(); other.dispose()
})
