import { createInterface } from 'node:readline'
const mode = process.argv[2]
if (mode === 'crash') process.exit(1)
if (mode === 'malformed') process.stdout.write('not json\n')
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (mode === 'silent') return
  if (message.id === undefined) return
  if (mode === 'incompatible') { console.log(JSON.stringify({ id: message.id, error: { code: -32601, message: 'sensitive text must not escape' } })); return }
  const result = message.method === 'initialize' ? { userAgent: 'fixture' } : { account: { type: 'chatgpt', email: null, planType: null } }
  const send = () => console.log(JSON.stringify({ id: message.id, result }))
  if (mode === 'delay') setTimeout(send, 100)
  else send()
})
if (mode === 'ignore-eof') setInterval(() => {}, 1000)
