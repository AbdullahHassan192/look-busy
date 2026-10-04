# Change Log

All notable changes to the "look-busy" extension will be documented in this file.

## [Unreleased]

## [0.1.0] - 2026-10-05

### Fixed

- Editing keys are no longer swallowed in other editors. While a session is running, `Esc`, `Enter`, `Shift+Enter`, `Tab`, `Backspace`, `Delete`, paste, cut, undo and redo were bound by a context key that stayed true after focus moved away from the session tab. Paste, cut, undo and redo did nothing at all in those editors. The key now tracks which editor has focus.
- Input method composition no longer gets erased. VS Code sends composed characters through a different command than plain typing, so they bypassed the session and were then reverted by the change guard. They are now routed into the session, and the handlers are only registered while the session editor has focus so input methods keep working everywhere else.
- No more extension host error when a session ended while a keystroke was still being handled. The code read session state after an `await` without re-checking that the session still existed.
- Starting a session twice in quick succession no longer leaves an orphaned temp file and a stray editor tab. Concurrent invocations now collapse into one.
- Keystroke handling is serialised, so two overlapping handlers can no longer apply document edits out of order.
- Session teardown no longer depends on every step succeeding. A failure while closing the tab no longer leaves the temp file behind, the decorations painted, or the exit stats unshown.
- Extension deactivation no longer fires an event emitter after disposing it.

### Changed

- Typing is dramatically cheaper on large files. The typed-character count is now tracked incrementally instead of rescanning the file on every keystroke, decoration scans only cover the cursor's line instead of everything typed above it, and advancing a line appends one line to the document instead of rewriting the whole thing.
- Hiding the suggest widget is throttled instead of costing two command round trips per keystroke, and saving the temp file is debounced.
- The workspace scan shows a cancellable progress notification, and stops early when cancelled.
- Cheaper filename-based rejection runs before any file is opened, so lockfiles and generated files are no longer read at all.
- The built-in fallback library went from 4 distinct algorithms to 12, with 6 snippets per language pack.

### Added

- Settings: `lookBusy.source`, `lookBusy.ghostLinesAhead`, `lookBusy.showStatusBarButton`.

### Security

- The extension declares that it does not support untrusted workspaces, since it reads file contents from your project.
- The extension declares `extensionKind: ["ui"]` so it does not run on the remote side of an SSH or Codespaces window.

## [0.0.1] - 2026-10-04

- Initial release: Monkeytype-style typing sessions inside the editor using real code from the current project.
- Workspace source selection with active-file prioritisation, low-signal filtering and `.gitignore` awareness.
- Ghost text guidance, automatic indentation matching, and a panic key (`Esc`) that closes the session with no save prompt.
- WPM and accuracy stats on session exit, with snarky comments.
- Fallback to a built-in pack of classic algorithms when no workspace file qualifies.
- In-session edit guarding that reverts unexpected document mutations.
- Typing scope set to full-file content, skipping the leading boilerplate and import header.