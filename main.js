const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readWorkspace } = require('./workspace');
const { readMeetings, readTranscript } = require('./meetings');
const { readQaResults } = require('./qatest');

const MODE = process.argv.includes('--screensaver') ? 'screensaver' : 'widget';
let win;

// วิดเจ็ตเปิดได้ทีละตัว -- ตัวที่สองอ่าน localStorage ไม่ได้ เพราะตัวแรกถือล็อกโปรไฟล์ของ
// Chromium อยู่ ธีมที่เซฟไว้เลยตกไปเป็นค่าเริ่มต้น (widget.html บรรทัด 9 มี catch คลุมไว้
// เงียบ ๆ) แล้วหน้าต่างสองบานยังทับกันสนิทเพราะจำตำแหน่งเดียวกัน มองไม่ออกว่ามีสองตัว
//
// สกรีนเซฟเวอร์ไม่ขอล็อก เพราะต้องขึ้นทับได้ทั้งที่วิดเจ็ตเปิดอยู่ -- อิเล็กตรอนมีล็อกชุดเดียว
// ต่อแอป ถ้าให้ใช้ร่วมกันสกรีนเซฟเวอร์จะโดนเด้งทิ้งทันทีที่วิดเจ็ตเปิดค้างไว้
//
// เฉพาะตัวที่ติดตั้งแล้ว -- ตัวที่รันจากซอร์สใช้ userData โฟลเดอร์เดียวกับตัวติดตั้ง
// (cowork-desktop ทั้งคู่ เพราะ userData มาจาก name ใน package.json ไม่ใช่ productName)
// ล็อกจึงเป็นตัวเดียวกัน ถ้าไม่กันไว้ npm run widget จะเงียบหายทุกครั้งที่วิดเจ็ตตัวติดตั้ง
// เปิดค้างอยู่ -- ซึ่งมันเปิดเองตอนล็อกอินวินโดวส์อยู่แล้ว
const gotLock = MODE === 'screensaver' || !app.isPackaged || app.requestSingleInstanceLock();
if (!gotLock) app.quit();

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

// ---- app settings (Redmine URL/key, workspace vault path, meetings path), per-user, not baked into the installer ----
// See docs/superpowers/specs/2026-07-23-redmine-settings-ui-design.md
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function writeConfigMerge(patch) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch {}
  Object.assign(saved, patch);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(saved, null, 2));
}
let redmineConfig = { url: '', apiKey: '' };
let workspaceDir = '';
let meetingsDir = '';
// QA test results — { label, path }[], array from day one: more sources
// (other jobs' QA results) are a confirmed near-term need, not a maybe.
// See docs/superpowers/specs/2026-07-27-qa-test-tab-design.md
let qaSources = [];
// Port of meeting-notes' session_service — configurable because that side can
// change UI_PORT in its .env, and a hardcoded 8765 would silently drift apart.
let runnerPort = 8765;
// Last summary model picked, remembered so opening a room is a single click.
let runnerModel = 'GLM-5.2';
// Has this machine ever reached the service? Only then may the Meeting tab show
// a "waiting for the runner" state. On the 8 installed machines that never had a
// recorder, a permanent red light would be noise about a feature they never asked
// for — the tab has to stay exactly as it was.
let runnerSeen = false;

// ---- private per-issue notes, local-only — never written back to Redmine ----
// See docs/superpowers/specs/2026-07-27-private-issue-notes-design.md
// Kept in its own file (not merged into config.json): notes grow over time and
// shouldn't sit next to the Redmine API key, and can be wiped/backed up separately.
function notesPath() { return path.join(app.getPath('userData'), 'notes.json'); }
function readNotes() {
  try { return JSON.parse(fs.readFileSync(notesPath(), 'utf8')); } catch { return {}; }
}
function writeNotes(notes) {
  fs.mkdirSync(path.dirname(notesPath()), { recursive: true });
  fs.writeFileSync(notesPath(), JSON.stringify(notes, null, 2));
}
// A note's lifetime is the issue's open lifetime — once an issue is closed its
// note is deleted, silently, no confirmation (the user's use case is "ask back
// when work has a problem"; once closed the question is moot).
function pruneAndAttachNotes(payload) {
  const notes = readNotes();
  let changed = false;
  for (const g of payload.groups || []) {
    for (const issue of g.issues) {
      if (issue.closed && notes[String(issue.id)]) { delete notes[String(issue.id)]; changed = true; }
    }
  }
  if (changed) writeNotes(notes);
  return { ...payload, notes };
}
function loadAppConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch {}
  redmineConfig = { url: saved.redmineUrl || '', apiKey: saved.redmineApiKey || '' };
  workspaceDir = saved.workspaceDir || '';
  meetingsDir = saved.meetingsDir || '';
  qaSources = Array.isArray(saved.qaSources) ? saved.qaSources : [];
  runnerPort = Number(saved.meetingRunnerPort) || 8765;
  runnerModel = saved.meetingRunnerModel || 'GLM-5.2';
  runnerSeen = saved.meetingRunnerSeen === true;
  // dev convenience only: unpackaged runs may still use a local .env; never packaged
  if (!app.isPackaged) {
    if (!redmineConfig.url) redmineConfig.url = ENV.REDMINE_URL || '';
    if (!redmineConfig.apiKey) redmineConfig.apiKey = ENV.REDMINE_API_KEY || '';
    if (!workspaceDir) workspaceDir = ENV.WORKSPACE_DIR || path.join(__dirname, '..', 'A_Workspace');
    if (!meetingsDir) meetingsDir = ENV.MEETINGS_DIR || path.join(__dirname, '..', 'meeting-notes', 'meetings');
    if (!qaSources.length) {
      qaSources = [{
        label: 'Zinga mobile (Appium)',
        path: ENV.QA_RESULTS_DIR || 'D:\\COWORK\\Test-case-mobile\\appium-bluestacks\\results',
      }];
    }
  }
}

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
  // ต้องปิดแอปให้สนิท "ก่อน" ตัวติดตั้งเริ่มทำงาน ไม่ใช่ปิดทีหลัง
  //
  // ของเดิมสั่งติดตั้งแล้วค่อย app.quit() ใน 400ms ซึ่งเป็นการแข่งเวลา และเวลาแพ้คือพังเงียบ:
  // ตัวติดตั้งลบไฟล์ชุดเก่าไม่ได้เพราะยังถูกเปิดค้างอยู่ แล้วจบด้วย exit 2 -- ไม่คัดลอกไฟล์
  // ไม่เขียนรีจิสทรี ไม่ทำอะไรเลยสักอย่าง และเพราะสั่ง /S มา ผู้ใช้ไม่เห็นอะไรทั้งสิ้น
  // เข้าใจว่านี่คือเหตุที่เวอร์ชันใน "แอปที่ติดตั้ง" ค้างอยู่ที่ 1.3.15 ตั้งแต่ 24 ก.ค.
  //
  // วัดมาแล้วทั้งสามทาง (เปิดแอปค้างไว้ / เปิดค้างไว้ + --updated / ปิดแอประหว่างติดตั้ง):
  // สองแบบแรกได้ exit 2 รีจิสทรีไม่ขยับ แบบสุดท้ายได้ exit 0 และรีจิสทรีอัปเดตถูกต้อง
  // ส่วน --updated ยิ่งแย่ -- มันเด้ง MessageBox ค้างรอคนกดทั้งที่อยู่ในโหมด /S
  //
  // spawn ใน 'quit' จึงยิงตอนหน้าต่างปิดหมดและอิเล็กตรอนกำลังลงแล้ว ตัวติดตั้งยังต้องแตกไฟล์
  // อีกหลายวินาทีกว่าจะแตะไฟล์จริง โพรเซสเราหมดไปก่อนแน่นอน
  //
  // --force-run ให้ตัวติดตั้งเปิดแอปคืนให้เมื่อลงเสร็จ ปุ่มในกล่องเขียนว่า "รีสตาร์ทตอนนี้"
  // แต่เราไม่เคยส่งธงนี้เลย มันจึงปิดแล้วเงียบไปทุกครั้ง ผู้ใช้ต้องไปกดไอคอนเอง
  // (installSection.nsh:106 -- ตัวติดตั้งแบบมีหน้าต่างจะเปิดแอปคืนก็ต่อเมื่อได้ทั้ง
  //  --force-run และ /S มาคู่กัน)
  //
  // /D= ต้องอยู่ท้ายสุดเสมอ
  app.once('quit', () => {
    spawn(installerPath, ['/S', '--force-run', '/D="' + installDir + '"'],
      { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  });
  app.quit();
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

const STATUS_ORDER = ['Backlog', 'New', 'In Progress', 'Test', 'Resolved', 'Closed'];
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

let currentUserCache = null;
async function getCurrentUserName() {
  if (currentUserCache) return currentUserCache;
  if (!redmineConfig.url || !redmineConfig.apiKey) return null;
  try {
    const res = await fetch(`${redmineConfig.url}/users/current.json`, { headers: { 'X-Redmine-API-Key': redmineConfig.apiKey } });
    if (!res.ok) return null;
    const { user } = await res.json();
    currentUserCache = `${user.firstname} ${user.lastname}`.trim();
    return currentUserCache;
  } catch {
    return null;
  }
}

// name -> id and name -> is_closed for every status, from the one shared /issue_statuses.json fetch
let statusIdCache = null, statusClosedCache = null;
async function loadStatusMeta() {
  if (statusIdCache) return;
  const res = await fetch(`${redmineConfig.url}/issue_statuses.json`, { headers: { 'X-Redmine-API-Key': redmineConfig.apiKey } });
  if (!res.ok) throw new Error(`โหลดสถานะไม่สำเร็จ (HTTP ${res.status})`);
  const data = await res.json();
  statusIdCache = {}; statusClosedCache = {};
  for (const s of data.issue_statuses || []) { statusIdCache[s.name] = s.id; statusClosedCache[s.name] = !!s.is_closed; }
}
async function getStatusId(name) { await loadStatusMeta(); return statusIdCache[name]; }
function isClosedStatusName(name) { return !!(statusClosedCache && statusClosedCache[name]); }

// fetches every issue regardless of status, paginating through Redmine's offset/limit
// until total_count is satisfied (first page determines total, rest fetch in parallel)
async function fetchAllIssues() {
  const headers = { 'X-Redmine-API-Key': redmineConfig.apiKey };
  const pageSize = 100;
  const base = `${redmineConfig.url}/issues.json?status_id=*&limit=${pageSize}&include=custom_fields&sort=project:asc,priority:desc`;
  const first = await fetch(`${base}&offset=0`, { headers });
  if (!first.ok) throw new Error(`Redmine HTTP ${first.status}`);
  const firstData = await first.json();
  const all = [...(firstData.issues || [])];
  const total = firstData.total_count || all.length;
  const offsets = [];
  for (let o = pageSize; o < total; o += pageSize) offsets.push(o);
  if (offsets.length) {
    const pages = await Promise.all(offsets.map(o =>
      fetch(`${base}&offset=${o}`, { headers }).then(r => r.ok ? r.json() : { issues: [] })));
    for (const p of pages) all.push(...(p.issues || []));
  }
  return all;
}

async function fetchRedmineTasks() {
  if (!redmineConfig.url || !redmineConfig.apiKey) return { groups: [], stats: null, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    await loadStatusMeta();
    const allIssuesRaw = await fetchAllIssues();
    const today = new Date().toISOString().slice(0, 10);
    const stats = { open: 0, highRisk: 0, overdue: 0, closed: 0 };
    const closedByYear = new Map();

    const byStatus = new Map();
    for (const issue of allIssuesRaw) {
      const status = issue.status?.name || 'อื่นๆ';
      const closed = isClosedStatusName(status);
      const risk = topRisk(issue);
      const overdue = !closed && !!(issue.due_date && issue.due_date < today);
      if (closed) {
        stats.closed++;
        const year = (issue.closed_on || issue.updated_on || '').slice(0, 4);
        if (year) closedByYear.set(year, (closedByYear.get(year) || 0) + 1);
      } else {
        stats.open++;
        if (risk === 'High') stats.highRisk++;
        if (overdue) stats.overdue++;
      }
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status).push({
        id: issue.id,
        subject: issue.subject,
        project: issue.project?.name || '',
        projectId: issue.project?.identifier || issue.project?.id || '',
        assignee: issue.assigned_to?.name || 'ไม่ระบุ',
        status,
        risk,
        overdue,
        closed,
        createdOn: issue.created_on,
        updatedOn: issue.updated_on,
        url: `${redmineConfig.url}/issues/${issue.id}`,
      });
    }

    const sortedYears = [...closedByYear.keys()].sort((a, b) => b.localeCompare(a));
    const recentYears = sortedYears.slice(0, 3).map(y => ({ label: y, count: closedByYear.get(y) }));
    const olderCount = sortedYears.slice(3).reduce((sum, y) => sum + closedByYear.get(y), 0);
    stats.closedByYear = olderCount > 0
      ? [...recentYears, { label: 'ก่อนหน้า', count: olderCount }]
      : recentYears;

    const orderedNames = [...STATUS_ORDER, ...[...byStatus.keys()].filter(s => !STATUS_ORDER.includes(s))];
    const groups = orderedNames
      .filter(s => byStatus.has(s))
      .map(s => ({ status: s, issues: byStatus.get(s) }));
    return { groups, stats, error: null };
  } catch (e) {
    return { groups: [], stats: null, error: e.message };
  }
}

function pushTasks() {
  if (!win) return;
  Promise.all([fetchRedmineTasks(), getCurrentUserName()]).then(([payload, currentUser]) =>
    win && win.webContents.send('tasks-update', pruneAndAttachNotes({ ...payload, currentUser })));
}

// A_Workspace markdown vault — path comes from settings (workspaceDir, loaded in loadAppConfig)
function pushWorkspace() {
  if (!win) return;
  let payload;
  try { payload = readWorkspace(workspaceDir); }
  catch (e) { payload = { error: e.message }; }
  win.webContents.send('workspace-update', payload);
}

// ---- meeting-notes runner service (127.0.0.1 only) --------------------------
// Reads and commands over HTTP, never spawns the recorder itself: the
// manifest -> encode -> inbox/ ordering lives in session_service.py and nowhere
// else. Copying it to a second place is how a meeting's audio goes missing.
let runnerTimer = null;

async function fetchRunnerState() {
  try {
    const res = await fetch(`http://127.0.0.1:${runnerPort}/api/state?lang=th`,
      { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }   // no answer = no recorder on this machine, not an error to show
}

// Poll cadence follows the situation. The installer goes to 8 machines, most
// without the service at all — hammering 127.0.0.1 once a second all day there
// buys nothing.
function runnerInterval(state) {
  if (!state) return Date.now() < runnerWarmUntil ? 2000 : 30000;
  if (state.recorder !== 'idle') return 1000;
  // Room closed but the watcher's pipeline is still running: keep up the pace
  // while fresh events keep arriving, then ease off once it goes quiet.
  const activity = state.activity || [];
  const last = activity[activity.length - 1];
  // ts is Python's datetime.now().isoformat() — no timezone suffix. JS reads a
  // date-time without one as local time, which is right here: Python and
  // Electron are on the same machine.
  const age = last && last.ts ? Date.now() - Date.parse(last.ts) : Infinity;
  return age < 90000 ? 1000 : 5000;
}

// The repo root is the parent of the configured meetings/ folder, and the venv
// inside it is the gate: no venv, no spawn, so machines without meeting-notes do
// nothing at all and need no extra setting to say so.
function runnerVenvPython() {
  if (!meetingsDir) return null;
  const exe = path.join(path.dirname(meetingsDir), '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(exe) ? exe : null;
}

let runnerSpawnTried = false;
let runnerWarmUntil = 0;   // poll fast for a moment after spawning, see runnerInterval

// Starts ONLY session_service, never the watcher. The watcher loads Whisper and
// pyannote into VRAM, and the widget opens at Windows login on installed builds —
// paying that on every login would be a bad trade for a service that is idle most
// of the time. A missing watcher already has a graceful path: worker_ready comes
// back false and the bar says the file will wait in the queue.
//
// Detached and unref'd on purpose. As a child it would die with the widget, and
// killing a live recording by closing a window is exactly what session_service
// exists to prevent.
function startRunnerService() {
  if (runnerSpawnTried) return;   // once per app run: a service that crashes on
  runnerSpawnTried = true;        // boot must not be respawned every 30s forever
  const python = runnerVenvPython();
  if (!python) return;
  try {
    spawn(python, ['-m', 'src.session_service'], {
      cwd: path.dirname(meetingsDir),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    // Flask needs a few seconds to bind. Without this the next look would be 30s
    // away and the bar would sit hidden long after the service was actually up.
    runnerWarmUntil = Date.now() + 25000;
  } catch { /* no recorder on this machine is a normal state, not an error */ }
}

async function pollRunner() {
  const state = await fetchRunnerState();
  if (state && !runnerSeen) {
    runnerSeen = true;
    writeConfigMerge({ meetingRunnerSeen: true });
  }
  if (!state) startRunnerService();
  if (win) win.webContents.send('runner-update', state);
  // setTimeout rather than setInterval: the gap changes with the state
  runnerTimer = setTimeout(pollRunner, runnerInterval(state));
}

// meeting-notes vault — path comes from settings (meetingsDir, loaded in loadAppConfig).
// รายการ + summary ส่งมาทั้งก้อน ส่วน transcript โหลดตอนกดเข้าไปอ่านทีละประชุม
function pushMeetings() {
  if (!win) return;
  let payload;
  try { payload = readMeetings(meetingsDir); }
  catch (e) { payload = { meetings: [], stats: null, error: e.message }; }
  win.webContents.send('meetings-update', payload);
}

// QA test results — path(s) come from settings (qaSources, loaded in loadAppConfig).
// Each run's full log ships in the list payload (small text files); failure.xml
// is read lazily on demand via get-qa-failure-xml, not bundled here.
function pushQaTests() {
  if (!win) return;
  let payload;
  try { payload = readQaResults(qaSources); }
  catch (e) { payload = { runs: [], sources: [], error: e.message }; }
  win.webContents.send('qatest-update', payload);
}

function createWidget() {
  const { width, height: availH } = screen.getPrimaryDisplay().workAreaSize;
  const W = 420, Y = 60;
  // สัดส่วนมือถือแนวตั้ง 9:19.5 (iPhone 14/15, Pixel) — จากเดิม 640 ที่เห็นลิสต์ได้ราว 7 แถว
  // ขึ้นเป็นราว 13 แถว โดยความกว้างคงเดิม การจัดวางในหน้าจึงไม่เปลี่ยนเลย
  // ต้องหนีบด้วย เพราะตัวติดตั้งไปลงหลายเครื่อง จอ 1080p เหลือพื้นที่ใช้งานสูงราว 1032
  // (60 + 910 ยังพอดี) แต่จอเตี้ยกว่านั้นหรือทาสก์บาร์แนวตั้งจะทำให้ขอบล่างหลุดจอ
  const H = Math.max(420, Math.min(Math.round(W * 19.5 / 9), availH - Y - 24));
  win = new BrowserWindow({
    width: W,
    height: H,
    x: width - W - 24,       // dock bottom-right
    y: Y,                    // ต้องใช้ตัวเดียวกับที่หนีบ H ไม่งั้นสองค่าหลุดจากกันเมื่อแก้ทีหลัง
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
  win.webContents.on('did-finish-load', () => { pushTasks(); pushWorkspace(); pushMeetings(); pushQaTests(); });
  setInterval(pushTasks, 5 * 60 * 1000);
  setInterval(pushWorkspace, 5 * 60 * 1000);
  setInterval(pushMeetings, 5 * 60 * 1000);
  setInterval(pushQaTests, 5 * 60 * 1000);
  pollRunner();
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
// renderer asks to re-read the meetings folder (manual refresh button)
ipcMain.on('meetings-refresh', () => pushMeetings());
// renderer asks to re-read the QA results folder(s) (manual refresh button)
ipcMain.on('qatest-refresh', () => pushQaTests());
// transcript of one meeting, loaded on demand when the user opens it
ipcMain.handle('get-meeting-transcript', (_e, id) => {
  try { return readTranscript(meetingsDir, id); }
  catch (e) { return { speakers: [], utterances: [], error: e.message }; }
});
// renderer asks for an issue's journal history + current "Test Results" field,
// to preview before closing (see docs/superpowers/specs/2026-07-22-close-issue-test-results-design.md)
ipcMain.handle('get-issue-preview', async (_e, issueId) => {
  if (!redmineConfig.url || !redmineConfig.apiKey) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    const res = await fetch(`${redmineConfig.url}/issues/${issueId}.json?include=journals,custom_fields`,
      { headers: { 'X-Redmine-API-Key': redmineConfig.apiKey } });
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
  if (!redmineConfig.url || !redmineConfig.apiKey) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    const closedId = await getStatusId('Closed');
    if (!closedId) return { ok: false, error: 'ไม่พบสถานะ "Closed" ใน Redmine' };
    const issuePayload = { status_id: closedId };
    if (customField) issuePayload.custom_fields = [{ id: customField.id, value: customField.value }];
    const res = await fetch(`${redmineConfig.url}/issues/${issueId}.json`, {
      method: 'PUT',
      headers: { 'X-Redmine-API-Key': redmineConfig.apiKey, 'Content-Type': 'application/json' },
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
// renderer's Settings panel: read current values, test before saving, then save
ipcMain.handle('get-redmine-config', () => ({ url: redmineConfig.url, apiKey: redmineConfig.apiKey }));
ipcMain.handle('test-redmine-connection', async (_e, { url, apiKey }) => {
  try {
    const res = await fetch(`${url}/users/current.json`, { headers: { 'X-Redmine-API-Key': apiKey } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const { user } = await res.json();
    return { ok: true, userName: `${user.firstname} ${user.lastname}`.trim() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('save-redmine-config', (_e, { url, apiKey }) => {
  redmineConfig = { url, apiKey };
  writeConfigMerge({ redmineUrl: url, redmineApiKey: apiKey });
  currentUserCache = null; statusIdCache = null; // tied to the old credentials
  pushTasks();
  return { ok: true };
});
// private note for one issue — local-only, never touches the Redmine API.
// Saving an empty/whitespace string deletes the note; that's also how the
// renderer's "ลบโน้ต" button works, so there's a single delete path.
ipcMain.handle('save-note', (_e, issueId, text) => {
  try {
    const notes = readNotes();
    const key = String(issueId);
    const trimmed = (text || '').trim();
    if (trimmed) notes[key] = { text: trimmed, updatedAt: new Date().toISOString() };
    else delete notes[key];
    writeNotes(notes);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// renderer's Workspace tab: read/save the vault path the same way
ipcMain.handle('get-workspace-dir', () => workspaceDir);
ipcMain.handle('save-workspace-dir', (_e, dir) => {
  workspaceDir = dir;
  writeConfigMerge({ workspaceDir: dir });
  pushWorkspace();
  return { ok: true };
});
// renderer's Meeting tab: read/save the meetings folder path
ipcMain.handle('get-meetings-dir', () => meetingsDir);
ipcMain.handle('save-meetings-dir', (_e, dir) => {
  meetingsDir = dir;
  writeConfigMerge({ meetingsDir: dir });
  pushMeetings();
  return { ok: true };
});
// renderer's QA test tab: read/save the list of { label, path } sources
ipcMain.handle('get-qa-sources', () => qaSources);
ipcMain.handle('save-qa-sources', (_e, sources) => {
  qaSources = (sources || []).filter(s => s && s.path);
  writeConfigMerge({ qaSources });
  pushQaTests();
  return { ok: true };
});
// renderer's Meeting tab: the recorder controls. The renderer never talks to
// 127.0.0.1 itself — everything it can do goes through these five handles.
ipcMain.handle('runner-get-state', () => fetchRunnerState());
ipcMain.handle('runner-start', async (_e, model, name) => {
  try {
    const res = await fetch(`http://127.0.0.1:${runnerPort}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, name: name || '' }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => ({}));
    // 409 = a room is already open. Let the next poll report the truth rather
    // than guessing on the renderer's behalf.
    if (res.status === 201) return { ok: true };
    return { error: body.error || `http_${res.status}` };
  } catch { return { error: 'unreachable' }; }
});
ipcMain.handle('runner-stop', async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${runnerPort}/api/session/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) return { ok: true };
    return { error: body.error || `http_${res.status}` };
  } catch { return { error: 'unreachable' }; }
});
ipcMain.handle('get-runner-config', () => ({
  port: runnerPort, model: runnerModel, seen: runnerSeen,
}));
ipcMain.handle('save-runner-config', (_e, cfg) => {
  const patch = {};
  if (cfg && cfg.port) { runnerPort = Number(cfg.port) || 8765; patch.meetingRunnerPort = runnerPort; }
  if (cfg && cfg.model) { runnerModel = cfg.model; patch.meetingRunnerModel = runnerModel; }
  if (Object.keys(patch).length) writeConfigMerge(patch);
  return { ok: true };
});
// UI hierarchy dump for a failed run — lazy, can be tens of KB, only read on demand
ipcMain.handle('get-qa-failure-xml', (_e, runDir) => {
  try { return { xml: fs.readFileSync(path.join(runDir, 'failure.xml'), 'utf8') }; }
  catch (e) { return { error: e.message }; }
});

if (gotLock) app.whenReady().then(() => {
  loadAppConfig();
  MODE === 'screensaver' ? createScreensaver() : createWidget();
  if (MODE === 'widget') setupAutoUpdate();
});

// กดไอคอนซ้ำตอนเปิดอยู่แล้ว ให้ดึงบานเดิมขึ้นมาแทนที่จะเปิดบานใหม่
// ใช้ moveTop ไม่ใช่ setAlwaysOnTop เพราะปุ่มปักหมุดถือค่านั้นอยู่ เผลอไปทับค่าที่ผู้ใช้ตั้งไว้
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.moveTop();
  win.focus();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
