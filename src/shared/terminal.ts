/** Only viewport controls cross renderer -> main. Text comes from the owned session. */
export interface TerminalViewport { sessionId: string; viewId: string; columns: number; rows: number }
export interface TerminalFrame { sessionId: string; viewId: string; sequence: number; data: string; error?: string; reset?: boolean; columns?: number; rows?: number }
export interface TerminalLine { label: string; text: string; role: 'user' | 'assistant' }
export function isTerminalViewport(value: unknown): value is TerminalViewport {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.sessionId === 'string' && /^[\w-]{1,128}$/.test(v.sessionId)
    && typeof v.viewId === 'string' && /^[\w-]{1,128}$/.test(v.viewId)
    && Number.isInteger(v.columns) && Number(v.columns) >= 10 && Number(v.columns) <= 240
    && Number.isInteger(v.rows) && Number(v.rows) >= 2 && Number(v.rows) <= 100
}

/** Render controls visibly, before Ink sees them; Text alone does not escape ANSI. */
export function terminalText(text: string): string {
  return Array.from(text, character => {
    const code = character.codePointAt(0)!
    if (character === '\n') return character
    if (character === '\t') return '    '
    if (code < 32) return String.fromCodePoint(0x2400 + code)
    if (code === 127) return '␡'
    if ((code >= 128 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return `\\u${code.toString(16).padStart(4, '0')}`
    return character
  }).join('')
}
