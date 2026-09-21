# Embedded session terminal

Localino renders its session view with Ink **7.1.1** in a Node worker and displays
the generated terminal frames with xterm.js **6.0.0**. The worker bundle includes
React, the reconciler and Yoga's embedded WebAssembly. It lives inside `app.asar`;
no external Node installation or `node_modules` directory is required.

## Decision

| Option | Advantages | Consequences |
| --- | --- | --- |
| Ink virtual streams + xterm (chosen) | Incremental frames, Unicode terminal layout, isolated lifecycle, native terminal selection | Worker lifecycle and frame ordering must be managed; a structured accessible transcript is also needed |
| `renderToString` snapshots | Small integration surface | Recomputes every snapshot; no interactive terminal lifecycle; would require a separate scrolling and selection implementation |
| Direct DOM transcript | Excellent semantic accessibility | Does not satisfy the required Ink presentation; useful as a complementary accessible view |
| Provider PTY or external terminal | Could reproduce a provider TUI | Outside scope; would replace the approved machine protocols and weaken event correlation |

The structured transcript is the source of truth. Ink is a projection, never the
storage format or provider transport. The first implementation is a packaged
feasibility view of existing message deliveries; persistent transcript, provider
streaming and transcript navigation follow in the dependent sprint stories.

## Safety and lifecycle

The Electron renderer retains `sandbox: true`, `contextIsolation: true` and
`nodeIntegration: false`. Its IPC API accepts only a session identity, a view
identity and bounded terminal dimensions. The main process checks the sending
window and main frame, owns each subscription and supplies session content.
Closing/reloading a window releases its views. The final subscription releases
the worker; application shutdown waits for cleanup with a bounded fallback.
Geometry changes create a fresh Ink projection with an explicit reset and new
dimensions. xterm applies it after earlier writes finish, avoiding duplicate
reflow from independently resizing xterm and applying Ink's old-geometry erase.

Before text reaches Ink, control characters become visible symbols or escaped
code points. **Ink Text does not itself escape arbitrary ANSI.** Newlines and
Unicode are preserved. Provider ESC, OSC, C1 and directional override controls
cannot act as terminal commands. No hyperlink or clipboard addon is installed;
OSC 8 and 52 are also consumed without action. The terminal has no provider stdin.
Send, Queue and future approval actions remain separate, typed operations.

Each Ink mount has private input/output/error streams. Ink never patches the
application console. The optional Ink debugger is disabled in the worker build:
its imported `node:process` does not match esbuild's global `process.env` define,
so the build replaces Ink's documented DEV flag explicitly. No debugger/network
dependency is loaded. `waitUntilExit` is registered before unmount so Ink removes
its beforeExit handler during cleanup.
The worker replaces `restore-cursor` with a no-op at bundle time: that dependency
otherwise writes to global stderr on exit even when Ink uses custom streams.
Ink still restores each virtual stream's cursor during ordinary unmount; there
is no physical terminal to restore. Tests inspect worker output after exit.

Both the main bridge and worker batch projection updates on a 34 ms timer. A
newer complete projection replaces an older pending projection; authoritative
events must be stored independently before presentation. This prevents a burst
of 5,000 updates from causing 5,000 React layout operations. It does not authorize
dropping transcript events. Three independently identified views per window are
allowed. xterm's screen-reader mode provides the prototype's readable terminal;
the transcript story adds the equivalent semantic DOM path.

## Reproducing the spike

Run `npm run build`, `node --test tests/ink.test.mjs` and
`node --test tests/terminal-ui.test.mjs`. For the distributed Windows application,
run `npm run build:win`, then set `LOCALINO_PACKAGED_TEST=1` and run the UI suite.
The latter launches a worker from inside ASAR, drives 5,000 Unicode updates and
checks an actual embedded session view, sandbox settings and invalid IPC inputs.

The deterministic Node probe measures elapsed time, process CPU, RSS growth and
frame counts, checks 5,000 retained Unicode characters against xterm's parsed
buffer, changes three instances and repeatedly remounts them. Measurements are
printed as JSON, not asserted as universal hardware-independent limits. The
100,000-event/50 MiB end-to-end performance acceptance remains a later integrated
check; this small spike is not evidence for it. macOS execution must be reported
separately from Windows.

Initial Windows measurement (Ryzen 7 5800H, 8 cores / 16 threads, Node 22.22.0):
5,000 updates paced in groups of 20 at 20 ms intervals, three views and twelve
remounts completed in 8.86 s with 94 progressive streaming frames, 3.89 s user CPU,
0.69 s system CPU and 70.5 MB peak-observation RSS growth across the test process
and worker. This is an observed delta, not a heap-retention or peak-memory bound.
The burst-only run completed in 1.44 s with about 40 MB RSS growth. Rendering is
capped at 30 fps; actual throughput depends on layout size and host load. The
probe asserts content and cleanup rather than a minimum frame rate. It uses the
actual bundled worker and an independent xterm buffer oracle instead of
`ink-testing-library`, which would not exercise bundled Yoga, ANSI parsing or
worker teardown.

`npm run dev` runs Vite in watch mode. A main build plugin bundles Ink after
Vite writes/cleans its output and watches worker sources. The cold-start and
source-update regression is `node --test tests/terminal-dev.test.mjs`; it removes
only generated worker output and restores its temporary source edit on exit.
