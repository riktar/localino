import { createReadStream } from 'node:fs'
import { readdir, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export type Row = Record<string, unknown>
export const object = (value: unknown): Row | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
export const identifier = (value: unknown): string | null => typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : null
export const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
export const money = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) return null
  const day = value.slice(0, 10), midnight = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0, 10) === day ? Date.parse(value) : null
}

/** Walk only regular files under the selected root. Never follow transcript links. */
export async function jsonlFiles(root: string): Promise<{ files: string[]; issues: number }> {
  const canonical = await realpath(root)
  const files: string[] = []; let issues = 0
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) { issues++; continue }
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
  }
  await visit(canonical)
  return { files: files.sort(), issues }
}

/** Read a bounded snapshot; a partial last line is retried by rebuilding on refresh. */
export async function readJsonl(file: string, consume: (row: Row) => void): Promise<number> {
  const before = await stat(file)
  if (!before.size) return 0
  const stream = createReadStream(file, { start: 0, end: before.size - 1 })
  const decoder = new StringDecoder('utf8')
  let buffer = '', issues = 0
  const parse = (line: string) => {
    if (!line.trim()) return
    try { const row = object(JSON.parse(line)); if (!row) issues++; else consume(row) }
    catch { issues++ }
  }
  for await (const chunk of stream) {
    buffer += decoder.write(chunk as Buffer)
    let start = 0, end: number
    while ((end = buffer.indexOf('\n', start)) !== -1) { parse(buffer.slice(start, end)); start = end + 1 }
    buffer = buffer.slice(start)
  }
  buffer += decoder.end()
  if (buffer.trim()) parse(buffer)
  const after = await stat(file)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) issues++
  return issues
}
