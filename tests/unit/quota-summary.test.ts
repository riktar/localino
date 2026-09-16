import test from 'node:test'
import assert from 'node:assert/strict'
import { compactQuota } from '../../src/shared/quota-summary'
import type { Quotas, ResourceState } from '../../src/shared/contracts'
test('compact quotas preserve identity, missing values and exhausted secondary limits',()=>{
  const state:ResourceState<Quotas>={data:{buckets:[{id:'other',name:'Other',windows:[{kind:'primary',usedPercent:10,durationMins:60,resetsAt:null}]},{id:'codex',name:'Codex',windows:[{kind:'secondary',usedPercent:100,durationMins:10080,resetsAt:1},{kind:'primary',usedPercent:null,durationMins:300,resetsAt:null}]}]},lastSuccessAt:1,stale:true,error:null,refreshing:false}
  const view=compactQuota(state)
  assert.equal(view.bucket?.id,'codex');assert.equal(view.window?.kind,'primary');assert.equal(view.remaining,null)
  assert.equal(view.count,3);assert.equal(view.otherExhausted,true);assert.equal(view.resetPending,true)
  state.data!.buckets[1].windows[1].usedPercent=120
  assert.equal(compactQuota(state).remaining,0)
  state.data!.buckets[1].windows[1].usedPercent=0
  assert.equal(compactQuota(state).remaining,100)
})
