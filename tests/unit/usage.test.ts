import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { normalizeUsage,usagePeriod,localDate,validDate,durationSeconds } from '../../src/shared/usage'
import { normalizeQuotas } from '../../src/shared/quotas'
import { Resource } from '../../src/main/codex/resource'
import type { Connection } from '../../src/main/codex/connection'
import { RpcError } from '../../src/main/codex/rpc'

test('sparse days, explicit zero, periods and summary are kept distinct',()=>{
  const usage=normalizeUsage({summary:{lifetimeTokens:1000,currentStreakDays:0},dailyUsageBuckets:[{startDate:'2026-01-01',tokens:10},{startDate:'2026-01-03',tokens:0},{startDate:'2026-01-07',tokens:20}]})
  const week=usagePeriod(usage,'7','2026-01-07')
  assert.equal(week.total,30);assert.equal(week.mean,10);assert.equal(week.peak?.tokens,20)
  assert.equal(week.covered,3);assert.equal(week.expected,7);assert.equal(week.partial,true)
  assert.deepEqual(week.rows.filter(r=>r.tokens===null).map(r=>[r.date,r.endDate]),[['2026-01-02','2026-01-02'],['2026-01-04','2026-01-06']])
  assert.equal(usage.summary.lifetimeTokens,1000);assert.equal(usage.summary.currentStreakDays,0);assert.equal(usage.summary.peakDailyTokens,null)
  assert.equal(usagePeriod(usage,'30','2026-01-07').start,'2025-12-09')
  assert.equal(usagePeriod(usage,'all').expected,7)
  const absent=usagePeriod(usage,'7','2026-03-01');assert.equal(absent.total,null);assert.equal(absent.mean,null);assert.equal(absent.peak,null)
})
test('duplicates are counted once, conflicting or invalid dates/tokens excluded',()=>{
  const usage=normalizeUsage({summary:{lifetimeTokens:900},dailyUsageBuckets:[
    {startDate:'2026-01-03',tokens:20},{startDate:'2026-01-01',tokens:10},{startDate:'2026-01-01',tokens:10},
    {startDate:'2026-01-03',tokens:21},{startDate:'2026-01-04',tokens:-2},{startDate:'2026-01-04',tokens:3},
    {startDate:'2026-02-30',tokens:4},{startDate:'2026-01-06',tokens:Number.MAX_SAFE_INTEGER+1},
  ]})
  assert.deepEqual(usage.days,[{date:'2026-01-01',tokens:10}]);assert.equal(usage.issues,4)
  assert.equal(usagePeriod(usage,'all').expected,6);assert.equal(usagePeriod(usage,'all').partial,true)
  assert.equal(usage.summary.lifetimeTokens,900)
  for(const date of ['2026-02-29','2026-00-01','2026-01-01T00:00Z','x'])assert.equal(validDate(date),false)
  assert.equal(validDate('2024-02-29'),true)
  assert.throws(()=>normalizeUsage({summary:null}))
})
test('empty series, numeric overflow and exact duration are explicit',()=>{
  const empty=normalizeUsage({summary:{},dailyUsageBuckets:null})
  assert.equal(usagePeriod(empty,'all').expected,0);assert.equal(usagePeriod(empty,'all').total,null)
  const large=normalizeUsage({summary:{},dailyUsageBuckets:[{startDate:'2026-01-01',tokens:Number.MAX_SAFE_INTEGER},{startDate:'2026-01-02',tokens:1}]})
  assert.equal(usagePeriod(large,'all').overflow,true);assert.equal(usagePeriod(large,'all').total,null)
  assert.equal(durationSeconds(90061),'1 g 1 h 1 min 1 s');assert.equal(durationSeconds(0),'0 s')
  assert.equal(localDate(new Date(2026,0,1,23,59)),'2026-01-01')
})
test('credit balances have no invented currency and zero reset count is retained',()=>{
  const q=normalizeQuotas({rateLimits:{credits:{hasCredits:true,unlimited:true,balance:'12.34'}},rateLimitResetCredits:{availableCount:0,credits:null}})
  assert.equal(q.availableResets,0);assert.deepEqual(q.buckets[0].credits,{hasCredits:true,unlimited:true,balance:'12.34'})
})
test('usage polls only when visible, resumes stale, coalesces and clears on account change independently',async()=>{
  let now=1000000;let tick=()=>{};let calls=0
  const source=new EventEmitter() as EventEmitter & {state:{status:string};read:()=>Promise<unknown>}
  source.state={status:'disconnected'};source.read=async()=>{calls++;return {summary:{lifetimeTokens:100},dailyUsageBuckets:[]}}
  const resource=new Resource(source as unknown as Connection,{method:'account/usage/read',normalize:normalizeUsage,interval:300000,staleAfter:300000},{now:()=>now,every:cb=>{tick=cb;return()=>{}}})
  resource.setActive(false);source.state.status='connected';source.emit('change');assert.equal(calls,0)
  resource.setActive(true);await new Promise(r=>setImmediate(r));assert.equal(calls,1)
  resource.setActive(false);now+=300000;tick();assert.equal(calls,1)
  resource.setActive(true);await new Promise(r=>setImmediate(r));assert.equal(calls,2)
  resource.setActive(false);resource.setActive(true);assert.equal(calls,2)
  now+=300000;tick();await new Promise(r=>setImmediate(r));assert.equal(calls,3)
  source.read=async()=>{throw new RpcError('incompatible',-32601)}
  await resource.refresh();assert.equal(resource.state.error,'unsupported');assert.equal(resource.state.stale,true)
  let release!:(v:unknown)=>void;source.read=()=>new Promise(r=>{release=r})
  const request=resource.refresh();assert.equal(resource.refresh(),request)
  source.state.status='disconnected';source.emit('change');release({summary:{lifetimeTokens:999}});await request
  assert.equal(resource.state.data,null);resource.dispose()
})
