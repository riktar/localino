// Executable reference model for STORY-019 only. Product adapters must be built
// and reviewed separately after CAP-005 is resolved.
export const identityKey = value => JSON.stringify([value.provider, value.instanceId, value.sessionId])

export function createModel(identity) {
  return { identity, sequence: -1, turnId: null, status: 'unknown', startedAt: null, queue: [], deliveries: [] }
}

export function applyEvent(model, event) {
  if (identityKey(event) !== identityKey(model.identity) || !Number.isSafeInteger(event.sequence) || event.sequence <= model.sequence) return model
  const next = { ...model, sequence: event.sequence }
  if (event.type === 'turn-started') return { ...next, turnId: event.turnId, status: 'running', startedAt: event.startedAt ?? null }
  if (event.type === 'turn-waiting' && event.turnId === model.turnId) return { ...next, status: 'waiting' }
  if (event.type === 'turn-ended' && event.turnId === model.turnId) return { ...next, status: event.outcome ?? 'idle' }
  return next
}

export function enqueue(model, id, text) {
  if (!text.trim() || model.queue.some(item => item.id === id) || model.deliveries.some(item => item.id === id)) return model
  return { ...model, queue: [...model.queue, { id, text, state: 'queued' }] }
}

export function cancel(model, id) {
  return { ...model, queue: model.queue.filter(item => item.id !== id) }
}

export function dispatch(model) {
  if (model.status !== 'idle') return model
  const index = model.queue.findIndex(item => item.state === 'queued')
  if (index < 0) return model
  const item = model.queue[index]
  return { ...model, queue: model.queue.filter((_, position) => position !== index), deliveries: [...model.deliveries, { ...item, state: 'sending' }] }
}

export function acknowledge(model, id, outcome) {
  return { ...model, deliveries: model.deliveries.map(item => item.id === id && item.state === 'sending' ? { ...item, state: outcome } : item) }
}

export function restart(model) {
  return {
    ...model,
    status: 'unknown',
    queue: model.queue.map(item => ({ ...item, state: 'suspended' })),
    deliveries: model.deliveries.map(item => item.state === 'sending' ? { ...item, state: 'unknown' } : item),
  }
}
