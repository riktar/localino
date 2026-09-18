# macOS candidate test report

Copy this template for each tested commit and architecture. `Pending` is not a pass.

| Environment | Value |
|---|---|
| Commit | Pending - record the exact candidate commit |
| Tester / date | Pending |
| macOS / architecture | Pending |
| Node / npm / Xcode SDK | Pending |
| Artifact / checksum | Pending |
| Signing identity / helper path | Pending |
| TextEdit / Chromium / VS Code versions | Pending |

| Check | Pass / Fail / Pending | Evidence and limits |
|---|---|---|
| Clean install, typecheck, lint, unit tests | Pending | |
| Common and native compilation | Pending | Historical SPRINT-004 run 35322576757 tested `f21728c`, not the candidate recorded above; rerun both architectures for this report. |
| Automatic Claude bridge enable, payload forwarding, restart and restore | Pending | Historical SPRINT-004 packaged coverage at `f21728c` is not evidence for this candidate; physical Claude session also remains pending. |
| Electron integration tests | Pending | |
| Package, signing and helper launch | Pending | |
| Single panel, menu bar, activation, close and quit | Pending | |
| Always-on-top, focus, monitor and scaling | Pending | |
| Clipboard CRUD, Unicode, multiselect and copy | Pending | |
| Draft guards and failure recovery | Pending | |
| All agents, quota details and data qualifiers | Pending | |
| Supervised CLI discovery/start/stop and owned-process cleanup | Pending | Record each installed CLI version and protocol; missing binaries are a valid unavailable case, not a protocol pass. |
| Concurrent session identity, state, timer and exact routing | Pending | Test two same-agent/project instances and one different agent. |
| Send receipt, terminal lifecycle, FIFO queue and cancellation | Pending | Use multiline Unicode and record provider-specific evidence without transcript content. |
| Unknown/suspended delivery and restart recovery without resend | Pending | Confirm no replacement CLI starts after relaunch. |
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
