export const NOTE_LIMIT = 100_000
export interface Note { id: string; text: string; createdAt: number; updatedAt: number; completed: boolean }
export interface NotesState { notes: Note[]; error: string | null; path: string }
export type NoteMutation = { kind: 'create'; text: string } | { kind: 'update'; id: string; expectedUpdatedAt: number; text: string } | { kind: 'complete'; id: string; completed: boolean } | { kind: 'delete'; id: string }
export type NoteResult = { ok: true; state: NotesState } | { ok: false; error: string }
export function textError(text: unknown): string | null {
  if (typeof text !== 'string') return 'Note must be text.'
  if (!text.trim()) return 'Enter some text.'
  if (text.length > NOTE_LIMIT) return `Limit: ${NOTE_LIMIT.toLocaleString('en-US')} characters. Text has not been truncated.`
  return null
}
