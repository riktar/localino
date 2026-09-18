# Live coding-agent sessions

Localino does not currently claim that it can attach to every coding-agent session that is already open in another client. A persisted transcript, a session database, and a live process are different things: reading history does not provide a safe channel to the process that owns the current turn.

## Feasibility snapshot

The table records the supported upstream integration points evaluated for SPRINT-005. `Blocked` means Localino must not enable Send or present historical activity as a live turn.

| Agent and client | Upstream integration point | Existing ordinary session | Required setup | Current decision |
|---|---|---|---|---|
| Codex CLI | App Server JSON-RPC; a CLI can connect to an explicitly exposed remote endpoint | Not attachable on Windows. The managed shared daemon and its proxy are Unix-only in the tested CLI. | Start a Localino-owned App Server listener and launch the CLI with `--remote`, or use a proven shared daemon on Unix | Blocked pending product approval and Windows parity; WebSocket transport is experimental |
| Codex VS Code | The extension owns an App Server subprocess over private stdio | No supported external attach endpoint was found | A documented extension option for a shared endpoint would be required | Blocked |
| Codex desktop | The desktop client owns App Server subprocesses over private stdio on the tested Windows installation | No supported external attach endpoint was found | A documented shared endpoint or first-party control API would be required | Blocked |
| Claude Code CLI | Hooks expose lifecycle; Channels can push into the running session | Not attachable unless that session was started with the integration | Start Claude with an approved Channel plugin. Custom channels require an organization allowlist or a development bypass during the research preview | Blocked pending approval of preview/setup constraints |
| Claude Code for VS Code | No documented Localino-addressable Channel endpoint for an already running extension session was demonstrated | Not attachable | A first-party extension channel or supported control endpoint would be required | Blocked |
| Pi CLI | RPC controls the process it starts; an extension can run inside an interactive process | Not attachable when neither RPC nor the extension was loaded | Launch in RPC mode under Localino, or install and load a local bridge extension before starting the session | Blocked pending approval of the startup requirement |
| OpenCode CLI/TUI | HTTP server, SSE events, session status and asynchronous prompts | A random private endpoint is not a reliable discovery contract | Start the TUI/server with a fixed loopback address and authentication, then register that endpoint with Localino | Blocked pending an installed client and approval of the startup requirement |

The macOS combinations need native validation on both requested architectures. Unix daemon availability alone is not evidence that the Codex VS Code and desktop clients share that daemon or that messages reach the exact original client session.

## Safety rules for a future implementation

- A live identity must include provider, process or server instance, and session ID. A transcript ID alone is insufficient.
- Running must come from a live lifecycle event. File modification time, login state, and an open process do not imply an active turn.
- Send stays disabled without a verified transport to the owning instance. Localino must not silently resume or fork the transcript in another process.
- Loopback endpoints require authentication and explicit registration. Localino must not scan arbitrary ports, expose a public listener, inject keystrokes, or write directly to an agent database.
- A delivery timeout after possible receipt remains `Unknown`; it must not trigger an automatic retry.

## Evidence needed to remove a block

For each client and platform, start an external session using the documented setup, record the client and agent versions, observe turn start and completion, send an innocuous multiline Unicode message from Localino, and confirm exactly one receipt in the original client. Repeat while busy, after restart, and with two same-project sessions. Mock transports cover state-machine errors only; they do not prove same-session delivery.
