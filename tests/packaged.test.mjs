import test from 'node:test'
import { desktopSmoke } from './helpers.mjs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('Artefatto Windows: renderer e ciclo finestra', { timeout: 60_000 }, () => desktopSmoke(true))

test('Artefatto Windows: helper nativo distribuito eseguibile senza SDK o Node nel PATH', () => {
  const result = spawnSync(resolve('dist/win-unpacked/resources/native/Localino.Capture.exe'), ['--self-test'], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, PATH: `${process.env.WINDIR}\\System32;${process.env.WINDIR}` }, timeout: 5000,
  })
  assert.equal(result.status, 0, result.error?.message)
  assert.match(result.stdout, /gesture-tests-ok/)
})
