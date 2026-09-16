import { basename, dirname, resolve } from 'node:path'
import type { AgentPeriod, HistoryData } from '../../shared/agents'
import { aggregate, blankMetrics, sum, type UsageEvent } from './aggregate'
import { count, identifier, jsonlFiles, money, object, readJsonl, timestamp } from './jsonl'
import { HistoryFailure } from './history-resource'

interface SessionFile { path: string; id: string; parent: string | null; events: UsageEvent[]; links: Map<string,string|null> }
const keyPath = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)

/** Pi 0.85.1/v3: original usage on every branch, including tools and summaries. */
export async function readPi(root: string, period: AgentPeriod, now = Date.now()): Promise<HistoryData> {
  const scan = await jsonlFiles(root), files: SessionFile[] = []
  let issues = scan.issues
  for (const path of scan.files) {
    let header: SessionFile | null = null, first = true, unsupported = false
    const fileIssues = await readJsonl(path, row => {
      if (first) {
        first = false
        if (row.type !== 'session' || row.version !== 3 || !identifier(row.id) || timestamp(row.timestamp) === null) { unsupported = true; issues++; return }
        const parent = row.parentSession === undefined ? null : identifier(row.parentSession)
        if (row.parentSession !== undefined && !parent) issues++
        header = { path: keyPath(path), id: row.id as string, parent: parent ? keyPath(resolve(dirname(path), parent)) : null, events: [], links: new Map() }
        return
      }
      if (unsupported || !header) return
      const id = identifier(row.id), time = timestamp(row.timestamp), parent = row.parentId === null ? null : identifier(row.parentId)
      if (!id || time === null || (row.parentId !== null && !parent)) { issues++; return }
      if (header.links.has(id) && header.links.get(id) !== parent) issues++
      header.links.set(id, parent)
      const message = object(row.message)
      const role = message?.role
      const assistant = row.type === 'message' && role === 'assistant'
      const tool = row.type === 'message' && role === 'toolResult'
      const summary = row.type === 'compaction' || row.type === 'branch_summary'
      const usage = object(summary ? row.usage : message?.usage)
      if (!assistant && !tool && !summary) {
        if (!['thinking_level_change','model_change','custom','custom_message','label','session_info'].includes(String(row.type)) && !(row.type === 'message' && ['user','bashExecution','custom','compactionSummary','branchSummary'].includes(String(role)))) issues++
        return
      }
      if (!usage) { if (assistant || summary) issues++; return }
      const metrics = { ...blankMetrics(), input: count(usage.input), output: count(usage.output), cacheRead: count(usage.cacheRead), cacheWrite: count(usage.cacheWrite), cost: money(object(usage.cost)?.total) }
      metrics.total = usage.totalTokens === undefined ? sum([metrics.input, metrics.output, metrics.cacheRead, metrics.cacheWrite]) : count(usage.totalTokens)
      const computed = sum([metrics.input, metrics.output, metrics.cacheRead, metrics.cacheWrite])
      if (computed === null && [metrics.input, metrics.output, metrics.cacheRead, metrics.cacheWrite].every(value => value !== null)) { metrics.total = null; issues++ }
      if (metrics.total !== null && computed !== null && metrics.total !== computed) { metrics.total = null; issues++ }
      if (usage.cost !== undefined && (!object(usage.cost) || (object(usage.cost)?.total !== undefined && metrics.cost === null))) issues++
      if ([metrics.input, metrics.output, metrics.cacheRead, metrics.cacheWrite, metrics.total].some(value => value === null)) issues++
      if ([metrics.input, metrics.output, metrics.total, metrics.cost].every(value => value === null)) return
      // retainedTail, tokensBefore and message content are deliberately never projected.
      header.events.push({ id: `${id}:${time}`, session: header.id, time, metrics })
    })
    issues += fileIssues
    const parsed = header as SessionFile | null
    if (parsed) {
      for (const parent of parsed.links.values()) if (parent && !parsed.links.has(parent)) issues++
      const checked = new Set<string>()
      for (const entry of parsed.links.keys()) {
        const branch = new Set<string>(); let cursor:string|null=entry
        while (cursor && parsed.links.has(cursor) && !checked.has(cursor)) {
          if (branch.has(cursor)) { issues++; break }
          branch.add(cursor);cursor=parsed.links.get(cursor)??null
        }
        for (const id of branch) checked.add(id)
      }
      files.push(parsed)
    }
  }
  if (scan.files.length && !files.length) throw new HistoryFailure('unsupported')
  const byPath = new Map(files.map(file => [file.path, file]))
  const byId = new Map(files.map(file => [file.id.toLowerCase(),file]))
  for (const file of files) if (file.parent && !byPath.has(file.parent)) {
    // Pi's native filenames encode the stable session UUID. A moved archive
    // can retain absolute parentSession paths; resolve only to enumerated
    // headers with that UUID, never by opening the former/outside path.
    const id = basename(file.parent).match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1]
    const relocated = id ? byId.get(id.toLowerCase()) : undefined
    if (relocated) file.parent = relocated.path
  }
  const parents = new Map<string,string>()
  function find(id: string): string {
    if (!parents.has(id)) parents.set(id,id)
    let current = id
    while (parents.get(current) !== current) current = parents.get(current)!
    let cursor = id
    while (parents.get(cursor) !== current) { const next = parents.get(cursor)!; parents.set(cursor,current); cursor = next }
    return current
  }
  const union = (a:string,b:string) => { const x=find(a),y=find(b);if(x!==y)parents.set(x,y) }
  for (const file of files) {
    // Session IDs scope short entry IDs; exact file clones share the same ID.
    union(file.path, `session:${file.id}`)
    if (file.parent) {
      const parent = byPath.get(file.parent)
      if (parent) union(file.path,parent.path)
      else { issues++; union(file.path,`missing:${file.parent}`) }
    }
  }
  const visited = new Set<string>()
  for (const file of files) {
    const branch = new Set<string>(); let cursor:SessionFile|undefined=file
    while (cursor && !visited.has(cursor.path)) {
      if (branch.has(cursor.path)) { issues++; break }
      branch.add(cursor.path);cursor=cursor.parent?byPath.get(cursor.parent):undefined
    }
    for(const path of branch)visited.add(path)
  }
  const events = new Map<string,UsageEvent>(), ambiguous = new Set<string>()
  for (const file of files) for (const event of file.events) {
    const id = `${find(file.path)}:${event.id}`
    if (ambiguous.has(id)) continue
    const previous = events.get(id)
    if (!previous) events.set(id,event)
    else if (JSON.stringify(previous.metrics) !== JSON.stringify(event.metrics)) { events.delete(id); ambiguous.add(id); issues++ }
    else previous.sessions = [...new Set([...(previous.sessions??[previous.session]), event.session])]
  }
  const result = aggregate([...events.values()],period,issues,now)
  if (!result.records && !issues) result.totals.cost = 0
  result.limitations = ['Sono inclusi tutti i rami con usage salvato, i tool e i riassunti. Il contesto conservato dalla compattazione non è nuova spesa.', 'Sessioni conteggiate anche quando contengono copie; risposte deduplicate nella famiglia originale. Costi USD forniti da Pi, non fattura.']
  return result
}
