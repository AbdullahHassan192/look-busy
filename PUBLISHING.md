# Publishing Look Busy (Exact Steps)

## 1. Replace placeholders in `package.json`

Update these values before publishing:

- `publisher`: your Marketplace publisher ID 
- `repository.url`: your GitHub repo URL
- `homepage`: your repo README URL
- `bugs.url`: your repo issues URL

Current placeholders:

- `YOUR_PUBLISHER_ID`
- `YOUR_GITHUB_USER`

## 2. Create your Marketplace publisher

1. Go to the Visual Studio Marketplace publisher management page.
2. Create a publisher (or use an existing one).
3. Make sure the publisher ID exactly matches `package.json -> publisher`.

## 3. Create a PAT for publishing

1. Create an Azure DevOps Personal Access Token.
2. Give it Marketplace publish/manage scope.
3. Copy and save it securely.

## 4. Install VSCE

```bash
npm install -g @vscode/vsce
```

## 5. Login once

```bash
vsce login YOUR_PUBLISHER_ID
```

Paste your PAT when prompted.

## 6. Run pre-publish checks

```bash
npm run lint
npm run compile
npm run test
```

## 7. Package locally

```bash
npm run package:vsix
```

This creates a `.vsix` file in the project root.

## 8. Test local install

```bash
code --install-extension look-busy-0.0.1.vsix
```

Or install the `.vsix` manually from VS Code Extensions UI (`...` menu -> Install from VSIX).

## 9. Publish to Marketplace

Choose one:

```bash
vsce publish
```

or auto-bump version:

```bash
vsce publish patch
```

## 10. Post-publish checks

1. Open your Marketplace listing.
2. Confirm README formatting, badges/images, and command names.
3. Install from Marketplace in a clean VS Code profile and verify:
   - status bar launch button
   - command palette start command
   - panic/close behavior

---

## Icon suggestion (recommended style)

Theme: playful + suspiciously productive.

- **Shape:** simple rounded square background.
- **Main graphic:** keyboard + tiny theater mask or “busy spinner”.
- **Mood:** dark mode friendly; high contrast.
- **Palette idea:**
  - background: `#1E1E1E` or `#22272E`
  - accent: `#58A6FF`
  - warning/funny accent: `#F2CC60`
- **Size:** design at `512x512`, export a crisp `128x128` PNG for marketplace.

Suggested concept: a keyboard with a small fake “loading” spinner above it and a tiny eye emoji style dot, implying “performative productivity.”

---

## Screenshots and video/GIF for the extension page

### Screenshots (quick workflow)

1. Open VS Code with a demo project.
2. Start Look Busy and capture:
   - status bar button visible
   - active typing session with highlights
   - panic exit message with WPM
3. Use:
   - Windows: `Win + Shift + S`
   - macOS: `Cmd + Shift + 4`
4. Save under `media/` (e.g. `media/statusbar.png`, `media/session.png`).
5. Reference in README:

```md
![Start from status bar](media/statusbar.png)
![Typing session](media/session.png)
```

### Video / GIF (recommended for Marketplace)

Best approach: record short clips and convert to GIF.

Tools:

- **Windows:** ScreenToGif (easy GIF workflow) or OBS (video)
- **macOS:** QuickTime + GIF conversion

Suggested 15-25 second sequence:

1. Click **Start Looking Busy** in status bar.
2. Type through a snippet.
3. Hit `Esc` panic key.
4. Show WPM message.

Keep it tight, readable, and funny.
