# Look Busy

Terrified your boss will replace you with an agent if they catch you scrolling reels between prompts?

**Look Busy** launches a Monkeytype-style typing session directly inside your editor using real code from your current project. So you can hand off a task to Claude, Copilot, or Antigravity, trigger Look Busy, and look intensely productive until the prompt finishes.

![Look Busy demo](https://raw.githubusercontent.com/AbdullahHassan192/look-busy/master/media/demo.gif)

## How it works

When an AI prompt takes time to run, spinning in your chair or checking your phone invites questions. Look Busy gives your hands something urgent to do:

- **Uses your own code.** It pulls functions and classes directly from your active project.
- **Ghost text guidance.** Upcoming code renders in muted ghost text. As you type, matching characters lock in and the cursor advances.
- **Panic switch (`Esc`).** Hit escape at any moment. The mock document closes instantly with no save dialogs, leaving your workspace completely clean.
- **Exit stats.** Every session calculates your typing speed and displays your WPM.

## Safe by design

Look Busy runs inside temporary throwaway files. It never edits your actual project files, never stages uncommitted changes, and never prompts you to save on exit.

## How to use

Start a session:
- **Status bar:** Click **Start Looking Busy** in the bottom status bar.
- **Shortcut:** `Ctrl+Alt+B` (Windows/Linux) or `Cmd+Alt+B` (macOS).
- **Command Palette:** Run `Look Busy: Start Workspace Session`.

Exit a session:
- Press `Esc` at any time to immediately close the session and view your stats.

## Supported languages

Look Busy detects and styles code across more than 30 formats, including TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, Dart, Zig, Lua, Elixir, PHP, Ruby, Swift, Kotlin, SQL, HTML, CSS, and Markdown.

If you start a session without an open workspace, the extension falls back to a built-in pack of classic algorithms and data structures.

## Feedback

Found an issue or want to suggest new exit messages? Open an issue on [GitHub](https://github.com/AbdullahHassan192/look-busy/issues).
