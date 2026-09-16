import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {ClaudeBridge,updateBridgeSettings} from '../../src/main/agents/bridge'
import fs from 'node:fs/promises'

const helper=resolve('out/native/Localino.StatusLine.exe')
const payload=(id='session-A')=>({session_id:id,cwd:'PRIVATE-SENTINEL',transcript_path:'SECRET',context_window:{total_input_tokens:999999},cost:{total_cost_usd:0},rate_limits:{five_hour:{used_percentage:0,resets_at:1},seven_day:{used_percentage:40,resets_at:1800000000},spend_limit:{used_percentage:125,resets_at:null}}})
const run=(exe:string,args:string[],input:Buffer)=>new Promise<{code:number|null;output:Buffer}>( (resolve,reject)=>{
  const child=spawn(exe,args,{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[]
  child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.resume();child.on('error',reject);child.on('close',code=>resolve({code,output:Buffer.concat(chunks)}));child.stdin.end(input)
})
const setup=async(previous?:unknown)=>{
  const root=await mkdtemp(join(tmpdir(),'localino-bridge-è ')),settings=join(root,'settings.json'),dir=join(root,'localino')
  await writeFile(settings,JSON.stringify({env:{SECRET:'must-not-be-backed-up'},...(previous?{statusLine:previous}:{})}))
  const bridge=new ClaudeBridge(dir,settings,helper);await bridge.start()
  return {root,settings,dir,bridge}
}

test('opt-in, native whitelist, last session, invalid payload, stale/reset and reversible settings',async()=>{
  const {bridge,settings,dir}=await setup({type:'command',command:'printf existing',padding:3,refreshInterval:8})
  try{
    const original=JSON.parse(await readFile(settings,'utf8'));assert.equal(bridge.state.enabled,false)
    assert.deepEqual(await bridge.setEnabled(true),{ok:true});const installed=await readFile(settings,'utf8')
    assert.deepEqual(await bridge.setEnabled(true),{ok:true});assert.equal(await readFile(settings,'utf8'),installed)
    assert.ok(!(await readFile(bridge.configPath,'utf8')).includes('must-not-be-backed-up'))
    const result=await run(helper,[bridge.configPath],Buffer.from(JSON.stringify(payload())))
    assert.equal(result.code,0);assert.equal(result.output.toString(),'existing')
    const cache=await readFile(join(dir,'snapshot.json'),'utf8');assert.ok(!cache.includes('PRIVATE-SENTINEL'));assert.ok(!cache.includes('context'));assert.ok(!cache.includes('SECRET'))
    await bridge.refresh();assert.equal(bridge.state.sessionId,'session-A');assert.equal(bridge.state.cost,0);assert.equal(bridge.state.quotas.data?.buckets[2].windows[0].usedPercent,125)
    assert.equal(bridge.state.quotas.data?.buckets[0].windows[0].resetsAt,1000)
    await run(helper,[bridge.configPath],Buffer.from('{invalid'));assert.equal(await readFile(join(dir,'snapshot.json'),'utf8'),cache)
    const invalid=payload();invalid.rate_limits.five_hour.used_percentage=101;await run(helper,[bridge.configPath],Buffer.from(JSON.stringify(invalid)));assert.equal(await readFile(join(dir,'snapshot.json'),'utf8'),cache)
    await Promise.all(['session-B','session-C'].map(id=>run(helper,[bridge.configPath],Buffer.from(JSON.stringify(payload(id))))))
    await bridge.refresh();assert.ok(['session-B','session-C'].includes(bridge.state.sessionId!))
    await bridge.refresh(bridge.state.receivedAt!+120001);assert.equal(bridge.state.quotas.stale,true);assert.equal(bridge.state.quotas.data?.buckets[1].windows[0].usedPercent,40)
    assert.deepEqual(await bridge.setEnabled(false),{ok:true});assert.deepEqual(JSON.parse(await readFile(settings,'utf8')),original)
    await run(helper,[bridge.configPath],Buffer.from(JSON.stringify(payload())));await assert.rejects(access(join(dir,'snapshot.json')))
    assert.equal(bridge.state.sessionId,null);assert.deepEqual(await bridge.setEnabled(false),{ok:true})
  }finally{bridge.dispose()}
})

test('native helper preserves exact stdin/stdout through installed Windows wrapper and works with broken cache, app closed',async()=>{
  const {bridge,dir}=await setup({type:'command',command:'cat',padding:1})
  try{
    assert.deepEqual(await bridge.setEnabled(true),{ok:true});bridge.dispose()
    const config=JSON.parse(await readFile(bridge.configPath,'utf8')),input=Buffer.from(JSON.stringify(payload())+'\r\n\t è 😀\u0000','utf8')
    const start=Date.now(),args=config.installed.command.split(' ').slice(1)
    const result=await run('powershell.exe',args,input)
    assert.equal(result.code,0);assert.deepEqual(result.output,input);assert.ok(Date.now()-start<1000,`wrapper overhead ${Date.now()-start}ms`)
    // Cache path is deliberately an existing directory. Prior command must still work.
    await mkdir(join(dir,'blocked'));config.cachePath=join(dir,'blocked');await writeFile(bridge.configPath,JSON.stringify(config))
    const valid=Buffer.from(JSON.stringify(payload()));const broken=await run(helper,[bridge.configPath],valid);assert.deepEqual(broken.output,valid);assert.equal(broken.code,0)
  }finally{bridge.dispose()}
})

test('restart, user conflict, managed/project overrides and invalid settings do not lose user changes',async()=>{
  const {root,bridge,settings,dir}=await setup()
  try{
    await bridge.setEnabled(true);bridge.dispose();const restored=new ClaudeBridge(dir,settings,helper);await restored.start()
    try{
      assert.equal(restored.state.enabled,true)
      const value=JSON.parse(await readFile(settings,'utf8'));value.statusLine={type:'command',command:'user changed'};value.extra='keep'
      await writeFile(settings,JSON.stringify(value));const result=await restored.setEnabled(false)
      assert.equal(result.ok,false);assert.match(result.error!,/conservata la modifica utente/);assert.equal(restored.state.enabled,false);assert.deepEqual(JSON.parse(await readFile(settings,'utf8')),value)
      await mkdir(join(root,'.claude'));await writeFile(join(root,'.claude','settings.local.json'),JSON.stringify({statusLine:{type:'command',command:'project'}}))
      assert.match(await restored.diagnose(root),/Override rilevato/)
    }finally{restored.dispose()}
    const managed=join(root,'managed.json');await writeFile(managed,JSON.stringify({statusLine:{command:'managed'}}))
    const policy=new ClaudeBridge(join(root,'managed-bridge'),settings,helper,[managed]);assert.equal((await policy.setEnabled(true)).ok,false);assert.match(policy.state.error!,/policy gestita/)
    await writeFile(settings,'invalid JSON');const invalid=new ClaudeBridge(join(root,'invalid-bridge'),settings,helper);assert.equal((await invalid.setEnabled(true)).ok,false);assert.equal(await readFile(settings,'utf8'),'invalid JSON')
  }finally{bridge.dispose()}
})

test('PowerShell previous command preserves bytes; missing quotas stay absent and interrupted configuration can recover',async()=>{
  const {bridge,settings,dir}=await setup()
  try{
    await bridge.setEnabled(true)
    const config=JSON.parse(await readFile(bridge.configPath,'utf8'))
    config.shell=join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe');config.shellKind='powershell'
    config.previous={type:'command',command:'[Console]::OpenStandardInput().CopyTo([Console]::OpenStandardOutput())'}
    await writeFile(bridge.configPath,JSON.stringify(config))
    const input=Buffer.from(JSON.stringify({session_id:'no-quota'})+'\n'),result=await run(helper,[bridge.configPath],input)
    assert.deepEqual(result.output,input);assert.equal(result.code,0);await bridge.refresh();assert.deepEqual(bridge.state.quotas.data?.buckets,[]);assert.equal(bridge.state.cost,null)
    // Simulate stop after installing settings but before enabling the control file.
    config.previous=null;config.enabled=false;await writeFile(bridge.configPath,JSON.stringify(config));bridge.dispose()
    const resumed=new ClaudeBridge(dir,settings,helper);await resumed.start()
    try{assert.deepEqual(await resumed.setEnabled(true),{ok:true});assert.equal(resumed.state.enabled,true);assert.equal(JSON.parse(await readFile(resumed.configPath,'utf8')).previous,null)
      await writeFile(settings,'broken JSON');assert.equal((await resumed.setEnabled(false)).ok,false);assert.equal(resumed.state.enabled,false)
      assert.equal(JSON.parse(await readFile(resumed.configPath,'utf8')).enabled,false);await assert.rejects(access(join(dir,'snapshot.json')))
    }finally{resumed.dispose()}
  }finally{bridge.dispose()}
})

test('settings compare and update is indivisible: stale expectation and concurrent transactions preserve user keys',async()=>{
  const {bridge,settings}=await setup()
  try{
    const expected=await readFile(settings,'utf8'),edited=JSON.stringify({theme:'edited',newUserSetting:true})
    await writeFile(settings,edited)
    await assert.rejects(updateBridgeSettings(helper,settings,expected,{type:'command',command:'bridge'}),/modificate contemporaneamente/)
    assert.equal(await readFile(settings,'utf8'),edited)
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>updateBridgeSettings(helper,settings,edited,{type:'command',command:`transaction-${i}`})))
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    const final=JSON.parse(await readFile(settings,'utf8'));assert.equal(final.theme,'edited');assert.equal(final.newUserSetting,true);assert.match(final.statusLine.command,/^transaction-/)
  }finally{bridge.dispose()}
})

test('a pending snapshot cannot cross disable and re-enable generations',async()=>{
  const {bridge,dir}=await setup();bridge.dispose()
  const originalRead=fs.readFile;let release=()=>{},capturedResolve=()=>{};const captured=new Promise<void>(r=>capturedResolve=r)
  try{
    await bridge.setEnabled(true);const cache=join(dir,'snapshot.json')
    await writeFile(cache,JSON.stringify({sessionId:'old-generation',receivedAt:Date.now(),cost:1,windows:[]}))
    let delayed=false
    fs.readFile=async function(path,...args){const result=await (originalRead as (...values:unknown[])=>Promise<string|Buffer>)(path,...args);if(String(path)===cache&&!delayed){delayed=true;capturedResolve();await new Promise<void>(r=>release=r)}return result} as typeof fs.readFile
    const pending=bridge.refresh();await captured;await bridge.setEnabled(false);await bridge.setEnabled(true);release();await pending
    assert.equal(bridge.state.sessionId,null);assert.equal(bridge.state.cost,null);assert.equal(bridge.state.effective,false)
  }finally{release();fs.readFile=originalRead;bridge.dispose()}
})
