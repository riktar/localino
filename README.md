# Localino

### Keep every coding agent in view — without leaving your flow.

Localino is a compact, local-first desktop command center for **Codex, Claude Code, Pi and OpenCode**. Check usage and quotas, run supervised CLI sessions, queue the next prompt and save selected text as a note — all from one panel in your tray or menu bar.

**No new account. No cloud workspace. Your existing agents, on your machine.**

[Run Localino](#run-localino) · [See what it does](#everything-you-need-within-reach) · [Read the technical docs](#documentation)

## Everything you need, within reach

- **Know where you stand.** See available quotas, usage history, token totals and estimated costs without jumping between tools.
- **Keep agents moving.** Start a CLI session for a project, follow its state and queue the next instruction while the current turn is still running.
- **Capture context instantly.** Select text in a supported app and press Shift twice to turn it into a searchable local note.
- **Stay in your flow.** Open the always-on-top panel from the Windows tray or macOS menu bar, then dismiss it when you are done.
- **Keep control of your data.** Notes and pending messages stay on your computer. Credentials remain with the agent CLI that owns them.

## Run Localino

Localino is currently **pre-release** and does not yet have a downloadable installer. You can try it from source in a few commands.

You need [Node.js 22.12+](https://nodejs.org/). To connect agent data or start a session, keep at least one supported agent CLI installed and configured.

```sh
git clone https://github.com/riktar/localino.git
cd localino
npm ci
npm run dev
```

That is it. Open Localino from the tray or menu bar, choose an agent and press **Connect**.

> [!NOTE]
> Windows builds also require the .NET Framework 4.8 reference assemblies and Framework64 C# compiler. macOS builds require macOS 13+ and Xcode command line tools; production behavior on Mac is not yet fully verified.

### Build the desktop app

```sh
# Windows x64 — creates a portable ZIP in dist/
npm run build:win

# macOS — creates a ZIP and DMG in dist/
npm run build:mac
```

Runtime users of a packaged build do not need Node.js or an SDK.

## From connection to momentum

1. **Connect your agent.** Localino uses your existing Codex login or reads the local history of Claude Code, Pi or OpenCode.
2. **See the signal.** Get the current quota window in the panel and open **Advanced usage** for every available limit and historical metric.
3. **Start working.** Launch a supervised CLI session for a project, send an instruction and queue what should happen next.
4. **Save what matters.** Highlight text in another app and press Shift twice within 350 ms. It appears in Localino as a searchable note.

## Four agents, one consistent view

| Agent | Usage and limits | Supervised sessions |
|---|---|---|
| Codex | ChatGPT quota windows and service usage | Yes |
| Claude Code | Local history, plus an optional quota bridge | Yes |
| Pi | Local token usage and estimated cost | Yes |
| OpenCode | Local token usage and estimated cost | Yes |

Localino reads each source according to what it actually provides. Missing data stays **Unavailable** rather than being guessed, and separate quota windows are never added together.

## Built for trust

- Notes are stored as plain text in `notes.json` inside Electron's user-data directory.
- Drafts and unresolved deliveries are stored locally in `sessions.json` so you can review them after a restart.
- Note and message text is not written to application logs.
- Localino never retries an uncertain message delivery, preventing an accidental duplicate prompt.
- Renderers are sandboxed and isolated; native helpers run with bounded deadlines.

Localino only controls CLI processes that it starts. It does not attach to sessions already running in a terminal, IDE, desktop client, WSL or a remote environment. It also does not install agent CLIs or change their credentials.

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

The app is built with Electron, React, TypeScript, Tailwind CSS and local shadcn/ui components.

```text
src/main       lifecycle, storage, IPC and agent adapters
src/preload    minimal renderer API
src/shared     shared contracts
src/renderer   panel, settings, editors and usage window
native         Windows and macOS helpers
tests          unit, Electron, native protocol and package checks
```

Want the exact protocol and recovery behavior? Start with the [live-session guide](docs/sessions.md). Want to understand how a metric is calculated? See [agent data sources](docs/agents.md).

Live sessions show one conversation history with clearly separated **You** and
model messages. Localino does not expose a separate transcript archive or show
tool, status and protocol events in the conversation. Use **Load earlier messages**
to move back through long sessions; when manual scrolling pauses follow mode,
**Latest messages** or **New messages** returns to the live end. See
[storage and privacy](docs/sessions.md#local-conversation-history).

When an owned CLI asks for approval or input, Localino shows a separate action
card with the session, action, risk and target. **Approve once** never creates a
persistent policy; **Deny**, supported choices and text responses are correlated
to that single request. Unsupported or secret prompts remain visible as action
required and can only be cleared by the provider or by stopping the session.
