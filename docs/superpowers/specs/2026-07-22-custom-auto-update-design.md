# Custom auto-update (path-aware) — design

## Problem
Auto-update was removed entirely (commit `31c400d`, documented in `CHANGELOG.md` v1.3.3) after discovering electron-updater's NSIS silent install always writes to the default per-user path (`%LOCALAPPDATA%\Programs\COWORK Desktop`), ignoring the directory chosen during a manual install via `allowToChangeInstallationDirectory: true`. This is a confirmed, currently-unresolved upstream bug in electron-builder/electron-updater (electron-builder issue #1106; a matching regression was reported in another project, opencode issue #26818, as recently as May 2026) — there is no documented config flag that fixes it.

The user's install lives at a custom path (`D:\Program\COWORK Desktop`), so this bug is not hypothetical — it produced two divergent installs on one real machine during testing.

## Decision
Drop `electron-updater` as a dependency (already done) and write a small custom updater directly in `main.js` that explicitly controls the NSIS install directory via the standard `/D=` silent-install flag, instead of relying on electron-updater's opaque `quitAndInstall()`.

## Design

### 1. Check for updates
```js
async function checkForUpdate() {
  const res = await fetch('https://api.github.com/repos/wowBALL/myjobs/releases/latest');
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const release = await res.json();
  const latest = release.tag_name.replace(/^v/, '');
  if (!isNewer(latest, app.getVersion())) return null;
  const asset = (release.assets || []).find(a => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
  if (!asset) throw new Error('ไม่พบไฟล์ .exe ใน release ล่าสุด');
  return { version: latest, url: asset.browser_download_url, name: asset.name };
}
function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i]||0) !== (pb[i]||0)) return (pa[i]||0) > (pb[i]||0); }
  return false;
}
```
No GitHub token needed — the repo is public. Finding the `.exe` asset dynamically (rather than expecting a fixed filename like electron-updater's `latest.yml` does) sidesteps the exact asset-naming-mismatch bug hit earlier when publishing via `gh release create`.

### 2. Download
Fetch the asset URL, stream to a cache file (e.g. `app.getPath('temp')/cowork-desktop-update/<name>`). Reuses the same plain `fetch` pattern already used for Redmine calls — no new dependency.

### 3. Install — the part that actually fixes the bug
```js
function installUpdate(installerPath) {
  const installDir = path.dirname(process.execPath);
  const child = spawn(installerPath, ['/S', '/D=' + installDir], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 400); // give the detached child time to fully launch before we release file locks
}
```
Key details:
- `installDir` comes from `process.execPath` of the **currently running** process — always correct, no guessing, no registry lookups.
- `/D=` is standard NSIS silent-install syntax for overriding `$INSTDIR`; it must be the **last** argument and must **not** be quoted — passing it as a `spawn()` array element (not a shell string) already avoids adding surrounding quotes, so this falls out naturally as long as we don't switch to `shell: true` or string concatenation.
- `/S` runs the installer fully silently (no NSIS UI at all, so the directory-picker page is skipped entirely — `/D=` supplies that value instead).
- Spawn detached + unref before quitting, so the installer isn't killed when our process exits and isn't blocked waiting on us.

### 4. UX — unchanged from the old electron-updater flow
Same `dialog.showMessageBox` prompt ("มีเวอร์ชันใหม่ (X) พร้อมติดตั้ง" / restart now vs. later), checked once on startup and every hour, same as the removed code. Only the internals of "install" change.

### 5. Logging
Log every step (`checkForUpdate` result, download start/end, install invocation) to console with a consistent `[updater]` prefix — the previous debugging session (SmartScreen, 404s, wrong install path) was slow specifically because failures were silent. Being verbose here costs nothing and pays off the next time something breaks.

## Out of scope for this round
- Signature/hash verification of the downloaded installer (electron-updater's `latest.yml` sha512 check is lost by not generating that file; could add a manual sha256 comparison later if desired, low priority for an internal tool over HTTPS from GitHub).
- Any UI change beyond the existing restart-now/later dialog.
- Auto-detecting whether the app was installed per-machine vs per-user — `nsis.perMachine` is already `false`, so this only needs to handle the per-user case.

## Testing plan (before considering this fixed)
Must be verified against the exact scenario that broke before: a real install at a **custom, non-default directory** (`D:\Program\COWORK Desktop` on the dev machine), confirming after an auto-update that:
1. No second copy appears anywhere else on disk.
2. The Start Menu shortcut still points at the same, single install directory.
3. `app.getVersion()` in the running app matches the new release.
