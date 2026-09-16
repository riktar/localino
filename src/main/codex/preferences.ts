import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export interface Preferences { enabled: boolean; cliPath: string | null }
export interface PreferenceStore { load(): Preferences; save(value: Preferences): void; readonly error?: boolean }

export class FilePreferences implements PreferenceStore {
  error = false
  constructor(private file: string) {}
  load(): Preferences {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!data || typeof data.enabled !== 'boolean' || (data.cliPath !== null && typeof data.cliPath !== 'string')) throw Error('schema')
      return { enabled: data.enabled === true, cliPath: typeof data.cliPath === 'string' ? data.cliPath : null }
    } catch (error) { this.error = (error as NodeJS.ErrnoException).code !== 'ENOENT'; return { enabled: false, cliPath: null } }
  }
  save(value: Preferences): void {
    if (this.error) throw Error('preferences')
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify({ enabled: value.enabled, cliPath: value.cliPath }), { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
  }
  recover(): void {
    if (this.error) renameSync(this.file, `${this.file}.${randomUUID()}.preserved`)
    this.error = false
    this.save({ enabled: false, cliPath: null })
  }
}
