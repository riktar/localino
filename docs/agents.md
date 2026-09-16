# Agent sources and metric semantics

## Codex

Connect an existing ChatGPT login in the native Codex CLI. API keys do not expose subscription quotas. Localino finds `codex.exe` on Windows or `codex` on macOS, or lets you choose an executable. Shell wrappers are not launched through a shell. Refresh account recreates the connection and clears previous account data; disconnect keeps the CLI signed in.

`connection.json` stores only the opt-in preference and executable path. Credentials remain with Codex. Localino uses App Server initialization and read operations; it does not persist email, token history or conversations. The preceding integration baseline validated Codex 0.154.0; this is a recorded version, not a promise about a future release.

Quotas refresh every 60 seconds even with the panel hidden, on opening, and on explicit refresh. The service can publish consumption late. Errors, elapsed resets and three minutes without success mark previous data stale. Automatic retry backs off up to five minutes. Localino never resets consumption without new source data.

Advanced usage refreshes every five minutes only while its window is visible. Lifetime metrics remain independent of the period filter. Daily service dates are not timezone-converted. Local calendar periods include today; totals, means and peaks use reported days only. Missing days remain gaps. Identical duplicates count once; invalid or conflicting records are excluded and mark partial coverage. Account credits and quota limits are separate; an unlimited credit flag does not remove quota limits.

## Local histories

Readers start only after Connect or an explicit source choice. Disconnect changes Localino preferences, not the source archive. Each reader runs in a cancellable worker with a 15-second limit. Refresh occurs on connection/opening and every 60 seconds while that agent's panel or usage window is visible. Hidden histories do not scan periodically. Same-source failures preserve a stale aggregate; changing source or disconnecting clears it. Only aggregate metrics and source metadata reach the renderer.

### Claude Code

Default source: `~/.claude/projects` or `CLAUDE_CONFIG_DIR/projects`. The reader visits regular JSONL files, including subagents, without following symlinks. Responses deduplicate by `message.id` across copies and forks. Conflicting copies are excluded. Session counts include sessions containing valid response copies and are distinct from original-response counts.

Input, cache read and cache written remain separate. Assistant output can be provisional, so historical output and total tokens remain unavailable. The chart shows daily input. Historical costs and account quotas are not inferred from context size. Seven/thirty-day periods use local calendar days. Retention, missing files and sessions without persistence limit coverage. Each refresh rebuilds aggregates to handle append, rotation and truncation.

Baseline contract: Claude Code 2.1.273 / SDK 0.3.273, documented schema and controlled fixtures. No real Claude subscription was available for account verification. The [session format](https://code.claude.com/docs/en/sessions) is internal; the [cost-tracking contract](https://code.claude.com/docs/en/agent-sdk/cost-tracking) explains provisional response metrics.

### Pi

Default source: `~/.pi/agent/sessions` or `PI_CODING_AGENT_DIR/sessions`. The reader does not start Pi or expose authentication files or transcripts. Baseline: Pi 0.85.1, session header version 3, with synthetic usage generated through the official SessionManager; no billed activity was used.

All branches with saved usage, tool usage, compaction and branch summaries are included. Retained context and `tokensBefore` are not new spending. Forks link through `parentSession` without reading outside the chosen root. Original IDs and timestamps deduplicate within a session family; independent sessions may reuse short IDs. Missing/cyclic parents and conflicting copies mark partial coverage. Input/output/cache, total and estimated USD cost retain their source meanings. Pi provides no universal account quota.

### OpenCode

Default source: `XDG_DATA_HOME/opencode` or `~/.local/share/opencode`, respecting `OPENCODE_DB`. Multiple databases require an explicit choice. SQLite ships with Electron; runtime users do not need Python, sqlite3 or Node. The database opens read-only with coherent WAL snapshots and bounded busy retries. No server, migration, plugin or credential access is started.

Metrics sum native session counters: input, output, reasoning, separate caches and estimated USD cost. Copied messages and parts are not added. Periods select **sessions updated in the last 7/30 rolling days and include their lifetime consumption**, matching `opencode stats`. They do not date individual token usage and cannot produce a daily series. Deleted sessions and other databases are excluded.

Baseline: OpenCode 1.18.31 with an official-schema fixture and `stats --days 7` comparison; no real paid account activity. See the [versioned database contract](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/core/src/database/database.ts). WSL archives, remote servers and custom forks are not automatically discovered.

## Optional Claude quota bridge

The bridge is independent of local history. It receives the latest session's whitelisted quota windows, reset timestamps, estimated session cost and session identity through Claude's status line. It never queries private OAuth endpoints or reads authentication tokens. Prompts, transcripts, cwd and context payloads are discarded. Values from sessions or agents are never summed. Missing quota fields remain unavailable; spend limits can exceed 100%.

Windows Enable modifies only `statusLine` in the displayed user settings file. The previous command receives identical stdin and retains stdout; its other options are kept. A native helper is copied into Localino's `claude-bridge` data folder and only the previous statusLine value is backed up in `control.json`, not the whole potentially sensitive settings file. Disable stops collection, removes the cache and restores the previous statusLine only if Localino's installed value is still present. User edits are preserved with a conflict message. Keep the helper folder until the bridge is disabled/restored.

Windows settings updates use a local NTFS transaction for comparison and mutation. Unsupported volumes or APIs fail without a less safe overwrite. The Mac helper deliberately does not emulate an NTFS transaction with a read-then-rename write; Mac bridge activation remains a tracked implementation decision until the agreed alternative is integrated.

A configured bridge becomes effective only after a valid recent payload. Refresh reads the cache; new data depends on Claude activity, even with Localino hidden or closed. After 120 seconds the snapshot is stale, and an elapsed reset does not zero consumption. Project overrides, managed policy, startup flags and trust settings may prevent the command from running. Check project overrides and Claude `/status`; Localino does not overwrite them. A cache error does not interrupt the previous status line.

Baseline status-line contract: Claude Code 2.1.273 / SDK 0.3.273, native helper and controlled fixtures. Real Claude quota/account verification remains unavailable. See the [official status-line documentation](https://code.claude.com/docs/en/statusline).
