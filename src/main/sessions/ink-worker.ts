import { parentPort } from 'node:worker_threads'
import { InkViewport } from './ink-viewport'
import type { TerminalLine, TerminalViewport } from '../../shared/terminal'

export type InkRequest = { type: 'open' | 'update'; viewport: TerminalViewport; lines: TerminalLine[] }
  | { type: 'close'; viewId: string }
  | { type: 'dispose' }

type Update = Extract<InkRequest, { viewport: TerminalViewport }>
const views = new Map<string, { ink: InkViewport; deactivate: () => void; viewport: TerminalViewport }>()
const pending = new Map<string, Update>()
let timer: NodeJS.Timeout | undefined
let disposing = false
parentPort!.on('message', async (request: InkRequest) => {
  if (disposing) return
  if (request.type === 'dispose') {
    disposing = true
    if (timer) clearTimeout(timer)
    pending.clear()
    for (const view of views.values()) view.deactivate()
    await Promise.all([...views.values()].map(view => view.ink.dispose()))
    views.clear(); parentPort!.close(); return
  }
  if (request.type === 'close') {
    pending.delete(request.viewId)
    const view = views.get(request.viewId); views.delete(request.viewId)
    view?.deactivate()
    await view?.ink.dispose(); return
  }
  pending.set(request.viewport.viewId, request)
  if (!timer) timer = setTimeout(() => {
    timer = undefined
    const updates = [...pending.values()]; pending.clear()
    for (const update of updates) apply(update)
  }, 34)
})

function apply(request: Update): void {
  const { viewport, lines } = request
  let view = views.get(viewport.viewId)
  if (!view) {
    let sequence = 0, active = true
    let buffer = '', flush: NodeJS.Immediate | undefined
    const ink = new InkViewport(viewport.columns, viewport.rows, lines, data => {
      if (!active) return
      buffer += data
      if (!flush) flush = setImmediate(() => {
        flush = undefined
        if (active) parentPort!.postMessage({ sessionId: viewport.sessionId, viewId: viewport.viewId, sequence: ++sequence, data: buffer })
        buffer = ''
      })
    })
    view = { ink, deactivate: () => { active = false; if (flush) clearImmediate(flush); buffer = '' }, viewport }; views.set(viewport.viewId, view)
  } else {
    view.ink.resize(viewport.columns, viewport.rows); view.ink.update(lines); view.viewport = viewport
  }
}
