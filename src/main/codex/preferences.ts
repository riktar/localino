import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Preferences { enabled: boolean; cliPath: string | null }
export interface PreferenceStore { load(): Preferences; save(value: Preferences): void }

export class FilePreferences implements PreferenceStore {
  constructor(private file: string) {}
  load(): Preferences {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'))
      return { enabled: data.enabled === true, cliPath: typeof data.cliPath === 'string' ? data.cliPath : null }
    } catch { return { enabled: false, cliPath: null } }
  }
  save(value: Preferences): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify({ enabled: value.enabled, cliPath: value.cliPath }), { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
  }
}
