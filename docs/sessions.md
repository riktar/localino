# Live coding-agent sessions

Localino can start and supervise new CLI sessions for Codex, Claude Code, Pi and OpenCode when their binaries are available. Choose the agent, select **Start session**, then choose a project folder. The session card shows the project, lifecycle state and current-turn wall-clock time; **Stop** affects only that supervised process. Hiding the panel keeps it running, while quitting Localino stops every process it owns.

Binary discovery uses the current executable search path. An advanced installation can set `LOCALINO_CODEX_PATH`, `LOCALINO_CLAUDE_PATH`, `LOCALINO_PI_PATH` or `LOCALINO_OPENCODE_PATH` to an exact executable or Windows command shim. Localino does not install CLIs, alter provider credentials or open a terminal. It uses Codex App Server, Claude stream-json, Pi RPC and an authenticated loopback OpenCode server respectively.

These guarantees do not extend to coding-agent sessions already open in another client. A persisted transcript, a session database, and a live process are different things: history does not provide a safe channel to the process that owns the current turn. VS Code extensions, desktop clients, ordinary pre-existing TUIs, remote/WSL agents and retroactive attach are outside the supported scope.

## Send, Queue and recovery

Click a supervised session card, or focus it and press Enter, to open its internal composer. The heading repeats the project and short Localino instance ID so same-project sessions remain distinguishable. The composer preserves exact multiline Unicode text, rejects blank text and shows the 100,000-character limit without truncating. It never imports Clipboard content automatically.

**Send** is available for an idle/ready instance. The provider-specific receipt changes the delivery from `Sending` to `Sent`; it does not mean the agent turn completed. While a turn is active, **Queue** stores messages locally for only that Localino instance. They dispatch one at a time, FIFO, after correlated terminal evidence; a still-local `Queued` message can be cancelled. Switching cards or agents does not change the recorded destination.

If a write may have reached the provider but its receipt is lost, Localino marks that delivery `Unknown` and never retries it. Connection loss also converts remaining local queue entries to `Suspended`; reconciliation does not transmit them. Stopped, missing, starting, errored or unknown sessions reject new sends rather than starting or resuming a substitute process.

Drafts and unresolved deliveries are written atomically as plain text to `sessions.json` in Electron's user-data directory. On restart they appear under **Recovered drafts and undelivered messages**, remain suspended, and can be discarded; no process is started and no message is sent automatically. A corrupt recovery file is preserved and reported instead of overwritten. Message text, Clipboard data, credentials and transcripts are not written to application logs.

## Evaluated clients

The Windows x64 investigation used Windows `10.0.26200`, Codex CLI `0.151.0`, Codex VS Code extension `openai.chatgpt@26.908.40401`, Codex desktop product `1.110.0` (process product name `Knotic`), Claude Code CLI `2.1.247`, Pi `0.84.3`, and VS Code `1.138.0`. The Claude VS Code extension and OpenCode were unavailable. Registry versions observed without installation were Codex `0.155.0`, Claude Code `2.1.276`, Pi `0.85.1`, and OpenCode `1.18.31`; they were not treated as tested clients.

No macOS arm64 or x64 host was available. Every macOS row is therefore blocked, including rows whose protocol is documented as cross-platform. Unix daemon availability alone does not prove that a desktop or IDE client shares the same server instance.

## Per-client decision matrix

| Client | Windows evidence and live identity | macOS evidence | Existing ordinary session | Setup for a future proof | Decision |
|---|---|---|---|---|---|
| Codex CLI | App Server identifies `thread.id`, `turn.id`, thread `cwd`/source/status and turn `startedAt`; owning instance is the explicit listener/control socket. The managed daemon lifecycle reports Unix-only on the tested CLI. | No client or daemon tested. | Not attachable on Windows when the CLI owns private stdio. | Start an authenticated Localino-owned listener and launch `codex --remote`, or prove the exact Unix daemon socket used by that CLI. Stop the listener and remove its token to uninstall. | Blocked: Windows parity is absent and WebSocket transport is experimental. |
| Codex VS Code | The installed extension owns one observed App Server subprocess on default stdio. Its process/server instance plus thread/turn IDs would be required; no external endpoint is published. | Extension/version/transport unavailable. | Not attachable through a supported interface. | A documented extension setting for a shared authenticated endpoint, with restart/reload and removal steps, is required. | Blocked. |
| Codex desktop | Product `1.110.0` owns two observed App Server subprocesses on default stdio. No listener/control endpoint is exposed to Localino. | Client/version/transport unavailable. | Not attachable through a supported interface. | A first-party control endpoint or documented shared daemon used by the desktop client is required. | Blocked. |
| Claude Code CLI | Hooks identify `session_id`, `cwd`, event name and process-local instance; Channels or Remote Control can deliver to a session started/connected with them. Hook events have no provider start timestamp, so only bridge reception time is available. | No CLI/channel tested. | Hooks can be installed for later events, but an already running process does not reload a channel automatically. `/remote-control` can opt in the current session, but Localino has no documented client API for that cloud transport. | Load an approved Channel at startup/reload, or explicitly enable Remote Control. Removal disables the plugin/setting and restarts; organization policy and credentials must remain user-controlled. | Blocked: custom Channels are preview/allowlisted; Remote Control is limited to Claude web/mobile/desktop surfaces and opens no local API. |
| Claude Code VS Code | Extension absent. Official `/remote-control` can connect the extension session to Claude surfaces, but no Localino-addressable API is documented. Channel loading for this client was not demonstrated. | Extension/version unavailable. | No demonstrated Localino attach path. | First-party Localino-capable channel/control endpoint, plus extension reload and removal procedure. | Blocked. |
| Pi CLI | RPC exposes `sessionId`, `agent_start`/`agent_settled`, `turn_start`/`turn_end`, `queue_update`, correlated command responses, `follow_up`, and state. An in-process extension can subscribe to lifecycle and call `sendUserMessage(..., {deliverAs:'followUp'})`. | No CLI tested. | An ordinary TUI without the bridge extension or RPC owner cannot be attached. | Install/load a local authenticated bridge extension before launch, or start Pi in RPC mode under Localino. Remove the extension from Pi settings and restart; RPC ends with its owning process. | Blocked pending approval of the startup requirement and real version `0.85.1` proof. |
| OpenCode CLI/TUI | Client absent. Official server contract identifies the server endpoint as instance, uses `sessionID`, exposes `session.status`/`session.idle` SSE, and accepts `prompt_async` with an optional client message ID. | Client unavailable. | Random TUI endpoint is not a reliable discovery contract and a separate `serve` process is a different instance. | Start the TUI with fixed loopback hostname/port and `OPENCODE_SERVER_PASSWORD`, register that exact endpoint, and stop/remove the registration to uninstall. | Blocked pending an installed client and real same-TUI proof. |

## Delivery and lifecycle semantics

| Transport | Running / timer source | Busy delivery and FIFO owner | Receipt / ambiguity | Restart and new sessions |
|---|---|---|---|---|
| Codex App Server | `turn/started`, `turn/completed`, thread status and turn `startedAt` from the owning server. `Waiting` still needs event mapping proof. | `turn/steer` changes an active turn and therefore does not implement the approved end-of-turn queue. Localino would own FIFO and call `turn/start` only after observed completion. | JSON-RPC response is command acceptance; subsequent turn events establish processing. Lost response after write is `Unknown`, never automatic retry. | Reconnect and resubscribe to the same authenticated instance, then reconcile thread/turn ID. A different server with the same persisted thread is not the same instance. |
| Claude Hooks + Channel | Receive `UserPromptSubmit`/`Stop`/`StopFailure` and waiting-related hooks for one `session_id`; bridge reception time starts the timer. Sessions already busy before bridge registration have unavailable start. | Channel notifications arriving mid-turn are consumed by Claude; the upstream API does not expose a Localino FIFO receipt contract. A Localino queue would wait for terminal hook evidence before one notification at a time. | MCP notification completion only proves handoff to the channel transport, not model completion. A lost connection after send remains `Unknown`. | The plugin registers only in sessions launched/reloaded with it. New opted-in sessions register independently. After restart, drafts remain suspended until the same process/session identity is re-established. |
| Claude Remote Control | The local session and Claude surfaces synchronize progress and messages; long-turn/permission state is visible to those surfaces. | Mid-turn prompts are queued by Claude. | Anthropic owns cloud receipt/reconnection; there is no documented third-party Localino client/auth protocol. | Auto-connect can register each future session, but disabling Remote Control or policy removes availability. This is evidence of upstream feasibility, not a Localino integration. |
| Pi RPC / extension | `agent_start` starts work; `agent_settled` is the reliable end after retry/compaction/follow-up. Capture monotonic receipt time; RPC events do not supply a source wall-clock timestamp. | Native `follow_up`/`deliverAs:'followUp'` owns FIFO; `steer` is excluded because it changes the current run. | Correlated success accepts the command; `queue_update` and lifecycle events confirm queue progression. Lost response remains `Unknown`. | The owning RPC process or loaded extension must reconnect with the same session/process registration. Never resume a transcript in another process silently. |
| OpenCode server | SSE `session.status` (`busy`, `retry`, `idle`) and `session.idle`, keyed by `sessionID`; no turn-start timestamp is documented, so adapter reception time is the only candidate. | `prompt_async` returns immediately and does not document an end-of-turn FIFO guarantee. Localino would own FIFO and submit only after reconciled idle. | HTTP 204 acknowledges request receipt, not completed processing; message ID plus SSE/message lookup is needed. Timeout after possible 204 is `Unknown`. | Reconnect to the same registered endpoint, fetch `/session/status`, then resubscribe SSE. A fresh server over the same database is a different instance. |

No external-client row has complete same-session evidence on both required platforms. Consequently Localino does not enable control of those sessions or present their historical activity as a live turn. The supervised CLI path above owns its process and transport from startup and is a separate capability.

## Reproducible, non-invasive checks

`node scripts/probe-session-capabilities.mjs` records only availability and documented help markers; it suppresses raw provider output, paths, credentials and session data. `node --test tests/session-contracts.test.mjs` exercises the agreed reference semantics for composite identity, stale/foreign events, FIFO, duplicate acknowledgements, uncertain delivery and restart suspension. These are contract fixtures, not live integration evidence.

`tests/unit/sessions.test.ts` covers supervised adapter lifecycle, exact per-instance routing, FIFO/cancellation, duplicate terminal events, lost receipts and suspended queues. `tests/unit/session-recovery.test.ts` covers atomic restart data and corrupt-file preservation. `tests/sessions-ui.test.mjs` exercises keyboard selection, double-click protection, multiline Unicode delivery and a real Localino restart with no replacement session. Fixtures validate Localino's contract and error handling; they do not prove an unavailable provider or macOS integration.

## Safety rules

- A live identity includes provider, owning process/server instance and session ID; turn ID is separate. A transcript ID alone is insufficient.
- Running comes from a live lifecycle event. File modification time, login state and an open process do not imply an active turn.
- Send stays disabled without a verified transport to the owning instance. Localino never silently resumes or forks the transcript in another process.
- Loopback endpoints require authentication and explicit registration. Localino does not scan arbitrary ports, expose a public listener, inject keystrokes or write directly to an agent database.
- A delivery timeout after possible receipt remains `Unknown` and never triggers automatic retry.

## Evidence needed to remove a block

For each client and platform, start an external session using the documented setup, record client/agent versions and anonymized instance/session/turn IDs, observe turn start and completion, send an innocuous multiline Unicode message from Localino, and confirm exactly one receipt in the original client. Repeat while busy, after restart, and with two same-project sessions. Verify setup removal on an isolated profile without losing existing settings. Mock transports cover state-machine errors only; they do not prove same-session delivery.
## Embedded terminal architecture

The session terminal uses Ink in an isolated worker and xterm.js inside the
sandboxed Localino window. See [the architecture decision](terminal-architecture.md)
for the virtual streams, packaging, safety boundary and feasibility tests.

## Local transcript storage

Saved transcripts belong to the Localino instance UUID, so two sessions in the
same project remain separate. They are retained under the Electron user-data
directory in `transcripts/<instance-id>/` until **Delete transcript** is confirmed.
Stop a live session before deleting its transcript. Deletion affects that
transcript only; recovered unsent drafts have a separate Discard action.

The archive shows stored bytes, event count, recovery state and storage errors.
**Read transcript** opens at most 100 events / 2 MiB; **Earlier events** replaces
the page without loading the whole session into the renderer. Text selection and
the normal explicit copy gesture are available. Reading never changes Clipboard,
starts a provider or resends a prompt.

Storage uses versioned, checksummed JSONL records in approximately 4 MiB segments,
an atomically replaced manifest and a disposable snapshot of the recent events.
The worker synchronizes accepted batches to disk before acknowledging them.
It rebuilds its index by streaming records after restart; the UI remains usable
while this happens. Interrupted tails and corrupt records are preserved, skipped
with a visible completeness warning, and never overwritten by new segments.
Items still streaming after restart become interrupted; a sequence/content gap
prevents a completed label. A final snapshot replaces streamed text rather than
adding a second copy. No late operation, including a notice, can reopen a terminal
item. Notices about later activity use a separate item. Pages and duplicate
lookups apply the same ownership and sequence checks as recovery. Corrupt derived
manifests/snapshots are copied to `.corrupt-<uuid>` files before rebuilding them.

There is no automatic expiry or total session-size cap. Individual events over
1 MiB and a pending write queue over 8 MiB are rejected with an explicit error,
not shortened. Disk-full, checkpoint and worker failures are visible. A prompt
whose transcript cannot be saved is not sent. Provider output may contain secrets
the provider actually printed: keep the local user-data directory private.
Localino selects normalized observable fields; it does not persist raw auth
envelopes, arbitrary provider objects or private chain-of-thought. Reasoning is
unavailable unless a provider publishes an allowed summary. Transcripts are not
sent to telemetry, application logs or Clipboard automatically.

The output cache is bounded (20 recent events / 2 MiB), and event identity uses a
fixed 1 MiB Bloom index with exact disk lookup for positives. False positives
never suppress events. Small per-item state grows with item count, not response
text length; stored output has no in-memory mirror. Exact duplicate checks may
require disk scanning on very large sessions and run only in the worker.

The common store is covered by `tests/unit/transcript.test.ts`. The Electron
`tests/transcripts.test.mjs` dataset checks all 100,000 records against an
independent checksum/text oracle (over 100 MiB of output), recovery, page bounds,
renderer responsiveness, unchanged Clipboard and selective confirmed deletion.
This storage coverage is distinct from provider streaming and terminal UX tests.

## Provider output streams

Localino normalizes output from its own process, saves it in batches, and sends
only the saved projection to Ink. The live projection keeps 100 recent events /
2 MiB and at most 8,000 text characters; an explicit history notice points to
Saved transcripts for earlier text. This display window does not shorten storage.
Small identity/state indexes grow with the number of messages, tools and source
event IDs, not the amount of text in a response.

| Provider / protocol reference | Observed fields | Identity and recovery |
|---|---|---|
| Codex CLI 0.155.0 App Server | Assistant deltas and authoritative item snapshots, commentary/final phase, published reasoning summary, command/file/tool activity and output, approval/input requests and turn outcome | Owned thread + active turn + item. Ordered stdio has no delta UUID or offset: repeated equal text is legitimate and is retained. Final snapshots replace text. Raw reasoning channels are excluded. |
| Claude Code 2.1.247, SDK types 0.3.247 | Partial text/published thinking/tool blocks, completed assistant blocks, tool results and final result status | Owned session, submitted user UUID, message ID, block index/tool ID and source UUID where emitted. Completed one-block messages may share a message ID. User replay is a receipt, and result text does not duplicate the assistant. Nested subagent events are explicitly unsupported. |
| Pi 0.84.3 RPC | Text/published thinking/tool deltas and authoritative message end; cumulative tool execution output; extension UI requests | Validated user-run timestamp, assistant timestamp and content index/tool ID. Reused timestamps are marked ambiguous. Deltas without timestamps rely on the owned ordered stream. `agent_settled` follows retries and compaction. |
| OpenCode SDK 1.18.31 contract fixture | SSE message/part snapshots and deltas, tool state/output, files, session status and permission/question requests | Owned authenticated loopback endpoint + session + submitted parent message + assistant/part IDs. Reconnect keeps the same process and fetches up to 100 messages. A visible gap remains; snapshots replace known partials and deltas are suppressed for the interrupted turn to avoid replay duplication. Older activity may be unavailable. |

Unknown event types are labeled explicitly. Arbitrary tool argument objects,
authentication envelopes, environment, image data and raw stderr/server logs are
excluded; command/path/query/description fields and emitted text are selected.
Provider text itself may contain sensitive information. No automatic approval,
policy update or input response is sent. Requests currently show an unsupported
action label until the interaction flow is available.

JSONL records, SSE records and HTTP responses are bounded to 2 MiB before parsing;
the normalized storage event limit remains 1 MiB. Oversized/malformed stdio stops
only that session and records an incomplete outcome. An SSE disconnect or invalid
record degrades only its session and attempts recovery from the same server.
The write queue is bounded to 8 MiB, with a 34 ms batching window and batches of
up to 128 events / approximately 512 KiB. Storage failure stops the affected
session. Output is never copied to application logs or Clipboard automatically.

`tests/unit/provider-transcript.test.ts` checks each protocol, normalization and
privacy. `tests/unit/sessions.test.ts` also exercises malformed/oversized isolation
and SSE reconnection without resending. `tests/provider-volume.test.ts` checks
100,000 normalized deltas (over 100 MiB) against a disk oracle.
`tests/provider-stream.test.mjs` measures actual rendered DOM text and input
during 1,000 deltas/s through the owned process, store and Ink. xterm's screen
reader tree has its own one-second debounce, so it is not used as the visual
latency clock.

The explicitly invoked `node --import tsx scripts/probe-transcript-live.ts`
performs read-only turns in a fresh temporary project using existing CLI accounts.
On 2026-09-21, Codex and Pi completed the probe with streamed text and a read-only
tool. Claude's CLI was available but OAuth refresh failed, so its live success
check remains pending login. OpenCode was absent: its fixture result is not a
live integration claim. No macOS streaming verification has been performed.
