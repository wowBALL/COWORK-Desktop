# Title bar version label — design

## Problem
No way to tell which installed build is running without checking the installer filename or Task Manager. User wants the running version visible in the widget itself.

## Design
Small muted text `v1.3.2` placed immediately after the "◈ COWORK" title (chosen from 3 mocked placements — beside the title, centered in the gap, and right-aligned before the control buttons — user picked "beside the title").

- **Source of truth**: `app.getVersion()` in the main process (reads `package.json`'s `version` in dev, the packaged build's version when installed) — never hardcoded in `widget.html`, so it can't drift from a real build.
- **Wiring**: new `ipcMain.handle('get-app-version', () => app.getVersion())` in `main.js`; `preload.js` exposes `getVersion: () => ipcRenderer.invoke('get-app-version')`.
- **Rendering**: `widget.html` calls it once on load and fills a `<span id="appVer">` nested inside `.title`, styled small/muted/lowercase (overriding the title's uppercase + wide letter-spacing) so it reads as metadata, not part of the brand text.

## Out of scope
- Live-updating the label if the app self-updates while running (it always reflects the version the current process was launched with, which is correct — a relaunch after auto-update already happens).
