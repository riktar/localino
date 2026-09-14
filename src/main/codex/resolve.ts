import { stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

export class CliError extends Error {
  constructor(public readonly kind: 'cli_invalid' | 'cli_missing') { super(kind) }
}

export async function resolveCodex(preferred: string | null, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = preferred ? [preferred] : [
    ...(env.PATH ?? '').split(delimiter).filter(Boolean).map(folder => join(folder.replace(/^"|"$/g, ''), name)),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', name)] : []),
  ]
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || (process.platform === 'win32' && !candidate.toLowerCase().endsWith('.exe'))) continue
    try { if ((await stat(candidate)).isFile()) return candidate } catch { /* Try next candidate. */ }
  }
  throw new CliError(preferred ? 'cli_invalid' : 'cli_missing')
}
