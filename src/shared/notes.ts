export const NOTE_LIMIT = 100_000
export interface Note { id: string; text: string; createdAt: number; updatedAt: number; completed: boolean }
export interface NotesState { notes: Note[]; error: string | null; path: string }
export type NoteMutation = { kind: 'create'; text: string } | { kind: 'update'; id: string; expectedUpdatedAt: number; text: string } | { kind: 'complete'; id: string; completed: boolean } | { kind: 'delete'; id: string }
export type NoteResult = { ok: true; state: NotesState } | { ok: false; error: string }
export function textError(text: unknown): string | null {
  if (typeof text !== 'string') return 'Il prompt deve essere testo.'
  if (!text.trim()) return 'Scrivi almeno un carattere diverso da uno spazio.'
  if (text.length > NOTE_LIMIT) return `Il limite è ${NOTE_LIMIT.toLocaleString('it-IT')} caratteri. Il testo non è stato troncato.`
  return null
}
