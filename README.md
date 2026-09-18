# Localino

A compact desktop panel for coding agents and local notes. Built with Electron, React, TypeScript, Tailwind CSS and local shadcn/ui components.

Open Localino from the Windows tray or macOS menu bar. The panel stays above ordinary windows while open. Close, minimize or Hide keeps the app running; **Quit** stops it. **Advanced usage** opens one reusable detail window; Back or its close button returns to the panel.

Drag the app header to move either window. Choose **Settings → Theme → System, Light or Dark**; System is the default and follows live OS changes. The preference applies to both windows and survives restarts. Subtle transitions respect the system reduced-motion preference.

## Use the panel

- Choose Codex, Claude Code, Pi or OpenCode. Switching agents does not connect them or open another screen.
- Press **Connect** to use an existing Codex ChatGPT login or a local agent history. **Settings → Connections** contains source selection, disconnect and recovery.
- The card shows one labeled quota window. **Details** exposes every received limit. Windows are never added together; unavailable, stale and exhausted values remain distinct. Exhausted secondary limits are flagged.
- Use **+** to create a note. Each row has independent selection, edit, delete and complete/reopen actions. Click its text to read the full note.
- Select notes and use the context menu or Ctrl/Cmd+C to copy newest first. **Copy all** joins exact complete texts with one LF between notes. Search/filter changes clear selection. Text fields retain native copy/paste.
- Unsaved drafts offer **Save**, **Discard** or **Stay**. Failed saves keep the text. Escape in a confirmation means Stay.

Notes live in the versioned `notes.json` under Electron's user-data directory. Unicode, whitespace and line endings are preserved; the limit is 100,000 UTF-16 code units. Empty or whitespace-only notes are rejected. Corrupt libraries are preserved and can be reloaded after repair. Notes are plain text on disk and are never sent to agents, network services, logs or telemetry.

## Capture selected text

Select text in another app, then press and release **Shift twice within 350 ms**, without other keys. The alternative is Ctrl+Alt+P on Windows or Cmd+Alt+P on a fresh Mac profile. Configure both in Settings.

A readable selection saves once and appears selected in the Clipboard list, scrolled into view. Click its text to read the full note. An existing manual draft stays in memory under **Resume draft**. Empty, inaccessible, changed or oversized selections open recovery; text is never truncated. Cancel is guarded and attempts to restore the source app. Software acquisition/presentation timings are in Details.

Windows uses UI Automation; macOS uses Accessibility and a passive event tap. Capture reads selected text only: no simulated copy, clipboard substitution, OCR or retained key history. Protected/password controls are excluded. Workers have hard deadlines. Unsupported controls allow manual paste.

**VS Code:** set `editor.accessibilitySupport` to `on`. **macOS:** use **Settings → Capture → Allow permissions** for Accessibility and Input Monitoring, then Retry. Localino does not change other apps' settings. Actual Mac behavior remains pending the colleague's [verification checklist](docs/mac-testing.md); Windows tests do not establish Mac support.

## Shortcuts

Open Commands with Ctrl/Cmd+K, search, use arrow keys and Enter. Settings lets you edit, disable or reset local/global bindings. Conflicts preserve previous values.

| Action | Windows | Fresh macOS profile |
|---|---|---|
| Panel / usage / Clipboard | Ctrl+1 / 2 / 3 | Cmd+1 / 2 / 3 |
| Same actions globally | Ctrl+Alt+L / U / C | Cmd+Alt+L / U / C |
| New note / search | Ctrl+N / Ctrl+F | Cmd+N / Cmd+F |
| Edit / copy selection / delete | F2 / Ctrl+C / Delete | F2 / Cmd+C / Delete |
| Save editor or complete focused note | Ctrl+Enter | Cmd+Enter |
| Settings / commands | Ctrl+, / Ctrl+K | Cmd+, / Cmd+K |
| Hide or dismiss a dialog | Escape | Escape |

Custom and disabled bindings are preserved during migration. Imported Ctrl bindings stay Ctrl; Reset applies current platform defaults. App text and distributed documentation are English. User content and external provider labels are unchanged; English formatting keeps the local timezone and original metric calculations.

## Agent data

See [sources and metric semantics](docs/agents.md) for connection requirements, recorded fixture versions, polling, privacy, partial history and the optional Claude bridge. Local history is not an account quota; estimated costs are not invoices. Missing days are not measured zeroes.

## Develop and verify

Requires Node.js 22.12 or later and npm. Windows x64 builds need .NET Framework 4.8 reference assemblies and the Framework64 C# compiler. Mac builds need Xcode command line tools and macOS 13 or later ([Electron 44 requirement](https://www.electronjs.org/blog/electron-44-0)).

```sh
npm ci
npm run dev
npm run check
```

`npm run dev` first compiles and signs the host-platform helpers automatically; build failures stop startup with the compiler output. `build:common` builds TypeScript/React/Electron; `build:native` compiles host-platform helpers. Runtime users do not need Node or an SDK. Renderers are sandboxed and isolated. The preload exposes named operations with trusted main-frame sender checks. Native binaries are outside ASAR. New main/preload dependencies must be bundled or explicitly packaged.

Use `npm run build:win` for the Windows x64 ZIP. On a Mac, `npm run build:mac` creates the host-architecture ZIP and DMG; explicit arm64/x64 commands are in the [Mac guide](docs/mac-testing.md). `npm run test:packaged` checks the unpacked artifact. The [regression map](docs/regression-map.md) describes retained coverage after removing the old screens. The Claude bridge supports automatic macOS setup; see the [Mac guide](docs/mac-testing.md) for its file-coordination limits. No Mac production release is verified yet.

The [Mac checklist](docs/mac-testing.md) and [report](docs/mac-test-report.md) distinguish automated protocol fixtures from external-app testing. Native verification must cover permissions, focus, gestures, source changes, worker cleanup and packaged operation.

## Repository

- `src/main`: lifecycle, stores, IPC and read-only agent adapters.
- `src/preload` / `src/shared`: minimal API and contracts.
- `src/renderer`: panel, internal settings/editors and subordinate usage window.
- `native`: Windows helpers; `native/mac`: Mac helpers.
- `tests`: isolated unit, Electron, native protocol and package checks.

Git workflow: one branch per sprint, separate review and integrated verification before a PR. Merges and production acceptance are separate. Local TheOneLoop records are intentionally ignored and may be Italian.
