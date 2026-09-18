# macOS verification

Run this guide from the candidate commit on a Mac with an interactive desktop. Windows results do not establish macOS compatibility. Record all results in [mac-test-report.md](mac-test-report.md), including failures and skipped checks. Do not publish a production build before the required checks pass.

## Prepare

Use macOS 13 or later ([Electron 44 platform support](https://www.electronjs.org/blog/electron-44-0)). Install Node.js 22.12 or later, npm, Git and the Xcode command line tools (`xcode-select --install`). Clone the repository and check out the exact candidate commit. Record `git rev-parse HEAD`, `sw_vers`, `uname -m`, `node --version`, `npm --version` and `xcrun clang --version`.

Use a dedicated test account or a disposable Localino profile. Use synthetic notes and selections; do not attach account credentials, raw agent session logs or private selections to the report. Agent connections are opt-in.

## Build and automated checks

`npm run dev` compiles and signs the native helpers before starting Electron. A clean clone therefore does not require a separate native-build command. If Xcode tools are missing, fix the compiler error before retrying. Do not copy Windows `.exe` helpers onto a Mac.

The `macOS validation` GitHub Actions workflow compiles helpers, tests the gesture state machine and unit contracts (including real native bridge setup/restore), then builds and verifies an ad hoc bundle on arm64 and Intel macOS runners. Its artifacts are for testing. CI does not grant capture permissions or prove physical gestures, interactive focus, or notarization. Check the exact run result; the presence of this workflow is not a passing result.

From the repository root, run these commands and retain their exit codes:

```sh
npm ci
npm run check
npm run build:mac
npm run test:packaged
```

`build:mac` targets the host architecture. To prepare another target, use `npm run build:mac:arm64` or `npm run build:mac:x64`. Each command rebuilds both native helpers for that architecture before packaging the app. Do not combine outputs from separate builds. Artifacts are ZIP and DMG files in `dist/`; the unpacked app is in `dist/mac-arm64` (arm64) or `dist/mac` (x64).

For a non-host artifact set `LOCALINO_TEST_EXECUTABLE` to its full `Localino.app/Contents/MacOS/Localino` path before running `test:packaged`. Execute both architectures on compatible hardware; an x64 run under Rosetta must be identified as such. Record an unavailable native architecture as pending.

The default signing identity is ad hoc (`-`), intended for this local verification. Check `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Localino.app` (use `dist/mac` for x64). These builds are not notarized. Public signing and notarization require a separate configured identity and are not demonstrated by an ad hoc signature. Record any Gatekeeper or permission issue; do not remove quarantine or disable platform protection to manufacture a passing result.

Automated capture fixtures test Localino's protocol and recovery. They do not test Accessibility access or physical double-Shift detection in another app. Complete the native checks below on the installed bundle.

After granting the required permissions, `npm run test:capture:native` tests real selection acquisition from an owned external Electron text field. Run it again with `LOCALINO_TEST_PACKAGED=1` to use the packaged Localino app. It asserts exact text, unchanged source clipboard and panel focus. Its trigger is IPC, so it does not replace the physical gesture tests or the required external-editor matrix.

## Required desktop checks

- Drag the app header to move both frameless windows; header buttons remain clickable. Test dashboard minimize, maximize/restore and close-to-panel.
- Check System (default), Light and Dark themes in both windows, persistence after restart and live changes to macOS appearance. Enable Reduce Motion and confirm transitions stop.
- Open Localino. Only the compact panel appears. Open it again from the menu bar and a second app launch; confirm there is no duplicate panel.
- Keep another app focused. Localino stays above ordinary windows without repeatedly taking focus. Close and minimize Localino: it remains available from the menu bar. Quit ends the app and its capture helper.
- Open advanced usage, then return with Back, the window close button, the menu bar and the app activation shortcut. Only one operating window is visible at a time; the dashboard is reused.
- Test 420 × 640 and 360 × 460 points, Retina scaling, a second display, moving the menu bar and disconnecting a monitor. Controls remain reachable and the panel stays in the work area.
- Use the keyboard throughout: visible focus, named icon actions, agent picker, Details, search, filters, context menu and all confirmation choices.
- Create, edit, complete, reopen, search and delete notes. Relaunch and verify exact Unicode, CRLF, whitespace and timestamps are preserved.
- Select several notes in a different click order. Copy all must copy newest first, with exactly one LF between complete note texts. Change the filter and confirm selection resets. Test a missing/deleted ID: no partial copy and no false success.
- Edit a note, then hide, close, quit, open settings or advanced usage. Test Save, Discard and Stay. Escape in the confirmation means Stay; text and editor focus remain. A failed save keeps the draft.
- Switch between all four agents without opening advanced usage or connecting automatically. Connect and disconnect each available source voluntarily. Cancel source pickers. Account/source errors must not prevent clipboard use.
- Compare compact quota values with Details. Include missing values, 0% remaining, multiple windows, an exhausted secondary limit and stale data. Local history is not an account quota. Costs retain their estimate qualifier.
- Verify Cmd shortcuts, custom and disabled bindings, collisions and migration from a copy of the previous `shortcuts.json`. Standard text editing and IME input remain native.

## Native capture and privacy

Use TextEdit, a Chromium text field and VS Code (`editor.accessibilitySupport: on`). Record exact app versions. Repeat from the packaged app as well as the development build.

- Deny Accessibility and Input Monitoring initially. Localino must explain the missing permission with a recovery action; clipboard and manual note entry remain usable.
- Grant the requested permissions, retry, then restart the app. Record the identity/path shown in System Settings. Revoke each permission while running and verify recovery without an unbounded worker or stale capture.
- Select synthetic text and press/release Shift twice within 350 ms. Exact text saves once, appears selected newest first in the Clipboard list and receives focus, without opening the full-note view. Repeat with active search/filter and an existing manual draft. Measure acquisition and presentation from capture Details.
- A single Shift, held/repeated Shift, two simultaneous Shift keys, Shift plus a letter/modifier, slow taps and injected events must not capture. Disabling the gesture must stop detection.
- Test empty selection, inaccessible/custom controls, a password field, text above 100,000 characters and a foreground-app change during acquisition. Do not fall back to reading the entire control, clipboard substitution or keystroke injection. Show editable recovery when needed.
- During acquisition, switch between two windows of the same application and between two controls in the same window. A changed focus, window or selection must discard the stale result and open recovery; matching only the application PID is insufficient.
- Keep an unsaved manual draft, then capture text externally. The captured note is saved and the manual draft can be resumed intact. Repeat rapidly: no duplicate save or lost draft.
- Recovery: Save, failed save, Cancel, Hide, Quit and Escape inside confirmation. On cancellation the original application is restored where the OS permits; failed focus must not silently imply success.
- Suspend/resume, terminate the test helper, retry and quit. Confirm workers time out and no owned helper remains after quit. Do not terminate unrelated processes.

## Automatic Claude bridge

Enable **Session quota bridge** in Claude usage. Localino installs an executable helper without an `.exe` suffix, configures the quoted command in Claude settings, and preserves/forwards any previous status-line command. No shell, Node or .NET installation is required by the distributed helper beyond macOS system tools. Start a Claude session to confirm delivery, then disable the bridge and check restoration.

Settings updates use native file coordination, a lock shared by Localino writers, a hash/identity recheck and atomic replacement. Observed conflicts are rejected. These locks are advisory: an unrelated program that ignores file coordination can still race the final replacement. Avoid editing Claude settings during enable/disable; this is not the Windows NTFS transaction guarantee. Only the previous `statusLine` is kept in Localino's control file, not a backup of unrelated settings. Collection/control updates share a native lock so disabled or old-generation snapshots cannot reappear.

Test with disposable `CLAUDE_CONFIG_DIR` settings first: absent/existing files, paths with spaces/apostrophes, an existing status-line command, preservation of unrelated keys, restart, disable/re-enable and a user-edited status line. A conflict or invalid JSON must leave the user's settings intact. Test the installed command with Node absent from PATH and with Localino closed. Retain actual Claude-session verification separately from synthetic payload tests.

## Packaging and evidence

Build and test both arm64 and x64 artifacts where machines are available. Cross-compilation alone does not prove runtime support; explicitly mark any untested architecture pending. Verify helper executability, bundle signing, permission persistence across relaunch and launch from the unpacked ZIP. Signing for local testing is not notarization or production distribution.

Attach command output, non-sensitive screenshots and the completed report. Every result must refer to the tested commit, OS, architecture and artifact. Return failures with reproduction steps so fixes can be tested on a new exact commit.
