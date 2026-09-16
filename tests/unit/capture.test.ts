import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { Capture } from '../../src/main/capture'
import { Shortcuts } from '../../src/main/shortcuts'
import { defaultBindings } from '../../src/shared/commands'

class Native extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough()
  commands: string[] = []; killed = false
  constructor() { super(); this.stdin.on('data', data => this.commands.push(String(data).trim())) }
  kill(): boolean { this.killed = true; return true }
  message(value: unknown): void { this.stdout.write(JSON.stringify(value) + '\n') }
}
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'capture-'))
  const children: Native[] = []
  const service = new Capture(join(folder, 'capture.json'), 'fixture', () => { const child = new Native(); children.push(child); return child as unknown as ChildProcessWithoutNullStreams })
  await service.init()
  const child = children[0]; child.message({ type: 'ready' }); child.message({ type: 'status', enabled: true, error: '' })
  return { service, child, children, folder }
}

test('capture preserves exact Unicode, protects one draft, serializes saves and rejects stale IDs', async () => {
  const { service, child } = await fixture()
  try {
    service.request(); assert.equal(child.commands.at(-1), 'capture')
    child.message({ type: 'begin', id: 1 }); const id = service.draft!.id
    assert.equal(service.draft!.acquiring, true)
    let raised = 0; service.on('raise', () => raised++)
    service.request(); assert.equal(raised, 1)
    const text = 'Prova Localino 🌱\r\nSeconda riga è 漢字'
    child.message({ type: 'result', id: 1, text, reason: 'ok', ms: 4 })
    assert.equal(service.draft!.text, text)
    child.message({ type: 'result', id: 0, text: 'obsolete', reason: 'ok', ms: 4 })
    child.message({ type: 'begin', id: 2 })
    assert.equal(service.draft!.text, text); assert.equal(raised, 2)
    assert.equal(service.finish(id + 1, true), false)
    let commits = 0; let release!: () => void
    const save = service.save(id, text, async () => { commits++; await new Promise<void>(resolve => { release = resolve }); return { ok: true } })
    assert.equal(service.finish(id, true), false)
    assert.equal((await service.save(id, text, async () => ({ ok: true }))).ok, false)
    release(); assert.equal((await save).ok, true); assert.equal(commits, 1); assert.equal(service.draft, null)
    assert.equal((await service.save(id, text, async () => ({ ok: true }))).ok, false)
  } finally { service.dispose() }
})

test('save errors keep draft; native failure never imports stale text; cancel restores only active session', async () => {
  const { service, child } = await fixture()
  try {
    child.message({ type: 'begin', id: 1 }); child.message({ type: 'result', id: 1, text: 'synthetic', reason: 'ok', ms: 3 })
    const id = service.draft!.id
    assert.equal((await service.save(id, 'edit', async () => { throw Error('disk') })).ok, false)
    assert.equal(service.draft!.id, id)
    assert.equal(service.finish(id, true), true); assert.equal(child.commands.at(-1), 'cancel')
    child.message({ type: 'begin', id: 3 }); child.message({ type: 'result', id: 3, text: 'stale', reason: 'empty', ms: 3 })
    assert.equal(service.draft!.text, '')
    assert.match(service.draft!.message, /Nessuna selezione/)
    child.message({ type: 'result', id: 1, text: 'old', reason: 'ok', ms: 1 }); assert.equal(service.draft!.text, '')
  } finally { service.dispose() }
})

test('gesture preference persistence, failed writes and corrupt files preserve prior state', async () => {
  const { service, child, folder } = await fixture()
  try {
    assert.equal((await service.setEnabled(false)).ok, true); assert.equal(child.commands.at(-1), 'disable')
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'capture.json'), 'utf8')), { version: 1, enabled: false })
    const bad = new Capture(join(folder, 'directory'), 'fixture'); await mkdir(join(folder, 'directory'))
    assert.equal((await bad.setEnabled(false)).ok, false); assert.equal(bad.state.enabled, true)
    await writeFile(join(folder, 'corrupt'), '{bad')
    let launches = 0
    const corrupt = new Capture(join(folder, 'corrupt'), 'fixture', () => { launches++; throw Error() })
    await corrupt.init(); assert.equal(launches, 0); assert.equal(corrupt.state.status, 'error'); assert.equal((await corrupt.setEnabled(true)).ok, false)
    assert.equal(await readFile(join(folder, 'corrupt'), 'utf8'), '{bad')
  } finally { service.dispose() }
})

test('suspend/restart stop previous helper, ignore obsolete output and preserve the active draft', async () => {
  const { service, child, children } = await fixture()
  try {
    child.message({ type: 'begin', id: 1 }); const id = service.draft!.id
    service.suspend(); assert.equal(child.killed, true); assert.equal(service.draft!.acquiring, false)
    assert.equal(service.state.status, 'suspended')
    service.resume(); assert.equal(children.length, 2)
    child.message({ type: 'result', id: 1, text: 'old', reason: 'ok', ms: 1 }); assert.equal(service.draft!.text, '')
    children[1].message({ type: 'ready' }); children[1].message({ type: 'status', enabled: true, error: '' })
    children[1].message({ type: 'begin', id: 1 }); assert.equal(service.draft!.id, id)
    service.dispose(); assert.equal(children[1].killed, true)
  } finally { service.dispose() }
})

test('bounded acquisition timeout and malformed output degrade to an editable empty draft', async () => {
  const { service, child } = await fixture()
  try {
    child.message({ type: 'begin', id: 1 })
    await new Promise(resolve => setTimeout(resolve, 1700))
    assert.equal(child.killed, true); assert.equal(service.state.status, 'error'); assert.equal(service.draft!.acquiring, false)
    assert.match(service.draft!.message, /scaduta/)
    service.finish(service.draft!.id, false); service.request(); assert.equal(service.draft!.text, '')
  } finally { service.dispose() }
  const second = await fixture()
  try { second.child.stdout.write('not-json\n'); assert.equal(second.child.killed, true); assert.equal(second.service.state.status, 'error') }
  finally { second.service.dispose() }
})

test('STORY-006 shortcut migration preserves user preferences and handles collision with new capture default', async () => {
  for (const collision of [false, true]) {
    const file = join(await mkdtemp(join(tmpdir(), 'capture-migration-')), 'shortcuts.json')
    const legacy = defaultBindings().filter(b => !(b.id === 'capture' && b.scope === 'global'))
    legacy.find(b => b.id === 'home' && b.scope === 'global')!.key = collision ? 'Ctrl+Alt+P' : 'Ctrl+Alt+H'
    legacy.find(b => b.id === 'new')!.key = 'Ctrl+J'
    await writeFile(file, JSON.stringify({ version: 1, bindings: legacy }))
    const store = new Shortcuts(file, { register: () => true, unregister: () => {} }, () => {})
    await store.init()
    assert.equal(store.state.error, undefined)
    assert.equal(store.state.bindings.find(b => b.id === 'new')!.key, 'Ctrl+J')
    assert.equal(store.state.bindings.find(b => b.id === 'capture' && b.scope === 'global')!.key, collision ? '' : 'Ctrl+Alt+P')
    store.dispose()
  }
})
