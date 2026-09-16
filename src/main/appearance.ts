import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { isTheme, type ThemeState } from '../shared/theme'

export class Appearance {
  state: ThemeState = { preference: 'system' }
  constructor(private file: string) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      if (!isTheme(value?.theme)) throw Error('Invalid theme')
      this.state = { preference: value.theme }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.state.error = 'Could not read appearance. Choose a theme to save it again.'
    }
  }
  set(value: unknown): ThemeState {
    if (!isTheme(value)) throw Error('Invalid theme')
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify({ theme: value }), { mode: 0o600 })
      renameSync(this.file + '.tmp', this.file)
      this.state = { preference: value }
    } catch {
      try { rmSync(this.file + '.tmp', { force: true }) } catch { /* Keep the previous preference. */ }
      this.state = { ...this.state, error: 'Could not save appearance. Retry.' }
    }
    return this.state
  }
}
