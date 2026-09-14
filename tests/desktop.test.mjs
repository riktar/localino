import test from 'node:test'
import { desktopSmoke } from './helpers.mjs'

test('Electron: renderer, isolamento e ciclo finestra', { timeout: 60_000 }, () => desktopSmoke())
