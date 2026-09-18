import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { chmod,mkdir,mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mainPage } from './helpers.mjs'

test('supervised session starts for a chosen project, survives window hiding and stops explicitly',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/live-session-')),project=await mkdtemp(resolve('test-results/profiles/project-'))
  const fixture=resolve(process.platform==='win32'?'tests/fixtures/session-agent.cmd':'tests/fixtures/session-agent.mjs')
  if(process.platform!=='win32')await chmod(fixture,0o755)
  const env={...process.env,LOCALINO_CODEX_PATH:fixture};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try{
    const page=await mainPage(app)
    await page.locator('[data-live-sessions="codex"]').getByText(/CLI available|localino-session-fixture/).waitFor()
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},project)
    await page.getByRole('button',{name:'Start session',exact:true}).click()
    const card=page.locator('[data-session-id]');await card.waitFor();await card.locator('[data-session-status="idle"]').waitFor()
    assert.match(await card.innerText(),/project-/)
    await page.getByRole('button',{name:'Start session',exact:true}).click();await page.locator('[data-session-id]').nth(1).waitFor();await page.locator('[data-session-status="idle"]').nth(1).waitFor()
    const instances=await page.locator('[data-session-instance]').allInnerTexts(),stopNames=await page.getByRole('button',{name:/Stop project-/}).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))
    assert.equal(new Set(instances).size,2);assert.equal(new Set(stopNames).size,2)
    await card.first().press('Enter')
    const composer=card.first().getByRole('textbox',{name:/Message for/}),message='prima riga\nUnicode 🧪 🌍'
    await composer.fill(message);assert.equal(await composer.inputValue(),message)
    await card.first().getByRole('button',{name:'Send',exact:true}).dblclick()
    await card.first().locator('[data-delivery-status="sent"]').waitFor()
    assert.equal(await card.first().locator('[data-delivery-status]').count(),1)
    assert.equal(await card.nth(1).locator('[data-delivery-status]').count(),0)
    await page.waitForFunction(()=>window.localino.getLiveSessions().then(state=>state.sessions.filter(session=>session.status==='idle').length===2))
    await page.evaluate(()=>window.localino.hide())
    assert.equal((await page.evaluate(()=>window.localino.getLiveSessions())).sessions.filter(session=>session.status!=='stopped').length,2)
    await page.evaluate(()=>window.localino.openDashboard())
    await page.getByRole('button',{name:/Stop project-/}).first().click()
    await page.waitForFunction(()=>window.localino.getLiveSessions().then(state=>state.sessions.filter(session=>session.status==='stopped').length===1))
    await page.waitForFunction(()=>document.querySelectorAll('[data-session-id]').length===1)
    assert.equal(await page.locator('[data-session-id]').count(),1)
    assert.deepEqual(await page.evaluate(()=>window.localino.stopLiveSession('../bad')),{ok:false,error:'Session not found.'})
  }finally{await app.close()}
})

test('a draft survives restart as suspended text and never starts a replacement session',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/live-recovery-')),project=await mkdtemp(resolve('test-results/profiles/recovery-project-')),fixture=resolve(process.platform==='win32'?'tests/fixtures/session-agent.cmd':'tests/fixtures/session-agent.mjs')
  if(process.platform!=='win32')await chmod(fixture,0o755)
  const env={...process.env,LOCALINO_CODEX_PATH:fixture};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const first=await electron.launch({args:['.',`--user-data-dir=${profile}`],env});const text='bozza\nnon inviata 🧪'
  try{
    const page=await mainPage(first);await page.locator('[data-live-sessions="codex"]').getByText(/CLI available|localino-session-fixture/).waitFor();await first.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},project)
    await page.getByRole('button',{name:'Start session',exact:true}).click();const card=page.locator('[data-session-id]');await card.locator('[data-session-status="idle"]').waitFor();await card.press('Enter');await card.getByRole('textbox',{name:/Message for/}).fill(text)
    await page.waitForFunction(expected=>window.localino.getLiveSessions().then(state=>state.sessions[0]?.draft===expected),text)
  }finally{await first.close()}
  const second=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try{
    const page=await mainPage(second);await page.getByText('Recovered drafts and undelivered messages').waitFor();assert.equal(await page.getByText(text,{exact:true}).count(),1)
    const state=await page.evaluate(()=>window.localino.getLiveSessions());assert.equal(state.sessions.length,0);assert.equal(state.recovered.length,1)
  }finally{await second.close()}
})
