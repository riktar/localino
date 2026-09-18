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
