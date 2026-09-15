import { compactPage } from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'
import { CodexRpc } from '../src/main/codex/rpc'
import { resolveCodex } from '../src/main/codex/resolve'

test('Real Codex account: connect, reread, restart, disconnect without logout', { timeout: 90_000 }, async () => {
  const cli = await resolveCodex(null)
  const probe = new CodexRpc(cli)
  await probe.start()
  try {
    const before = await probe.request('account/read') as { account: { type: string; email: string | null } }
    assert.equal(before.account?.type, 'chatgpt')
    await mkdir('test-results/profiles', { recursive: true })
    const profile = await mkdtemp(resolve('test-results/profiles/live-account-'))
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
    const launch = () => electron.launch({ args: ['.', `--user-data-dir=${profile}`], env })
    let app = await launch()
    try {
      let page = await compactPage(app)
      await page.getByRole('button',{name:'Collega Codex',exact:true}).click()
      await page.getByText('Collegato',{exact:true}).waitFor()
      assert.ok(await page.evaluate(email => window.localino.getConnection().then(s=>s.account?.email===email),before.account.email))
      await page.getByRole('button',{name:'Rileggi account',exact:true}).click()
      await page.getByText('Collegato',{exact:true}).waitFor()
      await app.close()
      app = await launch(); page = await compactPage(app)
      await page.getByText('Collegato',{exact:true}).waitFor()
      await page.getByRole('button',{name:'Scollega da Localino',exact:true}).click()
      await page.getByRole('button',{name:'Collega Codex',exact:true}).waitFor()
      const preferences = JSON.parse(await readFile(join(profile,'connection.json'),'utf8'))
      assert.deepEqual(preferences,{enabled:false,cliPath:null})
      const after = await probe.request('account/read') as typeof before
      assert.ok(after.account?.email===before.account.email && after.account?.type==='chatgpt')
    } finally { await app.close() }
  } finally { await probe.stop() }
})
