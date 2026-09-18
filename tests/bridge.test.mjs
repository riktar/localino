import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {mainPage,packagedExecutable} from './helpers.mjs'

test('Claude bridge opt-in, passive tray delivery, IPC whitelist and restore in distributed UI',async()=>{
  await mkdir('test-results/profiles',{recursive:true})
  const root=await mkdtemp(resolve('test-results/profiles/bridge-')),profile=join(root,'profilo è'),claude=join(root,'Claude settings è')
  await mkdir(claude);const settings=join(claude,'settings.json'),original={env:{UNRELATED:'keep'},statusLine:{type:'command',command:'printf prior',padding:2}}
  await writeFile(settings,JSON.stringify(original))
  const env={...process.env,CLAUDE_CONFIG_DIR:claude};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const packaged=process.env.LOCALINO_TEST_PACKAGED==='1'
  const app=await electron.launch({...(packaged?{executablePath:packagedExecutable(),args:[`--user-data-dir=${profile}`]}:{args:['.',`--user-data-dir=${profile}`]}),env})
  const control=join(profile,'claude-bridge','control.json')
  const invoke=async input=>{
    const config=JSON.parse(await readFile(control,'utf8'))
    return new Promise((resolve,reject)=>{const child=spawn(process.platform==='darwin'?'/bin/bash':'powershell.exe',process.platform==='darwin'?['-c',config.installed.command]:config.installed.command.split(' ').slice(1),{env:{...env,PATH:process.platform==='darwin'?'/usr/bin:/bin':process.env.SystemRoot+'\\System32;'+process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0'},windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[];child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.resume();child.on('error',reject);child.on('close',code=>resolve({code,output:Buffer.concat(chunks).toString()}));child.stdin.end(JSON.stringify(input))})
  }
  try{
    const page=await mainPage(app);await page.evaluate(()=>window.localino.selectAgent('claude'))
    await page.getByText('Session quota bridge',{exact:true}).click()
    const card=page.getByRole('region',{name:'Claude status line quotas'})
    await card.waitFor();assert.deepEqual(JSON.parse(await readFile(settings,'utf8')),original)
    await card.getByRole('button',{name:'Enable bridge',exact:true}).click()
    await card.getByRole('button',{name:'Disable bridge',exact:true}).waitFor()
    assert.equal((await page.evaluate(()=>window.localino.getHistory('claude'))).enabled,false)
    await assert.rejects(page.evaluate(()=>window.localino.setBridgeEnabled('yes')))
    await app.evaluate(({Tray})=>{const old=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.bridgeMenu=menu;return old.call(this,menu)}})
    await page.evaluate(()=>window.localino.hide())
    const result=await invoke({session_id:'synthetic-latest',cost:{total_cost_usd:1.25},rate_limits:{five_hour:{used_percentage:12.5,resets_at:1},spend_limit:{used_percentage:125,resets_at:null}},cwd:'PRIVATE-SENTINEL',transcript_path:'PRIVATE-SENTINEL',context_window:{total_input_tokens:999}})
    assert.equal(result.code,0);assert.equal(result.output,'prior')
    const wait=async predicate=>{const end=Date.now()+3000;while(Date.now()<end){const state=await page.evaluate(()=>window.localino.getBridge());if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Bridge delivery timeout')}
    let state=await wait(s=>s.sessionId==='synthetic-latest');assert.ok(Date.now()-state.receivedAt<1000)
    assert.ok(!JSON.stringify(state).includes('PRIVATE-SENTINEL'));assert.equal(state.cost,1.25);assert.equal(state.quotas.data.buckets[0].windows[0].usedPercent,12.5)
    assert.ok(await app.evaluate(()=>globalThis.bridgeMenu.items.some(item=>item.label==='Open Localino')))
    await page.evaluate(()=>window.localino.openDashboard());await card.locator('[data-bucket="spend_limit"]').waitFor();assert.match(await card.innerText(),/125% used/)
    await page.screenshot({path:'test-results/bridge-ui.png'})
    await invoke({session_id:'without-quota'});state=await wait(s=>s.sessionId==='without-quota');assert.equal(state.cost,null);assert.equal(state.quotas.data.buckets.length,0)
    await card.getByRole('button',{name:'Disable bridge',exact:true}).click();await card.getByRole('button',{name:'Enable bridge',exact:true}).waitFor();await wait(s=>!s.enabled);assert.deepEqual(JSON.parse(await readFile(settings,'utf8')),original)
    assert.equal((await page.evaluate(()=>window.localino.getBridge())).sessionId,null)
    console.log(JSON.stringify({bridge:'native helper + packaged UI',packaged,privacy:true,restore:true}))
  }finally{await app.close()}
})
