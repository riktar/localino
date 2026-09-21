import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ChatHistory } from '../../../shared/terminal'
import { Button } from './ui/button'
import '@xterm/xterm/css/xterm.css'

/** Display-only virtual terminal; actions remain typed Localino controls. */
export function SessionTerminal({ sessionId }: { sessionId: string }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [history,setHistory]=useState<ChatHistory>({sessionId,messages:[],hasEarlier:false})
  const [loadingEarlier,setLoadingEarlier]=useState(false)
  const [newOutput,setNewOutput]=useState(false)
  const terminalRef=useRef<Terminal|null>(null),followRef=useRef(true)
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
    terminalRef.current=terminal
    // No hyperlink/clipboard addons. Explicitly consume these OSC codes too.
    const guards = [8, 52].map(code => terminal.parser.registerOscHandler(code, () => true))
    const theme = () => {
      const style = getComputedStyle(host)
      terminal.options.theme = {
        background: style.getPropertyValue('--card').trim(), foreground: style.getPropertyValue('--foreground').trim(),
        cyan: style.getPropertyValue('--chat-user').trim(), brightCyan: style.getPropertyValue('--chat-user').trim(),
        green: style.getPropertyValue('--chat-assistant').trim(), brightGreen: style.getPropertyValue('--chat-assistant').trim(),
        selectionBackground: '#8587ff55',
      }
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
        terminal.write(frame.data,()=>{if(followRef.current)terminal.scrollToBottom();else setNewOutput(true);resolveWrite()})
      }))
    })
    const offHistory=window.localino.onChatHistory(next=>{if(next.sessionId===sessionId)setHistory(next)})
    const scroll=terminal.onScroll(()=>{followRef.current=terminal.buffer.active.viewportY>=terminal.buffer.active.baseY;if(followRef.current)setNewOutput(false)})
    const resize = () => {
      const columns = Math.max(10, Math.min(240, Math.floor((host.clientWidth - 20) / 7.3)))
      void window.localino.openTerminal({ sessionId, viewId, columns, rows: 12 }).then(()=>window.localino.getChatHistory(sessionId)).then(next=>{if(!disposed)setHistory(next)}).catch(() => { if (!disposed) setError('Terminal unavailable. Reopen this session.') })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => {
      disposed = true; observer.disconnect(); off(); offHistory(); offTheme(); scroll.dispose(); guards.forEach(guard => guard.dispose()); terminal.dispose();terminalRef.current=null
      void window.localino.closeTerminal(viewId)
    }
  }, [sessionId])
  const earlier=async()=>{setLoadingEarlier(true);try{setHistory(await window.localino.loadEarlierChat(sessionId))}catch{setError('Earlier messages could not be loaded.')}finally{setLoadingEarlier(false)}}
  const latest=()=>{followRef.current=true;terminalRef.current?.scrollToBottom();setNewOutput(false)}
  return <div className="session-terminal" aria-label="Session conversation">
    {history.hasEarlier&&<Button size="sm" variant="ghost" disabled={loadingEarlier} onClick={()=>void earlier()}>{loadingEarlier?'Loading…':'Load earlier messages'}</Button>}
    <div ref={container} className="session-terminal-viewport" />
    {newOutput&&<Button size="sm" className="mt-2" onClick={latest}>New messages</Button>}
    <ol className="sr-only" aria-label="Conversation messages">{history.messages.map((message,index)=><li key={`${message.role}-${index}`}><strong>{message.label}</strong><span>{message.text}</span></li>)}</ol>
    {error && <p role="alert">{error}</p>}
  </div>
}
