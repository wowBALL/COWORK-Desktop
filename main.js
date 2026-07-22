const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { readWorkspace } = require('./workspace');

const MODE = process.argv.includes('--screensaver') ? 'screensaver' : 'widget';
let win;

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
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

const STATUS_ORDER = ['Backlog', 'New', 'In Progress', 'Test', 'Resolved'];
// low → high severity; index used to pick the worst when an issue has several
const RISK_ORDER = ['Low', 'Fairly Low', 'Moderate', 'Medium', 'High'];

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
        risk: topRisk(issue),
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
// open a local file/folder (project .md, daily note, project directory) in its default app
ipcMain.on('open-file', (_e, p) => { if (p) shell.openPath(p); });
// renderer asks to re-read the workspace vault (manual refresh button)
ipcMain.on('workspace-refresh', () => pushWorkspace());

app.whenReady().then(() => {
  MODE === 'screensaver' ? createScreensaver() : createWidget();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
