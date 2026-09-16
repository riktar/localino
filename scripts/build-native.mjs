import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

mkdirSync('out/native', { recursive: true })
if (process.platform === 'darwin') {
  const arch = process.env.LOCALINO_ARCH || process.arch
  if (!['arm64','x64'].includes(arch)) throw Error('Unsupported macOS architecture: '+arch)
  const target = arch === 'x64' ? 'x86_64' : 'arm64'
  for (const name of ['Capture','StatusLine']) {
    const output=resolve('out/native/Localino.'+name)
    const result=spawnSync('xcrun',['clang','-fobjc-arc','-fblocks','-O2','-arch',target,'-mmacosx-version-min=13.0',...['Foundation',...(name==='Capture'?['AppKit','ApplicationServices','Carbon']:[])].flatMap(f=>['-framework',f]),resolve('native/mac/'+name+'Helper.m'),'-o',output],{stdio:'inherit'})
    if(result.error)throw result.error
    if(result.status!==0)process.exit(result.status||1)
    const sign=spawnSync('codesign',['--force','--sign',process.env.LOCALINO_SIGN_IDENTITY||'-','--identifier','app.localino.'+name.toLowerCase(),output],{stdio:'inherit'})
    if(sign.error)throw sign.error
    if(sign.status!==0)process.exit(sign.status||1)
  }
  process.exit(0)
}
if (process.platform !== 'win32') throw new Error('Localino supports Windows and macOS.')
const framework = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
const refs = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Reference Assemblies', 'Microsoft', 'Framework', '.NETFramework', 'v4.8')
mkdirSync('out/native', { recursive: true })
const result = spawnSync(join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${resolve('out/native/Localino.Capture.exe')}`,
  ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => `/reference:${join(refs, name + '.dll')}`),
  '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', resolve('native/ShiftGesture.cs'), resolve('native/CaptureHelper.cs')], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
const bridge = spawnSync(join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${resolve('out/native/Localino.StatusLine.exe')}`, '/reference:System.Web.Extensions.dll', resolve('native/StatusLineHelper.cs'),resolve('native/SettingsTransaction.cs')], { stdio: 'inherit', windowsHide: true })
if (bridge.error) throw bridge.error
if (bridge.status !== 0) process.exit(bridge.status || 1)
