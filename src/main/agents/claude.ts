import type { AgentPeriod, HistoryData } from '../../shared/agents'
import { HistoryFailure } from './history-resource'
import { aggregate, blankMetrics, sum, type UsageEvent } from './aggregate'
import { count, identifier, jsonlFiles, object, readJsonl, timestamp } from './jsonl'

/** Claude 2.1.273 transcript metadata, conservatively excluding ambiguous output. */
export async function readClaude(root: string, period: AgentPeriod, now = Date.now()): Promise<HistoryData> {
  const scan = await jsonlFiles(root)
  const events = new Map<string, UsageEvent>()
  const ambiguous = new Set<string>()
  let issues = scan.issues, recognized = 0, rows = 0
  const metadata = new Set(['user', 'system', 'progress', 'queue-operation', 'summary', 'file-history-snapshot', 'custom-title', 'tag', 'agent-name', 'agent-color', 'ai-title', 'last-prompt'])
  for (const file of scan.files) {
    const fileIssues = await readJsonl(file, row => {
      rows++
      if (typeof row.type === 'string' && metadata.has(row.type)) {
        const envelope = identifier(row.uuid) && identifier(row.sessionId) && timestamp(row.timestamp) !== null
        const summary = row.type === 'summary' && identifier(row.leafUuid) && typeof row.summary === 'string'
        const snapshot = row.type === 'file-history-snapshot' && identifier(row.messageId) && timestamp(object(row.snapshot)?.timestamp) !== null
        const names: Record<string,string> = {'custom-title':'customTitle',tag:'tag','agent-name':'agentName','agent-color':'agentColor','ai-title':'aiTitle','last-prompt':'lastPrompt'}
        const named = names[row.type] && identifier(row.sessionId) && typeof row[names[row.type]] === 'string'
        const user = row.type !== 'user' || object(row.message)?.role === 'user'
        const payload = row.type === 'user' ? user : row.type === 'system' ? typeof row.subtype === 'string' : row.type === 'progress' ? !!object(row.data) : false
        if ((envelope && payload) || summary || snapshot || named) recognized++
        else issues++
        return
      }
      if (row.type !== 'assistant') { issues++; return }
      const message = object(row.message), usage = object(message?.usage)
      if (message?.role === 'assistant' && usage) recognized++
      const id = identifier(message?.id), session = identifier(row.sessionId), time = timestamp(row.timestamp)
      if (!usage || !id || !session || time === null || message?.role !== 'assistant' || row.isApiErrorMessage === true) { issues++; return }
      if (ambiguous.has(id)) return
      const metrics = { ...blankMetrics(), input: count(usage.input_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens) }
      if ([metrics.input, metrics.cacheRead, metrics.cacheWrite].every(value => value === null)) { issues++; return }
      // The official latest SDK documents output_tokens on assistant records as
      // message_start placeholders. Without a proven final-response field, keep
      // output/total unknown; never add result totals to per-response inputs.
      metrics.total = sum([metrics.input, metrics.output, metrics.cacheRead, metrics.cacheWrite])
      const previous = events.get(id)
      if (!previous) events.set(id, { id, session, time, metrics })
      else {
        // Copies retain response IDs. Equal usage is a duplicate, regardless of
        // transcript UUID, session ID or content. Conflicts remain partial.
        if (JSON.stringify(previous.metrics) !== JSON.stringify(metrics)) {
          issues++
          ambiguous.add(id); events.delete(id); return
        }
        previous.time = Math.min(previous.time, time)
        previous.sessions = [...new Set([...(previous.sessions ?? [previous.session]), session])]
      }
    })
    issues += fileIssues
  }
  if (rows && !recognized) throw new HistoryFailure('unsupported')
  const result = aggregate([...events.values()], period, issues, now)
  result.limitations = ['Output and total tokens unavailable: assistant events may contain provisional counts.', 'Coverage limited to local files; no account quota or historical cost.']
  if (result.records) result.partial = true
  return result
}
