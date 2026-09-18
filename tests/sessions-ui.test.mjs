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
    await page.evaluate(()=>window.localino.hide())
    assert.equal((await page.evaluate(()=>window.localino.getLiveSessions())).sessions[0].status,'idle')
    await page.evaluate(()=>window.localino.openDashboard())
    await page.getByRole('button',{name:/Stop project-/}).click()
    await page.waitForFunction(()=>window.localino.getLiveSessions().then(state=>state.sessions[0]?.status==='stopped'))
    assert.equal(await page.locator('[data-session-id]').count(),0)
    assert.deepEqual(await page.evaluate(()=>window.localino.stopLiveSession('../bad')),{ok:false,error:'Session not found.'})
  }finally{await app.close()}
})
