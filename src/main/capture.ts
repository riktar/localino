import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { captureMessage, type CaptureDraft, type CaptureStatus } from '../shared/capture'

type Launcher = () => ChildProcessWithoutNullStreams
export class Capture extends EventEmitter {
  state: CaptureStatus = { enabled: true, status: 'starting' }
  draft: CaptureDraft | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private origin: {handle:string;pid:number} | null = null
  private restorers = new Set<ReturnType<typeof spawn>>()
  private sequence = 0
  private nativeId: number | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private startup: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private preferencesError = false
  private saving = false
  get isSaving(): boolean { return this.saving }
  constructor(private file: string, private executable: string, private launch: Launcher = () => spawn(executable, [], { windowsHide: true, stdio: 'pipe' })) { super() }
  private status(): void { this.emit('status', this.state) }
  private send(command: string): void { if (this.child?.stdin.writable) this.child.stdin.write(command + '\n') }
  async init(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as { version?: unknown; enabled?: unknown }
      if (value.version !== 1 || typeof value.enabled !== 'boolean') throw Error('schema')
      this.state.enabled = value.enabled
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.preferencesError = true
        this.state = { enabled: false, status: 'error', error: 'Preferenze cattura non leggibili. File conservato.' }
        this.status(); return
      }
    }
    this.start()
  }
  start(): void {
    if (this.preferencesError || this.state.status === 'suspended') return
    this.stop()
    this.state = { enabled: this.state.enabled, status: 'starting' }; this.status()
    let child: ChildProcessWithoutNullStreams
    try { child = this.launch() } catch { this.fail(); return }
    this.child = child
    let buffer = ''
    child.stdin.on('error', () => { if (this.child === child) this.fail() })
    child.stderr.on('data', () => { /* Native diagnostics must never expose captured content. */ })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return
      buffer += chunk
      if (buffer.length > 1_000_000) { this.fail(); return }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try { this.message(JSON.parse(line)) } catch { this.fail(); return }
      }
    })
    child.on('error', () => { if (this.child === child) this.fail() })
    child.on('exit', () => { if (this.child === child) this.fail() })
    this.startup = setTimeout(() => this.fail(), 3000)
  }
  private message(value: unknown): void {
    if (!value || typeof value !== 'object') throw Error('protocol')
    const msg = value as Record<string, unknown>
    if (msg.type === 'ready') { clearTimeout(this.startup); this.send(this.state.enabled ? 'enable' : 'disable'); return }
    if (msg.type === 'status') {
      if (typeof msg.enabled !== 'boolean') throw Error('protocol')
      this.state = { enabled: this.state.enabled, status: msg.error ? 'error' : 'ready', ...(msg.error ? { error: 'Rilevamento doppio Shift non disponibile. Riprova da Scorciatoie.' } : {}) }
      this.status(); return
    }
    if (msg.type === 'error') { this.fail(); return }
    if (msg.type === 'raise') { if (this.draft) this.emit('raise'); return }
    if (msg.type === 'begin') {
      if (!Number.isSafeInteger(msg.id)) throw Error('protocol')
      if (this.draft) { this.send('finish'); this.emit('raise'); return }
      this.origin = typeof msg.origin === 'string' && /^[0-9]{1,18}$/.test(msg.origin) && Number.isSafeInteger(msg.pid) && Number(msg.pid) > 0 ? {handle:msg.origin,pid:Number(msg.pid)} : null
      this.nativeId = msg.id as number
      this.draft = { id: ++this.sequence, text: '', acquiring: true, message: 'Lettura della selezione…' }
      this.emit('draft', this.draft)
      this.timer = setTimeout(() => { if (this.draft?.acquiring) this.fail('timeout') }, 1600)
      return
    }
    if (msg.type === 'result') {
      if (!this.draft?.acquiring || msg.id !== this.nativeId) return
      if (typeof msg.text !== 'string' || msg.text.length > 100_000 || typeof msg.reason !== 'string' || typeof msg.ms !== 'number' || !Number.isFinite(msg.ms) || msg.ms < 0) throw Error('protocol')
      clearTimeout(this.timer)
      this.draft = { ...this.draft, acquiring: false, text: msg.reason === 'ok' ? msg.text : '', message: captureMessage(msg.reason), elapsedMs: msg.ms }
      this.emit('draft', this.draft)
      return
    }
    throw Error('protocol')
  }
  request(): void {
    if (this.draft) { this.emit('raise'); return }
    if (this.state.status === 'ready') this.send('capture')
    else {
      this.draft = { id: ++this.sequence, text: '', acquiring: false, message: captureMessage('unavailable') }
      this.emit('draft', this.draft)
    }
  }
  finish(id: number, restore: boolean): boolean {
    if (!this.draft || this.draft.id !== id || this.saving) return false
    const attached = this.nativeId !== null
    clearTimeout(this.timer); this.nativeId = null; this.draft = null
    if (restore && !attached && this.origin) {
      const child = spawn(this.executable, ['--restore', this.origin.handle, String(this.origin.pid)], { windowsHide:true, stdio:'ignore' })
      this.restorers.add(child)
      const timeout = setTimeout(()=>child.kill(),1000)
      const done = () => { clearTimeout(timeout); this.restorers.delete(child) }
      child.on('error',done);child.on('exit',done)
    } else this.send(restore ? 'cancel' : 'finish')
    this.origin = null
    this.emit('finished'); return true
  }
  async save(id: number, text: unknown, persist: (text: string) => Promise<{ ok: boolean; error?: string }>): Promise<{ ok: boolean; error?: string }> {
    if (!this.draft || this.draft.id !== id || this.draft.acquiring || this.saving || typeof text !== 'string') return { ok: false, error: 'Cattura non disponibile o salvataggio in corso.' }
    this.saving = true
    try {
      const result = await persist(text)
      this.saving = false
      if (result.ok) this.finish(id, false)
      return result
    } catch { return { ok: false, error: 'Salvataggio non riuscito. Il testo è conservato: riprova.' } }
    finally { this.saving = false }
  }
  setEnabled(value: unknown): Promise<{ ok: boolean; error?: string }> {
    const operation = this.queue.then(async () => {
      if (typeof value !== 'boolean' || this.preferencesError) return { ok: false, error: 'Preferenze cattura non disponibili.' }
      const temp = `${this.file}.${randomUUID()}.tmp`
      try { await writeFile(temp, JSON.stringify({ version: 1, enabled: value }), 'utf8'); await rename(temp, this.file) }
      catch { await unlink(temp).catch(() => {}); return { ok: false, error: 'Salvataggio non riuscito. Preferenza precedente conservata.' } }
      this.state = { ...this.state, enabled: value }; this.status()
      if (this.child) this.send(value ? 'enable' : 'disable')
      return { ok: true }
    })
    this.queue = operation.catch(() => {}); return operation
  }
  private fail(reason = 'unavailable'): void {
    this.stop()
    this.state = { enabled: this.state.enabled, status: 'error', error: captureMessage(reason) }; this.status()
    if (this.draft?.acquiring) { this.draft = { ...this.draft, acquiring: false, message: captureMessage(reason), text: '' }; this.emit('draft', this.draft) }
  }
  private stop(): void {
    clearTimeout(this.startup); clearTimeout(this.timer)
    const child = this.child; this.child = null; this.nativeId = null
    // Closing/killing the native coordinator also kills its UIA workers via its Windows job.
    if (child) { child.stdin.end(); child.kill() }
  }
  suspend(): void {
    this.stop(); this.state = { ...this.state, status: 'suspended' }; this.status()
    if (this.draft?.acquiring) { this.draft = { ...this.draft, acquiring: false, text: '', message: 'Lettura interrotta dalla sospensione. Puoi incollare il testo.' }; this.emit('draft', this.draft) }
  }
  resume(): void { this.state.status = 'starting'; this.start() }
  dispose(): void { this.stop(); for (const child of this.restorers) child.kill(); this.restorers.clear() }
}
