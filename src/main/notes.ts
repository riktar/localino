import { newestFirst } from '../shared/note-selection'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { textError, type Note, type NoteMutation, type NoteResult, type NotesState } from '../shared/notes'

/** Only the main process owns this store; every IPC client shares its serialized queue. */
export class NotesStore extends EventEmitter {
  private notes: Note[] = []
  private error: string | null = null
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly path: string) { super() }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.catch(() => {})
    return result
  }
  private snapshot(): NotesState { return { notes: this.notes.map(n => ({ ...n })), error: this.error, path: this.path } }
  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('notes' in raw) || !Array.isArray(raw.notes)) throw Error('schema')
      const ids = new Set<string>()
      for (const note of raw.notes as unknown[]) {
        if (!note || typeof note !== 'object') throw Error('schema')
        const n = note as Note
        if (typeof n.id !== 'string' || !n.id || ids.has(n.id) || textError(n.text) || !Number.isSafeInteger(n.createdAt) || n.createdAt < 0 || !Number.isSafeInteger(n.updatedAt) || n.updatedAt < n.createdAt || typeof n.completed !== 'boolean') throw Error('schema')
        ids.add(n.id)
      }
      this.notes = (raw.notes as Note[]).map(({id,text,createdAt,updatedAt,completed}) => ({id,text,createdAt,updatedAt,completed})).sort(newestFirst)
      this.error = null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.notes = []; this.error = null }
      else this.error = `Library unreadable or unsupported. File preserved. Path: ${this.path}`
    }
  }
  get(): Promise<NotesState> { return this.serial(async () => { await this.load(); return this.snapshot() }) }
  reload(): Promise<NotesState> { return this.serial(async () => { this.loaded = false; await this.load(); const state = this.snapshot(); this.emit('change',state); return state }) }
  mutate(value: unknown): Promise<NoteResult> {
    return this.serial(async () => {
      await this.load()
      if (this.error) return { ok: false, error: this.error }
      if (!value || typeof value !== 'object') return { ok: false, error: 'Invalid operation.' }
      const action = value as NoteMutation
      if (!['create','update','complete','delete'].includes(action.kind)) return { ok:false,error:'Invalid operation.' }
      const next = this.notes.map(n => ({...n}))
      const now = Math.max(Date.now(), ...next.slice(0,1).map(n=>n.createdAt+1))
      if (action.kind === 'create' || action.kind === 'update') {
        const error = textError(action.text)
        if (error) return { ok:false,error }
      }
      if (action.kind === 'create') next.unshift({id:randomUUID(),text:action.text,createdAt:now,updatedAt:now,completed:false})
      else {
        const index = next.findIndex(n => n.id === action.id)
        if (index < 0) return {ok:false,error:'Note no longer available. Reload the library.'}
        const note = next[index]
        if (action.kind === 'delete') next.splice(index,1)
        else {
          if (action.kind === 'update') {
            if (action.expectedUpdatedAt !== note.updatedAt) return {ok:false,error:'Note changed elsewhere. Copy your draft before reloading.'}
            note.text = action.text
          } else {
            if (typeof action.completed !== 'boolean') return {ok:false,error:'Invalid state.'}
            note.completed = action.completed
          }
          note.updatedAt = Math.max(now,note.updatedAt+1)
        }
      }
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(this.path), {recursive:true})
        await writeFile(temporary, JSON.stringify({version:1,notes:next}), {encoding:'utf8',flag:'wx'})
        await rename(temporary,this.path)
      } catch {
        await unlink(temporary).catch(()=>{})
        return {ok:false,error:`Could not save. Draft kept. Check space and permissions: ${this.path}`}
      }
      this.notes = next
      const state = this.snapshot(); this.emit('change',state)
      return {ok:true,state}
    })
  }
}
