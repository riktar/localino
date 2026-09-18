# macOS candidate test report

Copy this template for each tested commit and architecture. `Pending` is not a pass.

| Environment | Value |
|---|---|
| Commit | f21728cc6b5b2d3a1fe74423049d9ddbdeffa5e0 |
| Tester / date | Pending |
| macOS / architecture | Pending |
| Node / npm / Xcode SDK | Pending |
| Artifact / checksum | Pending |
| Signing identity / helper path | Pending |
| TextEdit / Chromium / VS Code versions | Pending |

| Check | Pass / Fail / Pending | Evidence and limits |
|---|---|---|
| Clean install, typecheck, lint, unit tests | Pending | |
| Common and native compilation | Pass (CI arm64 + Intel) | GitHub Actions run 35322576757; both architectures compiled helpers and packaged ad hoc bundles. |
| Automatic Claude bridge enable, payload forwarding, restart and restore | Pass (CI arm64 + Intel) | Packaged bridge test passed on both macOS architectures; physical Claude session still pending. |
| Electron integration tests | Pending | |
| Package, signing and helper launch | Pending | |
| Single panel, menu bar, activation, close and quit | Pending | |
| Always-on-top, focus, monitor and scaling | Pending | |
| Clipboard CRUD, Unicode, multiselect and copy | Pending | |
| Draft guards and failure recovery | Pending | |
| All agents, quota details and data qualifiers | Pending | |
| Cmd shortcuts, migration and text editing | Pending | |
| Accessibility / Input Monitoring grant, deny, revoke | Pending | Must be run by colleague on a real Mac. |
| Double Shift positive and negative cases | Pending | Native FSM self-test passed in CI; physical keyboard gesture remains pending. |
| TextEdit capture | Pending | |
| Chromium capture | Pending | |
| VS Code capture | Pending | |
| Password, empty, timeout, long selection, foreground change | Pending | |
| Capture with suspended manual draft | Pending | |
| Recovery cancellation, focus and guard Escape | Pending | |
| Suspend, helper crash, retry and process cleanup | Pending | |
| English UI, help, native dialogs and documentation | Pending | |
| Sketch alignment and usability | Pending | |

## Failures

For each failure: expected behavior, observed behavior, exact steps, affected commit, logs/screenshots, proposed retest. Keep product acceptance separate from technical test results.
