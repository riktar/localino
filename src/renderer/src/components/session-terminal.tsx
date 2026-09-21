import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

/** Display-only virtual terminal; actions remain typed Localino controls. */
export function SessionTerminal({ sessionId }: { sessionId: string }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const host = container.current!
    const viewId = crypto.randomUUID()
    let disposed = false, sequence = 0
    let writes = Promise.resolve()
    const terminal = new Terminal({
      cols: 60, rows: 12, disableStdin: true, convertEol: true,
      fontFamily: 'Cascadia Mono, Menlo, Consolas, monospace', fontSize: 12,
      scrollback: 1000, screenReaderMode: true,
    })
    terminal.open(host)
    // No hyperlink/clipboard addons. Explicitly consume these OSC codes too.
    const guards = [8, 52].map(code => terminal.parser.registerOscHandler(code, () => true))
    const theme = () => {
      const style = getComputedStyle(host)
      terminal.options.theme = { background: style.getPropertyValue('--card').trim(), foreground: style.getPropertyValue('--foreground').trim(), selectionBackground: '#8587ff55' }
    }
    theme()
    const offTheme = window.localino.onTheme(theme)
    const off = window.localino.onTerminalFrame(frame => {
      if (disposed || frame.viewId !== viewId || frame.sessionId !== sessionId) return
      if (frame.error) { setError(frame.error); return }
      if (frame.sequence !== sequence + 1) { setError('Output interrupted. Reopen this session.'); return }
      sequence = frame.sequence
      // xterm parses writes asynchronously; finish old bytes before a repaint.
      writes = writes.then(() => new Promise<void>(resolveWrite => {
        if (disposed) { resolveWrite(); return }
        if (frame.reset) { terminal.reset(); terminal.resize(frame.columns!, frame.rows!) }
        terminal.write(frame.data, resolveWrite)
      }))
    })
    const resize = () => {
      const columns = Math.max(10, Math.min(240, Math.floor((host.clientWidth - 20) / 7.3)))
      void window.localino.openTerminal({ sessionId, viewId, columns, rows: 12 }).catch(() => { if (!disposed) setError('Terminal unavailable. Reopen this session.') })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => {
      disposed = true; observer.disconnect(); off(); offTheme(); guards.forEach(guard => guard.dispose()); terminal.dispose()
      void window.localino.closeTerminal(viewId)
    }
  }, [sessionId])
  return <div className="session-terminal" aria-label="Session terminal">
    <div ref={container} className="session-terminal-viewport" />
    {error && <p role="alert">{error}</p>}
  </div>
}
