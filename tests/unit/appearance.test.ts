import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Appearance } from '../../src/main/appearance'

test('appearance defaults, persistence, rejected input and failed writes preserve the last theme', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localino-theme-')), file = join(dir, 'appearance.json')
  try {
    const store = new Appearance(file)
    assert.deepEqual(store.state, { preference: 'system' })
    assert.deepEqual(store.set('dark'), { preference: 'dark' })
    assert.deepEqual(new Appearance(file).state, { preference: 'dark' })
    assert.throws(() => store.set({ theme: 'light' }))
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).theme, 'dark')
    mkdirSync(file + '.tmp')
    assert.match(store.set('light').error!, /Could not save/)
    assert.equal(store.state.preference, 'dark')
    assert.equal(new Appearance(file).state.preference, 'dark')
    rmSync(file + '.tmp', { recursive: true })
    writeFileSync(file, '{broken')
    const broken = new Appearance(file)
    assert.equal(broken.state.preference, 'system')
    assert.match(broken.state.error!, /Could not read/)
    assert.equal(readFileSync(file, 'utf8'), '{broken')
    assert.deepEqual(broken.set('light'), { preference: 'light' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
