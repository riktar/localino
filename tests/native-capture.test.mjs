import test from 'node:test'
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {panelPage,packagedExecutable,waitFor} from './helpers.mjs'

test('real native selection and focus from an owned external textarea, without a physical gesture claim',{timeout:30000},async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const root=await mkdtemp(resolve('test-results/profiles/native-selection-'))
  const entry=join(root,'source.cjs')
  await writeFile(entry,`const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-renderer-accessibility');app.whenReady().then(async()=>{app.setAccessibilitySupportEnabled(true);const w=new BrowserWindow({width:600,height:300,title:'Synthetic capture source'});await w.loadURL('data:text/html,<textarea aria-label="Synthetic selection" autofocus style="width:95%;height:200px"></textarea>')})`)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const packaged=process.env.LOCALINO_TEST_PACKAGED==='1'
  const app=await electron.launch({...(packaged?{executablePath:packagedExecutable(),args:['--user-data-dir='+join(root,'localino')]}:{args:['.','--user-data-dir='+join(root,'localino')]}),env})
  let source
  try{
    const page=await panelPage(app)
    await waitFor(page,async()=>['ready','error'].includes((await window.localino.getCaptureStatus()).status))
    assert.equal((await page.evaluate(()=>window.localino.getCaptureStatus())).status,'ready','Grant capture permissions and retry this native check.')
    const clipboardBefore=await app.evaluate(({clipboard})=>clipboard.readText())
    await page.evaluate(()=>window.localino.hide())
    source=await electron.launch({args:[entry,'--user-data-dir='+join(root,'source')],env})
    const external=await source.firstWindow(),text='Native selection 🌱\nSeconda riga è 漢字'
    await external.getByRole('textbox').fill(text)
    await external.getByRole('textbox').evaluate(el=>{el.focus();el.select()})
    const origin=await source.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();const b=w.getNativeWindowHandle();return {handle:String(b.length===8?b.readBigUInt64LE():b.readUInt32LE()),pid:process.pid}})
    const native=packaged?resolve(dirname(packagedExecutable()),process.platform==='darwin'?'../Resources/native':'resources/native'):resolve('out/native')
    await promisify(execFile)(join(native,'Localino.Capture'+(process.platform==='win32'?'.exe':'')),['--focus',origin.handle,String(origin.pid)],{windowsHide:true})
    await page.evaluate(()=>window.localino.requestCapture())
    await waitFor(page,async()=>(await window.localino.getNotes()).notes.length===1,8000)
    assert.equal((await page.evaluate(()=>window.localino.getNotes())).notes[0].text,text)
    await page.locator('[data-note-text]').waitFor()
    assert.equal(await page.locator('[data-note-text]').textContent(),text)
    assert.equal(await external.getByRole('textbox').inputValue(),text)
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),clipboardBefore)
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).isFocused()),true)
    await waitFor(page,async()=>(await window.localino.getCapturedNote())?.visibleMs!==undefined)
    const result=await page.evaluate(()=>window.localino.getCapturedNote())
    await writeFile('test-results/native-capture-'+(packaged?'packaged':'development')+'.json',JSON.stringify({platform:process.platform,arch:process.arch,packaged,source:'owned external Electron textarea with accessibility enabled',trigger:'IPC, not physical double Shift',exact:true,clipboardUnchanged:true,elapsedMs:result.elapsedMs,visibleMs:result.visibleMs}))
  }finally{if(source)await source.close();const timer=setTimeout(()=>app.process().kill(),3000);try{await app.close()}finally{clearTimeout(timer)}}
})
