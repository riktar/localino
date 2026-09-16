import test from 'node:test'
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
import {cp,mkdir,mkdtemp,writeFile,rename,chmod} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {once} from 'node:events'

const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
const helperName='Localino.Capture'+(process.platform==='win32'?'.exe':'')
async function prepare(fixture=true){
  await mkdir('test-results/profiles',{recursive:true});const root=await mkdtemp(resolve('test-results/profiles/capture-')),application=join(root,'app'),profile=join(root,'profile')
  await cp('out',join(application,'out'),{recursive:true});await writeFile(join(application,'package.json'),JSON.stringify({name:'capture-test',version:'1.0.0',main:'out/main/index.js'}))
  const executable=join(application,'out/native',helperName)
  if(fixture){
    if(process.platform==='win32'){
      const build=spawnSync(join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe',`/out:${executable}`,'/reference:System.Web.Extensions.dll',resolve('tests/fixtures/capture-helper.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(build.status,0,build.stdout)
    }else{await cp('tests/fixtures/capture-helper.mjs',executable);await chmod(executable,0o755)}
  }
  return {root,application,profile,executable}
}
async function launch(setup){const app=await electron.launch({args:[setup.application,'--user-data-dir='+setup.profile],env}),page=await app.firstWindow();page.setDefaultTimeout(7000);await page.locator('[data-clipboard]').waitFor();return {app,page}}
async function close(app){const timer=setTimeout(()=>app.process().kill(),3000);try{await app.close()}finally{clearTimeout(timer)}}
async function wait(page,predicate){const end=Date.now()+7000;while(Date.now()<end){if(await page.evaluate(predicate))return;await new Promise(r=>setTimeout(r,20))}throw Error('Condition timed out')}
const expected='Prova Localino 🌱\nSeconda riga è 漢字'

test('native gesture self-test and bounded start/disable/EOF protocol; no external gesture simulated',async()=>{
  const binary=resolve('out/native',helperName),self=spawnSync(binary,['--self-test'],{windowsHide:true,encoding:'utf8'})
  assert.equal(self.status,0,self.stderr);assert.match(self.stdout,/gesture-tests-ok/)
  const child=spawn(binary,[],{windowsHide:true,stdio:'pipe'});let output='';child.stdout.on('data',data=>{output+=data})
  const wait=async pattern=>{const end=Date.now()+5000;while(!pattern.test(output)&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.match(output,pattern)}
  try{await wait(/"type"\s*:\s*"ready"/);child.stdin.write('disable\n');await wait(/"enabled"\s*:\s*false/);child.stdin.write('enable\n');await wait(/"enabled"\s*:\s*true/);const exited=once(child,'exit');child.stdin.end();await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('EOF timeout')),5000).unref())])}finally{if(child.exitCode===null)child.kill()}
})
test('capture autosaves once in the panel and suspends the exact manual draft',async()=>{
  const setup=await prepare(),{app,page}=await launch(setup)
  try{
    await wait(page,async()=>(await window.localino.getCaptureStatus()).status==='ready')
    await page.getByRole('button',{name:'New note',exact:true}).click();const editor=page.getByRole('textbox',{name:'Note text'});await editor.fill('Manual draft 🌱\nLine 2')
    await page.evaluate(()=>Promise.all(Array.from({length:5},()=>window.localino.requestCapture())))
    await page.locator('.note-row.selected').waitFor();assert.equal(await page.locator('.note-row.selected button[aria-label^="Read note"] span').first().textContent(),expected)
    assert.equal(await page.getByRole('region',{name:'Note details'}).count(),0)
    assert.equal(await page.locator('.note-row.selected input').isChecked(),true)
    await wait(page,async()=>await window.localino.getCaptureDraft()===null)
    assert.equal(await page.locator('.note-row.selected input').evaluate(el=>el===document.activeElement),true)
    assert.equal((await page.evaluate(()=>window.localino.getNotes())).notes.length,1);assert.equal(app.windows().length,1)
    await page.getByRole('button',{name:'Resume draft'}).click();assert.equal(await editor.inputValue(),'Manual draft 🌱\nLine 2')
    await page.getByRole('button',{name:'Save',exact:true}).click();await wait(page,async()=>(await window.localino.getNotes()).notes.length===2)
    await page.getByRole('button',{name:'Search and filter'}).click();await page.getByRole('searchbox',{name:'Search notes'}).fill('no matching capture');await page.getByRole('combobox',{name:'Show notes'}).selectOption('completed')
    await page.evaluate(()=>window.localino.requestCapture());await wait(page,async()=>(await window.localino.getNotes()).notes.length===3)
    await wait(page,async()=>await window.localino.getCaptureDraft()===null)
    assert.equal(await page.getByRole('searchbox',{name:'Search notes'}).inputValue(),'')
    assert.equal(await page.getByRole('combobox',{name:'Show notes'}).inputValue(),'open')
    assert.equal(await page.locator('.note-row').first().getAttribute('class').then(v=>v.includes('selected')),true)
  }finally{await close(app)}
})
test('inline recovery preserves failed saves and Escape/Stay; foreign renderer cannot own capture',async()=>{
  const setup=await prepare();await mkdir(join(setup.profile,'notes.json'),{recursive:true});const {app,page}=await launch(setup)
  try{
    await wait(page,async()=>(await window.localino.getCaptureStatus()).status==='ready');await page.evaluate(()=>window.localino.requestCapture())
    const editor=page.getByRole('textbox',{name:'Capture text'});await editor.waitFor();assert.equal(await editor.inputValue(),expected)
    await editor.fill('Recovery edit 🌱');await page.getByRole('button',{name:'Hide panel'}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape')
    assert.equal(await editor.inputValue(),'Recovery edit 🌱');assert.notEqual(await page.evaluate(()=>window.localino.getCaptureDraft()),null)
    await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('alert').last().waitFor();assert.equal(await editor.inputValue(),'Recovery edit 🌱')
    await rename(join(setup.profile,'notes.json'),join(setup.profile,'unreadable-store'));await page.evaluate(()=>window.localino.reloadNotes())
    await page.getByRole('button',{name:'Save',exact:true}).click();await wait(page,async()=>await window.localino.getCaptureDraft()===null)
    assert.equal((await page.evaluate(()=>window.localino.getNotes())).notes[0].text,'Recovery edit 🌱')
    await writeFile(join(setup.application,'out/native/mode.txt'),'empty');await page.evaluate(()=>window.localino.requestCapture());await editor.waitFor();await editor.fill('Cancel safely')
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Stay',exact:true}).click();assert.equal(await editor.inputValue(),'Cancel safely')
    assert.equal(await editor.evaluate(el=>document.activeElement===el),true)
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();await wait(page,async()=>await window.localino.getCaptureDraft()===null)
    const opening=app.waitForEvent('window');await page.evaluate(()=>window.localino.openDashboard());const detail=await opening
    await assert.rejects(detail.evaluate(()=>window.localino.getCaptureDraft()))
  }finally{await close(app)}
})
test('missing helper keeps manual capture and notes usable',async()=>{
  const setup=await prepare(false);await rename(setup.executable,setup.executable+'.missing');const {app,page}=await launch(setup)
  try{await wait(page,async()=>(await window.localino.getCaptureStatus()).status==='error');await page.evaluate(()=>window.localino.requestCapture());const editor=page.getByRole('textbox',{name:'Capture text'});await editor.fill('Manual fallback');await page.getByRole('button',{name:'Save',exact:true}).click();await wait(page,async()=>await window.localino.getCaptureDraft()===null);assert.equal((await page.evaluate(()=>window.localino.getNotes())).notes[0].text,'Manual fallback')}finally{await close(app)}
})
