import test from 'node:test'
import { desktopSmoke,packagedExecutable } from './helpers.mjs'
import assert from 'node:assert/strict'
import { resolve,dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

test('Packaged app: renderer and window lifecycle', { timeout: 60_000 }, () => desktopSmoke(true))

test('Packaged native helper runs without SDK or Node in PATH', () => {
  const result = spawnSync(resolve(dirname(packagedExecutable()),process.platform==='darwin'?'../Resources/native/Localino.Capture':'resources/native/Localino.Capture.exe'), ['--self-test'], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, PATH: process.platform==='darwin'?'/usr/bin:/bin':`${process.env.WINDIR}\\System32;${process.env.WINDIR}` }, timeout: 5000,
  })
  assert.equal(result.status, 0, result.error?.message)
  assert.match(result.stdout, /gesture-tests-ok/)
})
