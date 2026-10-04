# Change Log

All notable changes to the "look-busy" extension will be documented in this file.

## [Unreleased]

- Switched to a workspace-only typing experience focused on real project files.
- Improved workspace snippet targeting (active file prioritization and low-signal filtering).
- Added stronger in-session edit guarding by reverting unexpected document mutations.
- Tuned stats to reduce unrealistic speed spikes from extremely short elapsed times.
- Switched typing scope to full-file content (while skipping leading boilerplate/import header for required typing start).
- Session stats are now shown whenever a session exits (complete, panic, close, or restart).
