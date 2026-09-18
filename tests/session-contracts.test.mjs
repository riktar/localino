import test from 'node:test'
import assert from 'node:assert/strict'
import { acknowledge, applyEvent, cancel, createModel, dispatch, enqueue, identityKey, restart } from '../scripts/session-contract-harness.mjs'
import { capability } from '../scripts/probe-session-capabilities.mjs'

const alpha = { provider: 'codex', instanceId: 'instance-a', sessionId: 'session-1' }
const beta = { provider: 'codex', instanceId: 'instance-b', sessionId: 'session-1' }

test('identity includes provider, owning instance and session', () => {
  assert.notEqual(identityKey(alpha), identityKey(beta))
  assert.notEqual(identityKey(alpha), identityKey({ ...alpha, provider: 'claude' }))
})

test('out-of-order and foreign lifecycle events cannot replace the active turn', () => {
  let model = createModel(alpha)
  model = applyEvent(model, { ...alpha, type: 'turn-started', turnId: 'turn-2', startedAt: 2000, sequence: 2 })
  model = applyEvent(model, { ...alpha, type: 'turn-ended', turnId: 'turn-1', outcome: 'idle', sequence: 1 })
  model = applyEvent(model, { ...beta, type: 'turn-ended', turnId: 'turn-2', outcome: 'idle', sequence: 3 })
  assert.deepEqual({ status: model.status, turnId: model.turnId, startedAt: model.startedAt, sequence: model.sequence }, { status: 'running', turnId: 'turn-2', startedAt: 2000, sequence: 2 })
})

test('FIFO dispatch waits for idle, supports local cancellation and never duplicates an ack', () => {
  let model = applyEvent(createModel(alpha), { ...alpha, type: 'turn-started', turnId: 'turn-1', startedAt: 1000, sequence: 1 })
  model = enqueue(enqueue(model, 'm1', 'first'), 'm2', 'second')
  assert.equal(dispatch(model).deliveries.length, 0)
  model = cancel(model, 'm1')
  model = applyEvent(model, { ...alpha, type: 'turn-ended', turnId: 'turn-1', outcome: 'idle', sequence: 2 })
  model = dispatch(model)
  model = acknowledge(acknowledge(model, 'm2', 'sent'), 'm2', 'sent')
  assert.deepEqual(model.deliveries, [{ id: 'm2', text: 'second', state: 'sent' }])
})

test('restart suspends local work and converts in-flight delivery to unknown without retry', () => {
  let model = { ...createModel(alpha), status: 'idle' }
  model = dispatch(enqueue(enqueue(model, 'm1', 'first'), 'm2', 'second'))
  model = restart(model)
  assert.equal(model.deliveries[0].state, 'unknown')
  assert.equal(model.queue[0].state, 'suspended')
  assert.equal(dispatch(model).deliveries.length, 1)
})

test('capability probe emits markers only, not raw command output', () => {
  const result = capability('fixture', { available: true, status: 0, text: 'secret\n--remote-control' }, ['--remote-control', '--listen'])
  assert.deepEqual(result, { name: 'fixture', available: true, status: 0, markers: { '--remote-control': true, '--listen': false } })
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
