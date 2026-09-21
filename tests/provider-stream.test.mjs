import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'
import { mainPage } from './helpers.mjs'

test('owned Codex stream delivers 1000 deltas/s through durable storage and Ink with responsive input', {timeout:60000},async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const profile=await mkdtemp(resolve('test-results/profiles/stream-')),project=await mkdtemp(resolve('test-results/profiles/stream-project-'))
  const env={...process.env,LOCALINO_CODEX_PATH:resolve(process.platform==='win32'?'tests/fixtures/session-agent.cmd':'tests/fixtures/session-agent.mjs')}
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env})
  try{
    const page=await mainPage(app)
    await page.locator('[data-live-sessions="codex"]').getByText(/CLI available|localino-session-fixture/).waitFor()
    await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]})},project)
    await page.getByRole('button',{name:'Start session',exact:true}).click()
    const card=page.locator('[data-session-id]');await card.locator('[data-session-status="idle"]').waitFor();await card.press('Enter')
    await card.locator('.xterm-screen').waitFor()
    await page.evaluate(()=>{
      window.streamMetrics={visible:[],input:[],frames:[],lastIndex:-1}
      const metrics=window.streamMetrics,host=document.querySelector('.xterm-rows'),textbox=document.querySelector('textarea'),start=performance.now()
      let last=start
      const observer=new MutationObserver(()=>{
        const text=host.textContent;for(const match of text.matchAll(/SEQ(\d+) AT(\d+)/g)){const index=Number(match[1]);if(index>metrics.lastIndex){metrics.lastIndex=index;metrics.visible.push(Date.now()-Number(match[2]))}}
      });observer.observe(host,{subtree:true,childList:true,characterData:true})
      const tick=()=>{const now=performance.now();metrics.frames.push(now-last);last=now;if(now-start<20000)requestAnimationFrame(tick);else observer.disconnect()};requestAnimationFrame(tick)
      const timer=setInterval(()=>{const then=performance.now();textbox.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'}));host.scrollTop=host.scrollHeight;requestAnimationFrame(()=>metrics.input.push(performance.now()-then));if(performance.now()-start>20000)clearInterval(timer)},50)
    })
    await card.getByRole('textbox',{name:/Message for/}).fill('LOCALINO_STREAM_FIXTURE')
    await card.getByRole('button',{name:'Send',exact:true}).click()
    await page.waitForFunction(()=>window.streamMetrics.lastIndex>=4990,{},{timeout:30000}).catch(async error=>{console.log(JSON.stringify(await page.evaluate(()=>({samples:window.streamMetrics.visible.length,lastIndex:window.streamMetrics.lastIndex,terminal:document.querySelector('.xterm-accessibility')?.textContent?.slice(-1000)}))));throw error})
    await card.locator('[data-session-status="idle"]').waitFor()
    await page.waitForTimeout(150)
    const metrics=await page.evaluate(()=>window.streamMetrics)
    const p95=values=>values.sort((a,b)=>a-b)[Math.floor(values.length*.95)]
    const result={visibleSamples:metrics.visible.length,visibleP95:p95(metrics.visible),inputP95:p95(metrics.input),frameP95:p95(metrics.frames)}
    assert.ok(result.visibleSamples>=30,JSON.stringify(result));assert.ok(result.visibleP95<=250,JSON.stringify(result));assert.ok(result.inputP95<=100,JSON.stringify(result))
    const sessionId=await card.getAttribute('data-session-id'),root=join(profile,'transcripts',sessionId)
    const files=(await readdir(root)).filter(name=>name.endsWith('.jsonl')).sort();let count=0
    for(const file of files)for await(const line of createInterface({input:createReadStream(join(root,file)),crlfDelay:Infinity})){
      const event=JSON.parse(line).event
      if(event.kind==='assistant'&&event.operation==='append'){
        assert.match(event.text,new RegExp(`SEQ${String(count).padStart(6,'0')} AT\\d+`));assert.equal(event.offset,(count%100)*event.text.length);assert.equal(event.disposition,'applied');count++
      }
    }
    assert.equal(count,5000)
    assert.equal((await readFile(join(root,'session.json'),'utf8')).includes('PRIVATE_STDERR'),false)
    console.log(JSON.stringify({streamDeltas:count,...result}))
  }finally{await app.close()}
})
