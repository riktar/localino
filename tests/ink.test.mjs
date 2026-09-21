import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import headless from '@xterm/headless'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = terminal => Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i)?.translateToString(true) ?? '').join('\n')

test('bundled Ink renders 5,000 Unicode deltas across isolated virtual terminals and exits cleanly', { timeout: 30000 }, async () => {
  const worker = new Worker(resolve('out/main/ink-worker.mjs'), { stdout: true, stderr: true })
  let output = '', failure, progressive = false, completedFrames = 0, userStyle = false, assistantStyle = false
  worker.stdout.on('data', data => { output += data }); worker.stderr.on('data', data => { output += data })
  worker.on('error', error => { failure = error })
  const terminals = new Map(), sequences = new Map()
  worker.on('message', frame => {
    if (frame.data.includes('\x1b[36m')) userStyle = true
    if (frame.data.includes('\x1b[32m')) assistantStyle = true
    if (frame.viewId === 'v0' && frame.data.includes('λ') && !frame.data.includes('END')) progressive = true
    if (frame.viewId === 'v0') completedFrames++
    assert.equal(frame.sequence, (sequences.get(frame.viewId) ?? 0) + 1)
    sequences.set(frame.viewId, frame.sequence)
    if (frame.reset) { terminals.get(frame.viewId)?.reset(); terminals.get(frame.viewId)?.resize(frame.columns, frame.rows) }
    terminals.get(frame.viewId)?.write(frame.data)
  })
  const started = performance.now(), memory = process.memoryUsage().rss, cpu = process.cpuUsage()
  try {
    for (let i = 0; i < 3; i++) {
      const id = `v${i}`
      terminals.set(id, new headless.Terminal({ cols: 80, rows: 100, scrollback: 1000, convertEol: true, allowProposedApi: true }))
      worker.postMessage({ type: 'open', viewport: { viewId: id, sessionId: `s${i}`, columns: 80, rows: 100 }, lines: [{ label: `Session ${i}`, text: `isolated-${i}`, role: i===1?'user':'assistant' }] })
    }
    for (let i = 1; i <= 5000; i++) {
      worker.postMessage({ type: 'update', viewport: { viewId: 'v0', sessionId: 's0', columns: 80, rows: 100 }, lines: [{ label: 'Unicode', text: 'λ'.repeat(i) + (i === 5000 ? '🌍 END' : ''), role: 'assistant' }] })
      if (i % 20 === 0) await pause(20)
    }
    const deadline = Date.now() + 20000
    while ((!text(terminals.get('v0')).includes('END') || !text(terminals.get('v1')).includes('isolated-1') || !text(terminals.get('v2')).includes('isolated-2')) && Date.now() < deadline && !failure) await pause(20)
    if (failure) throw failure
    const rendered = text(terminals.get('v0'))
    assert.equal((rendered.match(/λ/g) ?? []).length, 5000)
    assert.ok(rendered.includes('🌍 END'))
    assert.equal(progressive, true, 'Visible frames must precede completion')
    assert.ok(text(terminals.get('v1')).includes('isolated-1'))
    assert.ok(text(terminals.get('v2')).includes('isolated-2'))
    assert.equal(userStyle,true);assert.equal(assistantStyle,true)
    const original = 'abcdefghijklmnopqrstuvwx'.repeat(5) + ' END'
    for (const columns of [80, 20, 80, 10, 80]) {
      const updated = `${original} ${columns}`
      const before = sequences.get('v2')
      worker.postMessage({ type: 'open', viewport: { viewId: 'v2', sessionId: 's2', columns, rows: 12 }, lines: [{ label: 'HEADER', text: updated, role: 'assistant' }] })
      const until = Date.now() + 2000
      while (sequences.get('v2') === before && Date.now() < until) await pause(20)
      await new Promise(resolveWrite => terminals.get('v2').write('', resolveWrite))
      const content = text(terminals.get('v2')).split('\n').filter(Boolean)
      assert.equal(content[0], '◆ HEADER')
      assert.equal(content.slice(1).join(''), updated, `Exact updated output after resize to ${columns}`)
    }
    for (let i = 0; i < 12; i++) {
      worker.postMessage({ type: 'close', viewId: 'v1' })
      await pause(20)
      sequences.delete('v1'); terminals.get('v1').reset()
      worker.postMessage({ type: 'open', viewport: { viewId: 'v1', sessionId: 's1', columns: 30 + i, rows: 100 }, lines: [{ label: 'Remount', text: `round-${i} 🌍`, role: 'assistant' }] })
      await pause(50)
      const until = Date.now() + 2000
      while (!text(terminals.get('v1')).includes(`round-${i} 🌍`) && Date.now() < until) await pause(20)
      assert.ok(text(terminals.get('v1')).includes(`round-${i} 🌍`))
    }
    assert.equal(output, '')
    console.log(JSON.stringify({ ink: '7.1.1', deltas: 5000, instances: 3, elapsedMs: performance.now() - started, rssGrowthBytes: process.memoryUsage().rss - memory, cpu: process.cpuUsage(cpu), streamingFrames: completedFrames, frames: Object.fromEntries(sequences) }))
  } finally {
    await new Promise((resolveExit, reject) => {
      const timer = setTimeout(() => { void worker.terminate(); reject(Error('Worker did not exit')) }, 3000)
      worker.once('exit', code => { clearTimeout(timer); if (code === 0) resolveExit(); else reject(Error(`Worker exited ${code}`)) })
      worker.postMessage({ type: 'dispose' })
    })
    for (const terminal of terminals.values()) terminal.dispose()
  }
  assert.equal(output, '', 'No worker output, including exit hooks')
})
