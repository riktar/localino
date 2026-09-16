/** Names are shared by development and packaged builds. Never launch a Windows helper on macOS. */
export function nativeHelper(name: 'Capture' | 'StatusLine', platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' && platform !== 'darwin') throw new Error('Localino supports Windows and macOS.')
  return `Localino.${name}${platform === 'win32' ? '.exe' : ''}`
}
