import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Ink/Yoga use ESM top-level await. Keep a dedicated, self-contained Node worker
// inside ASAR; neither Electron main nor its sandboxed renderer imports Ink.
export async function buildInk() { return build({
  entryPoints: ['src/main/sessions/ink-worker.ts'], outfile: 'out/main/ink-worker.mjs',
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: "import { createRequire as __localinoCreateRequire } from 'node:module'; const require = __localinoCreateRequire(import.meta.url);" },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.DEV': '"false"' },
  plugins: [{ name: 'ink-production', setup(builder) {
    // There is no physical terminal in this worker. restore-cursor otherwise
    // installs a global process.stderr exit hook even for custom Ink streams.
    builder.onResolve({ filter: /^restore-cursor$/ }, () => ({ path: 'virtual-cursor', namespace: 'localino' }))
    builder.onLoad({ filter: /.*/, namespace: 'localino' }, () => ({ contents: 'export default function restoreCursor() {}', loader: 'js' }))
    // Ink imports process explicitly, so esbuild's global define cannot replace
    // this opt-in flag. Disable the documented debugger branch at build time.
    builder.onLoad({ filter: /node_modules[/\\]ink[/\\]build[/\\].*\.js$/ }, async ({ path }) => ({
      contents: (await readFile(path, 'utf8')).replaceAll("process.env['DEV']", "'false'"), loader: 'js',
    }))
  } }],
  logLevel: 'warning',
}) }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildInk().catch(error => { console.error(error); process.exitCode = 1 })
}
