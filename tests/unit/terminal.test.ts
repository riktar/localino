import test from 'node:test'
import assert from 'node:assert/strict'
import { isTerminalViewport, terminalText } from '../../src/shared/terminal'

test('terminal text makes all executable controls inert before Ink', () => {
  const input = '\x1b]52;c;c2VjcmV0\x07\x1b]8;;https://evil.test\x07link\x1b[2J\x9b2J\r\b\u202ehello\n🌍\tend'
  const safe = terminalText(input)
  assert.equal(safe.includes('\x1b'), false)
  assert.equal(safe.includes('\x07'), false)
  assert.equal(safe.includes('\x9b'), false)
  assert.ok(safe.includes('␛]52;c;c2VjcmV0␇'))
  assert.ok(safe.includes('🌍    end'))
  assert.ok(safe.includes('\\u202ehello\n'))
})

test('terminal IPC only accepts bounded viewport identities and dimensions', () => {
  const valid = { sessionId: 'session-1', viewId: 'view-1', columns: 80, rows: 24 }
  assert.equal(isTerminalViewport(valid), true)
  for (const change of [{ sessionId: '../x' }, { viewId: '' }, { rows: 1000 }, { columns: 0 }, { columns: 10.5 }, { columns: '80' }]) assert.equal(isTerminalViewport({ ...valid, ...change }), false)
  assert.equal(isTerminalViewport(null), false)
})
