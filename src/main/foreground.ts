import { spawn } from 'node:child_process'

/** One bounded native operation; callers supply only an owned BrowserWindow handle. */
export class Foreground {
  private children = new Set<ReturnType<typeof spawn>>()
  constructor(private executable: string) {}
  focus(handle: Buffer, pid: number): Promise<boolean> {
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
    return new Promise(resolve => {
      const child = spawn(this.executable, ['--focus', hwnd, String(pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      this.children.add(child)
      let output = ''; let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true; clearTimeout(timer); this.children.delete(child); resolve(ok)
      }
      const timer = setTimeout(() => { child.kill(); finish(false) }, 800)
      child.stdout?.on('data', data => { output += data; if (output.length > 64) { child.kill(); finish(false) } })
      child.on('error', () => finish(false))
      child.on('close', code => finish(code === 0 && output.trim() === 'focused'))
    })
  }
  dispose(): void { for (const child of this.children) child.kill(); this.children.clear() }
}
