import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { initialAgents, isAgentId, type AgentId, type AgentSource, type AgentsState, type LocalAgentId } from '../../shared/agents'

/** This file contains selection and source paths only. Agent credentials are never opened. */
export class AgentPreferences extends EventEmitter {
  state: AgentsState = initialAgents()
  constructor(private file: string) {
    super()
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      if (raw.version !== 1 || !isAgentId(raw.selected) || !raw.sources || typeof raw.sources !== 'object') throw Error('schema')
      const sources = initialAgents().sources
      for (const id of Object.keys(sources) as LocalAgentId[]) {
        const source = raw.sources[id]
        if (!source || typeof source.enabled !== 'boolean' || (source.path !== null && (typeof source.path !== 'string' || !isAbsolute(source.path)))) throw Error('schema')
        sources[id] = { enabled: source.enabled, path: source.path }
      }
      this.state = { selected: raw.selected, sources, error: null }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.state.error = 'Agent preferences unreadable. File preserved; recovery is available.'
    }
  }
  private save(next: AgentsState): void {
    if (this.state.error) throw Error(this.state.error)
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, JSON.stringify({ version: 1, selected: next.selected, sources: next.sources }), { mode: 0o600 })
      renameSync(temp, this.file)
    } catch { try { rmSync(temp, { force: true }) } catch { /* Failed temporary files are never used as preferences. */ } throw Error('Could not save agent preferences. Previous values kept.') }
    this.state = next
    this.emit('change', this.state)
  }
  select(id: AgentId): void { this.save({ ...this.state, selected: id }) }
  source(id: LocalAgentId, source: AgentSource): void { this.save({ ...this.state, sources: { ...this.state.sources, [id]: source } }) }
  recover(): void {
    if (this.state.error) renameSync(this.file, `${this.file}.${randomUUID()}.preserved`)
    this.state = initialAgents()
    this.save(this.state)
  }
}
