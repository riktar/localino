export function isTrustedSender(sender: Electron.WebContents, frame: Electron.WebFrameMain | null, allowed: Electron.WebContents[]): boolean {
  return allowed.includes(sender) && !sender.isDestroyed() && frame === sender.mainFrame
}
