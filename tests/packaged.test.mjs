import test from 'node:test'
import { desktopSmoke } from './helpers.mjs'

test('Artefatto Windows: renderer e ciclo finestra', { timeout: 60_000 }, () => desktopSmoke(true))
