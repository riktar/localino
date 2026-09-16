import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') throw new Error('La cattura nativa richiede una build Windows.')
const framework = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
const refs = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Reference Assemblies', 'Microsoft', 'Framework', '.NETFramework', 'v4.8')
mkdirSync('out/native', { recursive: true })
const result = spawnSync(join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${resolve('out/native/Localino.Capture.exe')}`,
  ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => `/reference:${join(refs, name + '.dll')}`),
  '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', resolve('native/ShiftGesture.cs'), resolve('native/CaptureHelper.cs')], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
