import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Read-only STORY-019 probe. It records capability markers, never session content,
// credentials, command lines, process paths, or raw provider output.
export function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000, shell: command.endsWith('.cmd') })
  return { available: !result.error, status: result.status, text: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
}

export function capability(name, result, markers) {
  return {
    name,
    available: result.available && result.status === 0,
    status: result.status,
    markers: Object.fromEntries(markers.map(marker => [marker, result.text.includes(marker)])),
  }
}

export function probe(platform = process.platform) {
  const command = name => platform === 'win32' && (name === 'pi' || name === 'opencode' || name === 'code') ? `${name}.cmd` : name
  const codexVersion = run('codex', ['--version'])
  const codexHelp = run('codex', ['app-server', '--help'])
  const claudeVersion = run('claude', ['--version'])
  const claudeHelp = run('claude', ['--help'])
  const piVersion = run(command('pi'), ['--version'])
  const piHelp = run(command('pi'), ['--help'])
  const opencodeVersion = run(command('opencode'), ['--version'])
  const codeExtensions = run(command('code'), ['--list-extensions', '--show-versions'])
  const daemon = run('codex', ['app-server', 'daemon', 'version'])
  return {
    schema: 1,
    platform,
    checkedAt: new Date().toISOString(),
    clients: {
      codex: capability('codex', codexVersion, ['codex-cli']),
      claude: capability('claude', claudeVersion, ['Claude Code']),
      pi: capability('pi', piVersion, []),
      opencode: capability('opencode', opencodeVersion, []),
      vscodeCodex: { available: codeExtensions.available && /^openai\.chatgpt@/m.test(codeExtensions.text) },
      vscodeClaude: { available: codeExtensions.available && /^(anthropic\.|.*claude)/mi.test(codeExtensions.text) },
    },
    contracts: {
      codexAppServer: capability('codex-app-server', codexHelp, ['--listen', 'stdio://', 'ws://IP:PORT', 'unix://']),
      codexManagedDaemon: {
        available: daemon.status === 0,
        status: daemon.status,
        unixOnly: /only supported on Unix platforms/i.test(daemon.text),
      },
      claude: capability('claude-control', claudeHelp, ['--remote-control', '--include-hook-events']),
      pi: capability('pi-rpc', piHelp, ['--mode <mode>', '--extension']),
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(probe(), null, 2)}\n`)
}
