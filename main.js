const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readWorkspace } = require('./workspace');

const MODE = process.argv.includes('--screensaver') ? 'screensaver' : 'widget';
let win;

function loadEnv() {
  // dev: .env next to the source; packaged: .env shipped as an extraResource
  const candidates = [
    path.join(__dirname, '.env'),
    process.resourcesPath && path.join(process.resourcesPath, '.env'),
  ].filter(Boolean);
  const envPath = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!envPath) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}
const ENV = loadEnv();

// ---- custom auto-update (path-aware) ----
// electron-updater's NSIS silent install ignores custom install directories
// (confirmed unfixed upstream bug) — this replaces it with an explicit
// /S /D=<install dir> silent install derived from process.execPath.
// See docs/superpowers/specs/2026-07-22-custom-auto-update-design.md
const UPDATE_REPO = 'wowBALL/COWORK-Desktop';

function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

async function checkForUpdate() {
  const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
    { headers: { 'User-Agent': 'COWORK-Desktop-Updater', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const release = await res.json();
  const latest = release.tag_name.replace(/^v/, '');
  if (!isNewerVersion(latest, app.getVersion())) return null;
  const asset = (release.assets || []).find(a => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
  if (!asset) throw new Error('ไม่พบไฟล์ .exe ใน release ล่าสุด');
  return { version: latest, url: asset.browser_download_url, name: asset.name };
}

async function downloadUpdate(update) {
  const dir = path.join(app.getPath('temp'), 'cowork-desktop-update');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, update.name);
  console.log('[updater] downloading', update.url);
  const res = await fetch(update.url);
  if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('[updater] downloaded to', dest);
  return dest;
}

function installUpdate(installerPath) {
  const installDir = path.dirname(process.execPath);
  console.log('[updater] installing to', installDir);
  // Generic NSIS docs say /D= must be unquoted even with spaces in the path — tested against
  // this actual electron-builder-generated installer, that's wrong: unquoted truncates the
  // path at the first space (confirmed: "D:\Program\COWORK Desktop" -> "D:\Program\COWORK").
  // Quoting it, plus windowsVerbatimArguments so Node doesn't add its own escaping on top,
  // is what actually works.
  const child = spawn(installerPath, ['/S', '/D="' + installDir + '"'],
    { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
  child.unref();
  setTimeout(() => app.quit(), 400); // let the detached installer fully launch before we release file locks
}

async function runUpdateCheck() {
  if (!app.isPackaged) return; // only meaningful for installed builds
  try {
    const update = await checkForUpdate();
    if (!update) { console.log('[updater] up to date'); return; }
    console.log('[updater] found version', update.version);
    const installerPath = await downloadUpdate(update);
    dialog.showMessageBox({
      type: 'info',
      title: 'COWORK Desktop',
      message: `มีเวอร์ชันใหม่ (${update.version}) พร้อมติดตั้ง`,
      detail: 'รีสตาร์ทตอนนี้เพื่ออัปเดต หรือจะอัปเดตครั้งถัดไปที่เปิดโปรแกรมก็ได้',
      buttons: ['รีสตาร์ทตอนนี้', 'ไว้ทีหลัง'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => { if (response === 0) installUpdate(installerPath); });
  } catch (e) {
    console.error('[updater]', e.message);
  }
}

function setupAutoUpdate() {
  runUpdateCheck();
  setInterval(runUpdateCheck, 60 * 60 * 1000);
}

const STATUS_ORDER = ['Backlog', 'New', 'In Progress', 'Test', 'Resolved'];
// low → high severity; index used to pick the worst when an issue has several
const RISK_ORDER = ['Low', 'Fairly Low', 'Moderate', 'Medium', 'High'];

function fmtDateTime(iso) {
  const d = new Date(iso), p = x => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function topRisk(issue) {
  const cf = (issue.custom_fields || []).find(f => f.name === 'Risk Level');
  if (!cf) return '';
  const vals = Array.isArray(cf.value) ? cf.value : (cf.value ? [cf.value] : []);
  let best = '', bestRank = -1;
  for (const v of vals) {
    const r = RISK_ORDER.indexOf(v);
    if (r > bestRank) { bestRank = r; best = v; }
  }
  return best;
}

let statusIdCache = null;
async function getStatusId(name) {
  if (!statusIdCache) {
    const res = await fetch(`${ENV.REDMINE_URL}/issue_statuses.json`, { headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY } });
    if (!res.ok) throw new Error(`โหลดสถานะไม่สำเร็จ (HTTP ${res.status})`);
    const data = await res.json();
    statusIdCache = {};
    for (const s of data.issue_statuses || []) statusIdCache[s.name] = s.id;
  }
  return statusIdCache[name];
}

async function fetchRedmineTasks() {
  if (!ENV.REDMINE_URL || !ENV.REDMINE_API_KEY) return { groups: [], error: 'ยังไม่ได้ตั้งค่า .env' };
  try {
    const url = `${ENV.REDMINE_URL}/issues.json?status_id=open&limit=100&include=custom_fields&sort=project:asc,priority:desc`;
    const res = await fetch(url, { headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY } });
    if (!res.ok) return { groups: [], error: `Redmine HTTP ${res.status}` };
    const data = await res.json();
    const byStatus = new Map();
    for (const issue of data.issues || []) {
      const status = issue.status?.name || 'อื่นๆ';
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status).push({
        id: issue.id,
        subject: issue.subject,
        project: issue.project?.name || '',
        projectId: issue.project?.identifier || issue.project?.id || '',
        assignee: issue.assigned_to?.name || 'ไม่ระบุ',
        status,
        risk: topRisk(issue),
        createdOn: issue.created_on,
        updatedOn: issue.updated_on,
        url: `${ENV.REDMINE_URL}/issues/${issue.id}`,
      });
    }
    const orderedNames = [...STATUS_ORDER, ...[...byStatus.keys()].filter(s => !STATUS_ORDER.includes(s))];
    const groups = orderedNames
      .filter(s => byStatus.has(s))
      .map(s => ({ status: s, issues: byStatus.get(s) }));
    return { groups, error: null };
  } catch (e) {
    return { groups: [], error: e.message };
  }
}

function pushTasks() {
  if (!win) return;
  fetchRedmineTasks().then(payload => win && win.webContents.send('tasks-update', payload));
}

// A_Workspace markdown vault — default to the sibling folder of this project
const WORKSPACE_DIR = ENV.WORKSPACE_DIR || path.join(__dirname, '..', 'A_Workspace');
function pushWorkspace() {
  if (!win) return;
  let payload;
  try { payload = readWorkspace(WORKSPACE_DIR); }
  catch (e) { payload = { error: e.message }; }
  win.webContents.send('workspace-update', payload);
}

function createWidget() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const W = 420, H = 640;
  win = new BrowserWindow({
    width: W,
    height: H,
    x: width - W - 24,       // dock bottom-right
    y: 60,
    frame: false,             // no title bar
    transparent: true,        // rounded floating panel
    resizable: true,
    minWidth: 320,
    minHeight: 420,
    alwaysOnTop: false,
    skipTaskbar: false,
    hasShadow: false,
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  // launch the widget automatically at Windows login (installed build only)
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }
  win.loadFile('widget.html');
  win.webContents.on('did-finish-load', () => { pushTasks(); pushWorkspace(); });
  setInterval(pushTasks, 5 * 60 * 1000);
  setInterval(pushWorkspace, 5 * 60 * 1000);
}

function createScreensaver() {
  win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    kiosk: true,
    backgroundColor: '#16151c',
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('screensaver.html');
  win.setMenuBarVisibility(false);
  // Esc always exits
  globalShortcut.register('Escape', () => app.quit());
}

// renderer asks to quit (screensaver: mouse move / key press)
ipcMain.on('quit-saver', () => app.quit());
// widget controls
ipcMain.on('win-close', () => win && win.close());
ipcMain.on('win-pin', (_e, pinned) => win && win.setAlwaysOnTop(pinned));
let widgetMaxed = false, savedBounds = null;
ipcMain.on('win-max', () => {
  if (!win) return;
  if (!widgetMaxed) {
    savedBounds = win.getBounds();
    win.setBounds(screen.getDisplayMatching(win.getBounds()).workArea);
    widgetMaxed = true;
  } else {
    if (savedBounds) win.setBounds(savedBounds);
    widgetMaxed = false;
  }
});
ipcMain.on('open-link', (_e, url) => shell.openExternal(url));
// renderer asks which version is running, to show in the title bar
ipcMain.handle('get-app-version', () => app.getVersion());
// open a local file/folder (project .md, daily note, project directory) in its default app
ipcMain.on('open-file', (_e, p) => { if (p) shell.openPath(p); });
// renderer asks to re-read the workspace vault (manual refresh button)
ipcMain.on('workspace-refresh', () => pushWorkspace());
// renderer asks for an issue's journal history + current "Test Results" field,
// to preview before closing (see docs/superpowers/specs/2026-07-22-close-issue-test-results-design.md)
ipcMain.handle('get-issue-preview', async (_e, issueId) => {
  if (!ENV.REDMINE_URL || !ENV.REDMINE_API_KEY) return { ok: false, error: 'ยังไม่ได้ตั้งค่า .env' };
  try {
    const res = await fetch(`${ENV.REDMINE_URL}/issues/${issueId}.json?include=journals,custom_fields`,
      { headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY } });
    if (!res.ok) return { ok: false, error: `Redmine HTTP ${res.status}` };
    const { issue } = await res.json();
    const historyText = (issue.journals || [])
      .filter(j => j.notes && j.notes.trim())
      .map(j => `[${fmtDateTime(j.created_on)}] ${j.user?.name || 'ไม่ระบุ'}: ${j.notes.trim()}`)
      .join('\n\n');
    const trField = (issue.custom_fields || []).find(f => f.name === 'Test Results');
    return {
      ok: true,
      historyText,
      testResults: trField ? { fieldId: trField.id, value: trField.value || '' } : null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// renderer asks to close a Resolved issue (Resolved -> Closed), optionally writing a custom field first
ipcMain.handle('close-issue', async (_e, issueId, customField) => {
  if (!ENV.REDMINE_URL || !ENV.REDMINE_API_KEY) return { ok: false, error: 'ยังไม่ได้ตั้งค่า .env' };
  try {
    const closedId = await getStatusId('Closed');
    if (!closedId) return { ok: false, error: 'ไม่พบสถานะ "Closed" ใน Redmine' };
    const issuePayload = { status_id: closedId };
    if (customField) issuePayload.custom_fields = [{ id: customField.id, value: customField.value }];
    const res = await fetch(`${ENV.REDMINE_URL}/issues/${issueId}.json`, {
      method: 'PUT',
      headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: issuePayload }),
    });
    if (!res.ok) {
      let msg = `Redmine HTTP ${res.status}`;
      try { const body = await res.json(); if (body.errors) msg = body.errors.join(', '); } catch {}
      return { ok: false, error: msg };
    }
    pushTasks();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  MODE === 'screensaver' ? createScreensaver() : createWidget();
  if (MODE === 'widget') setupAutoUpdate();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
