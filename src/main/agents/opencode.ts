import { DatabaseSync } from 'node:sqlite'
import { stat } from 'node:fs/promises'
import type { AgentPeriod, HistoryData, TokenMetrics } from '../../shared/agents'
import { blankMetrics, sum } from './aggregate'
import { count, money } from './jsonl'
import { HistoryFailure } from './history-resource'

const columns = { input:'tokens_input', output:'tokens_output', reasoning:'tokens_reasoning', cacheRead:'tokens_cache_read', cacheWrite:'tokens_cache_write', cost:'cost' } as const
const integer = (value: unknown) => count(typeof value === 'bigint' ? Number(value) : value)

/** Session counters from OpenCode 1.18.31, using a read-only WAL-aware snapshot. */
export async function readOpenCode(path:string, period:AgentPeriod, now=Date.now()):Promise<HistoryData> {
  const info = await stat(path)
  if (!info.isFile()) throw new HistoryFailure('invalid')
  let db:DatabaseSync|undefined
  try {
    db = new DatabaseSync(path,{readOnly:true})
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500; BEGIN')
    const schema = db.prepare('PRAGMA table_info(session)').all()
    const required = { id:'TEXT', time_updated:'INTEGER', ...Object.fromEntries(Object.values(columns).map(name=>[name,name==='cost'?'REAL':'INTEGER'])) }
    if (!Object.entries(required).every(([name,type])=>schema.some(col=>col.name===name&&String(col.type).toUpperCase()===type))) throw new HistoryFailure('unsupported')
    const query = db.prepare(`SELECT id,time_updated,${Object.values(columns).join(',')} FROM session${period==='all'?'':' WHERE time_updated>=?'}`)
    query.setReadBigInts(true)
    const values:TokenMetrics[]=[]
    let issues=0,latest:number|null=null
    for (const row of query.iterate(...(period==='all'?[]:[now-Number(period)*86_400_000]))) {
      const time=integer(row.time_updated)
      if (typeof row.id!=='string'||!row.id||time===null||time>8.64e15) { issues++;continue }
      const metrics=blankMetrics()
      for(const [key,column] of Object.entries(columns) as [keyof typeof columns,string][]) {
        metrics[key]=key==='cost'?money(row[column]):integer(row[column])
        if(metrics[key]===null)issues++
      }
      metrics.total=sum([metrics.input,metrics.output,metrics.reasoning,metrics.cacheRead,metrics.cacheWrite])
      if(metrics.total===null&&Object.keys(columns).filter(k=>k!=='cost').every(k=>metrics[k as keyof TokenMetrics]!==null))issues++
      values.push(metrics);latest=Math.max(latest??0,time)
    }
    const totals=blankMetrics()
    for(const key of Object.keys(totals) as (keyof TokenMetrics)[]) {
      totals[key]=values.length?sum(values.map(value=>value[key]),key!=='cost'):issues?null:0
      if(values.length&&totals[key]===null&&values.every(value=>value[key]!==null))issues++
    }
    return {totals,days:[],sessions:values.length,records:values.length,issues,partial:issues>0,sampledAt:latest,period,semantics:'updated_sessions',limitations:['Native OpenCode session counters, with separate reasoning and cache. Copied fork messages and parts are not added again.', 'USD costs reported by OpenCode, not invoices. Deleted sessions and other databases are excluded.']}
  } catch(error) {
    if(error instanceof HistoryFailure)throw error
    const code=(error as {errcode?:number}).errcode
    throw new HistoryFailure(code!==undefined&&[5,6].includes(code&255)?'busy':code!==undefined&&[11,26].includes(code&255)?'invalid':code!==undefined&&[3,8,14,23].includes(code&255)?'denied':'unavailable')
  } finally { db?.close() }
}
