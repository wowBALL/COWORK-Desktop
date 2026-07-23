# In-app Redmine settings (URL + API key) — design

## Problem
Today `REDMINE_URL`/`REDMINE_API_KEY` only come from a `.env` file, which `package.json`'s `extraResources` bakes into every built installer (`resources/.env`). That means **every packaged installer currently ships Ball's real Redmine API key** — anyone who installs it and looks in the resources folder can read it, and everyone who installs it hits Redmine as Ball regardless of who they actually are. This blocks distributing the app to other users. Needs a per-user, in-app way to set their own credentials, stored locally per machine, never baked into the installer.

## Design

### Storage
A JSON file in Electron's per-user `userData` directory (`app.getPath('userData')/config.json`, e.g. `%APPDATA%\COWORK Desktop\config.json`) — separate from the install directory, so it survives reinstalls/updates and is never touched by the installer or shipped in the package.
```json
{ "redmineUrl": "https://proj.example.com", "redmineApiKey": "..." }
```

### Config loading precedence (`main.js`)
```js
let redmineConfig = { url: '', apiKey: '' };
function loadRedmineConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    redmineConfig = { url: saved.redmineUrl || '', apiKey: saved.redmineApiKey || '' };
    return;
  } catch {}
  if (!app.isPackaged) redmineConfig = { url: ENV.REDMINE_URL || '', apiKey: ENV.REDMINE_API_KEY || '' };
}
```
- Packaged builds: only `config.json` (starts empty until the user fills in Settings).
- Unpackaged dev runs (`npm start`): fall back to the local `.env` next to the source if no `config.json` exists yet, so local development doesn't require clicking through Settings every time. `.env` is **no longer packaged** — remove the `extraResources` entry for it from `package.json`'s build config.

Every place in `main.js` currently reading `ENV.REDMINE_URL` / `ENV.REDMINE_API_KEY` (`fetchRedmineTasks`, `getCurrentUserName`, `getStatusId`, the `get-issue-preview` and `close-issue` handlers) switches to `redmineConfig.url` / `redmineConfig.apiKey`. `WORKSPACE_DIR` stays exactly as-is (still from `.env`/default) — out of scope here.

### New IPC surface
```js
ipcMain.handle('get-redmine-config', () => ({ url: redmineConfig.url, apiKey: redmineConfig.apiKey }));
ipcMain.handle('test-redmine-connection', async (_e, { url, apiKey }) => {
  try {
    const res = await fetch(`${url}/users/current.json`, { headers: { 'X-Redmine-API-Key': apiKey } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const { user } = await res.json();
    return { ok: true, userName: `${user.firstname} ${user.lastname}`.trim() };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('save-redmine-config', (_e, { url, apiKey }) => {
  redmineConfig = { url, apiKey };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ redmineUrl: url, redmineApiKey: apiKey }, null, 2));
  currentUserCache = null; statusIdCache = null; // stale, tied to old credentials
  pushTasks(); // refresh immediately, no restart needed
  return { ok: true };
});
```
`test-redmine-connection` validates whatever the user is currently typing (not yet saved) — lets Settings show "เชื่อมต่อสำเร็จ · สวัสดี ‹name›" before they commit, using the same `/users/current.json` call `getCurrentUserName()` already makes.

### Frontend (`widget.html`)
- New gear icon button in `.ctrls` (next to pin/maximize/close), always visible regardless of which tab is active.
- New `#settingsView`, a third top-level view alongside `#redmineView`/`#workspaceView` (same show/hide pattern already used for the Redmine/Workspace tabs). Contains: Redmine URL input, API key input (reuses the existing `.search` input style — no new CSS needed), a connection-status line, Save/Cancel buttons. On open, pre-fills from `api.getRedmineConfig()`.
  - Save → `api.saveRedmineConfig({url, apiKey})`, then close the panel back to whatever view was showing before.
  - A "ทดสอบการเชื่อมต่อ" step happens automatically on save (or as a live check while typing, debounced) — shows green "เชื่อมต่อสำเร็จ · สวัสดี ‹name›" or a red error inline, matching the mockup.
- **Not-configured banner**: `main.js`'s "missing config" error message changes from `'ยังไม่ได้ตั้งค่า .env'` to `'ยังไม่ได้ตั้งค่า Redmine'`. `renderTasks()` in `widget.html` special-cases this exact string: instead of the generic red error hint, it renders a banner with the message plus a "ตั้งค่าเลย" button that opens `#settingsView` directly. Per the user's choice, this is **non-blocking** — the rest of the widget (Workspace tab, clock, etc.) stays fully usable; only the Redmine task list area shows the prompt.

## Out of scope
- Encrypting/obscuring the API key at rest (plaintext JSON in `userData`, same trust boundary as the local filesystem already provides — no OS keychain integration).
- Moving `WORKSPACE_DIR` into the same settings UI.
- Any change to the currently-shipped installers (v1.3.x already have Ball's key baked in) — this fixes it going forward only. Worth a heads-up to the user that past installers had this exposure; whether to rotate the API key is their call, not something this change does automatically.
