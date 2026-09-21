# Panel regression coverage

The central panel replaces Home, the separate quota panel, standalone Clipboard and shortcut pages, and the capture recovery window. The usage dashboard remains subordinate to the panel. There are no switches to restore the removed interfaces.

| Previous guarantee | Current coverage |
| --- | --- |
| App startup, isolated renderer, hide/close/reopen | `desktop`, `development`, `packaged`, `panel` |
| Navigation, tray commands, second instance | `navigation`, `panel` |
| Exact note CRUD, restart, corrupt files, failed writes, 1,000-note search | `clipboard` |
| Ordered multi-copy, keyboard context menu, editing guards, retained scroll | `panel-clipboard`, `note-selection` unit tests |
| Command catalog, contextual editing, OS conflicts, persisted bindings | `shortcuts` desktop and unit tests; legacy v1 migration and Mac key normalization added |
| All quota windows, missing values, exhaustion, stale data, local timezone | `quotas-ui`, quota unit tests |
| Sparse usage, chart keyboard access, credits, independent errors | `dashboard`, usage unit tests |
| Agent synchronization, source isolation, privacy, large archives | `agents`, `local-history`, `pi-history`, `opencode-history` |
| Claude status-line preservation, concurrent settings edits, cache privacy | `bridge` desktop and unit tests |
| Capture protocol, one save, manual-draft recovery, missing helper | `capture` desktop and unit tests |
| Supervised CLI identity/lifecycle, exact Send, FIFO Queue, duplicate events, uncertain receipt and suspended restart recovery | `sessions-ui`, `session-contracts`, `sessions` and `session-recovery` unit tests |
| Live Codex account, quotas and usage comparison | `test:account`, `test:rates`, `test:dashboard`; require an opted-in signed-in CLI |

Run desktop suites serially: they share system focus and global shortcut registration. Synthetic fixtures are not evidence that every external editor or agent version is supported. Real macOS capture, permissions, focus, signing and packaged lifecycle results belong in the [Mac report](mac-test-report.md), tied to the exact commit and artifact.
# Embedded terminal coverage

- `tests/unit/terminal.test.ts`: visible escaping of provider control sequences and bounded viewport validation.
- `tests/ink.test.mjs`: bundled Ink, 5,000 Unicode updates, independent streams, repeated mounts and worker cleanup.
- `tests/terminal-ui.test.mjs`: embedded xterm, Unicode, sandbox, invalid IPC, resizing and packaged ASAR worker.
- `tests/terminal-dev.test.mjs`: cold `npm run dev` and automatic worker regeneration after a source change (`npm run test:terminal:dev`, run serially because it rebuilds generated output).
- These are feasibility checks. Full transcript retention, provider streaming and the large-dataset acceptance are separate sprint checks.
# Transcript persistence

`tests/unit/transcript.test.ts`: normalized observable kinds, exact event identity,
offset duplicates/conflicts, late/final states, unknown/gap handling, restart,
checksums, corrupt/torn file preservation, disk-full, oversize and selective delete.
`tests/transcripts.test.mjs`: 100,000 events / >100 MiB independently checked,
segmentation, bounded pages, responsive Electron during worker replay, interrupted
recovery with no provider start, Clipboard privacy and native delete confirmation.
# Provider streaming

- `tests/unit/provider-transcript.test.ts`: frozen Codex/Claude/Pi/OpenCode contracts, source identities, delta/final replacement, stale messages, published reasoning and field selection.
- `tests/unit/sessions.test.ts`: malformed/oversized process isolation, stderr exclusion, same-server SSE recovery and no prompt resend.
- `tests/provider-volume.test.ts`: 100,000 provider deltas through normalization, batching, worker storage and bounded live projection; independent disk text/offset oracle.
- `tests/provider-stream.test.mjs`: 1,000 deltas/s from an owned fixture process through storage and Ink; rendered text latency, input and scroll scheduling.
- `scripts/probe-transcript-live.ts`: explicitly invoked authenticated read-only probe. Fixture coverage does not replace this evidence; unavailable binaries and expired authentication are reported separately.
