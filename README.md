# Localino

### One calm control panel for all your coding agents.

Codex is in one window. Claude Code is in another. Pi and OpenCode keep their own histories. Quotas, running sessions, next prompts and useful snippets are scattered across tools — so the work moves fast, but managing the work does not.

**Localino brings it all into one compact, local-first desktop panel.** See what your agents are using, supervise the sessions you start, queue the next instruction and save selected text without leaving your flow.

No new account. No cloud workspace. No replacement for the tools you already use.

[Try Localino from source](#understand-the-setup-in-30-seconds) · [See the problems it solves](#less-agent-wrangling-more-building) · [Check privacy and limits](#local-first-by-design)

> [!IMPORTANT]
> Localino is currently pre-release. There is no downloadable installer yet, but you can run it from source on Windows or macOS.

## Less agent wrangling, more building

| When your workflow feels like this... | Localino gives you... |
|---|---|
| “How much quota do I have left?” | One consistent view of the usage, limits, token totals and estimated costs each provider actually makes available. |
| “Is that agent still working?” | Supervised sessions with a clear state and live turn timer. |
| “I already know the next prompt, but the turn is not finished.” | A local FIFO queue that sends the next instruction only after the current turn ends. |
| “I need that snippet later.” | Instant capture: select text in a supported app and press Shift twice to save a searchable local note. |
| “I do not want another platform holding my work.” | Local storage for notes and pending messages; provider credentials remain with the agent CLI that owns them. |

The result is a smaller coordination loop: open Localino from the tray or menu bar, see the signal, take action and get back to building.

## Understand the setup in 30 seconds

**You need:** [Node.js 22.12+](https://nodejs.org/) and at least one supported agent CLI already installed and configured.

```sh
git clone https://github.com/riktar/localino.git
cd localino
npm ci
npm run dev
```

When Localino opens, find it in the Windows tray or macOS menu bar, choose an agent and press **Connect**. That is the whole first-run path.

> [!NOTE]
> Building on Windows also requires the .NET Framework 4.8 reference assemblies and the Framework64 C# compiler. Building on macOS requires macOS 13+ and Xcode command line tools; production behavior on Mac is not yet fully verified.

## What changes once Localino is running

1. **You stop checking every tool separately.** Localino turns available quota windows and local histories into a consistent overview.
2. **You know what is happening now.** Start a CLI session for a project and follow its state, timer and conversation from one place.
3. **Your next thought does not interrupt the current one.** Queue prompts while an agent is busy; Localino dispatches them in order after verified completion.
4. **Useful context stops disappearing.** Highlight text in another app and press Shift twice within 350 ms to keep it as a searchable note.
5. **You stay in control.** Review approvals and supported input requests per session, with one-time decisions instead of persistent permission changes.

## Four agents, one consistent view

| Agent | Usage and limits | Supervised sessions |
|---|---|---|
| Codex | ChatGPT quota windows and service usage | Yes |
| Claude Code | Local history, plus an optional quota bridge | Yes |
| Pi | Local token usage and estimated cost | Yes |
| OpenCode | Local token usage and estimated cost | Yes |

Localino reports only what each source can support. Missing data stays **Unavailable** instead of being guessed, and separate quota windows are never added together.

## Built for the moments between prompts

### See the signal, not another dashboard

Open the lightweight, always-on-top panel only when you need it. Check the current quota window at a glance, or open **Advanced usage** for every available limit and historical metric.

### Keep the next step moving

Start a supervised CLI session, send an instruction and prepare the next one while the current turn is active. Localino keeps every queue tied to the exact session that owns it, even when several sessions use the same project.

### Turn passing context into durable context

Save selected text without breaking concentration. Notes remain searchable and local, ready when a useful command, decision or fragment becomes relevant again.

### Handle interruptions without handing over control

When an owned CLI needs approval or input, Localino shows a separate action card with the session, action, risk and target. **Approve once** applies to that request only; unsupported or secret prompts are never answered automatically.

## Local-first by design

- Notes are plain text in `notes.json` inside Electron's user-data directory.
- Drafts and unresolved deliveries are stored locally in `sessions.json` so you can review them after a restart.
- Conversation history for Localino-owned sessions is stored locally and excludes private reasoning, tool activity and raw provider data.
- Note, prompt and message text is not written to application logs or copied to the Clipboard automatically.
- Localino never retries an uncertain delivery, avoiding an accidental duplicate prompt.
- Renderers are sandboxed and isolated; native helpers run with bounded deadlines.
- Credentials stay with the original agent CLI.

Localino controls only the CLI processes it starts. It does not attach to sessions already running in a terminal, IDE, desktop client, WSL or remote environment. It does not install agent CLIs or change their credentials.

## Everyday shortcuts

| Action | Windows | macOS |
|---|---|---|
| Open commands | Ctrl+K | Cmd+K |
| Show panel globally | Ctrl+Alt+L | Cmd+Alt+L |
| Capture selected text | Shift twice or Ctrl+Alt+P | Shift twice or Cmd+Alt+P |
| New note | Ctrl+N | Cmd+N |
| Search notes | Ctrl+F | Cmd+F |
| Settings | Ctrl+, | Cmd+, |

Shortcuts can be edited, disabled or reset in Settings. For text capture in VS Code, set `editor.accessibilitySupport` to `on`. macOS also requires Accessibility and Input Monitoring permissions.

## Build a desktop package

```sh
# Windows x64 — creates a portable ZIP in dist/
npm run build:win

# macOS — creates a ZIP and DMG in dist/
npm run build:mac
```

People using a packaged build do not need Node.js or an SDK.

## Documentation

- [Agent connections, data sources and metric semantics](docs/agents.md)
- [Supervised sessions, delivery guarantees and limitations](docs/sessions.md)
- [macOS setup and verification checklist](docs/mac-testing.md)
- [Regression and test coverage map](docs/regression-map.md)

## Development

```sh
npm ci
npm run dev
npm run check
```

`npm run dev` compiles the native helpers for the host platform before starting Electron. `npm run check` runs linting, unit tests, builds and integration tests.

Localino is built with Electron, React, TypeScript, Tailwind CSS and local shadcn/ui components.

```text
src/main       lifecycle, storage, IPC and agent adapters
src/preload    minimal renderer API
src/shared     shared contracts
src/renderer   panel, settings, editors and usage window
native         Windows and macOS helpers
tests          unit, Electron, native protocol and package checks
```

For exact delivery and recovery behavior, start with the [live-session guide](docs/sessions.md). For the origin and meaning of every metric, see [agent data sources](docs/agents.md).
