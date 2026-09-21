import { PassThrough, Writable } from 'node:stream'
import { createElement } from 'react'
import { Box, Text, render, type Instance } from 'ink'
import { terminalText, type TerminalLine } from '../../shared/terminal'

class VirtualOutput extends Writable {
  isTTY = true
  constructor(public columns: number, public rows: number, private readonly output: (data: string) => void) { super() }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { this.output(chunk.toString('utf8')); callback() }
}

/** An Ink instance owns its streams. No provider stdin, process stdout or console patching. */
export class InkViewport {
  private readonly stdout: VirtualOutput
  private readonly stderr: VirtualOutput
  private readonly stdin = Object.assign(new PassThrough(), { isTTY: false, setRawMode: () => {} })
  private readonly instance: Instance
  private disposed = false
  renders = 0
  renderMilliseconds = 0
  constructor(columns: number, rows: number, lines: TerminalLine[], output: (data: string) => void) {
    this.stdout = new VirtualOutput(columns, rows, output)
    this.stderr = new VirtualOutput(columns, rows, () => {})
    this.instance = render(this.tree(lines), {
      stdout: this.stdout as unknown as NodeJS.WriteStream,
      stderr: this.stderr as unknown as NodeJS.WriteStream,
      stdin: this.stdin as unknown as NodeJS.ReadStream,
      interactive: true, patchConsole: false, exitOnCtrlC: false, maxFps: 30,
      incrementalRendering: true, isScreenReaderEnabled: false,
      onRender: ({ renderTime }) => { this.renders++; this.renderMilliseconds += renderTime },
    })
  }
  private tree(lines: TerminalLine[]) {
    return createElement(Box, { flexDirection: 'column' }, ...lines.map((line, index) =>
      createElement(Box, { key: index, flexDirection: 'column' },
        createElement(Text, { bold: true }, terminalText(line.label)),
        createElement(Text, { wrap: 'wrap' }, terminalText(line.text)))))
  }
  update(lines: TerminalLine[]): void { if (!this.disposed) this.instance.rerender(this.tree(lines)) }
  resize(columns: number, rows: number): void {
    if (this.disposed) return
    this.stdout.columns = columns; this.stdout.rows = rows; this.stdout.emit('resize')
  }
  async flush(): Promise<void> { await this.instance.waitUntilRenderFlush() }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const exited = this.instance.waitUntilExit()
    this.instance.unmount()
    await exited
    this.instance.cleanup()
    this.stdin.destroy(); this.stdout.destroy(); this.stderr.destroy()
  }
}
