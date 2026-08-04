const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readWorkspace } = require('./workspace');
const { readMeetings, readTranscript } = require('./meetings');
const { readQaResults } = require('./qatest');
const { Grafana, APP_GROUPS } = require('./grafana');
const { parseGlossary, planWrite } = require('./glossary');
const { buildFieldSchema, fieldSchemaKey, composeDescription, buildIssuePayload, parseValidationErrors } = require('./redmine-issue-form');
const { draftIssue } = require('./llm');

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
let llmConfig = { baseUrl: '', apiKey: '' };
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
let runnerModel = 'Qwen/Qwen3.6-35B-A3B';
// Last meeting type (profile) picked — travels the same road as runnerModel.
// 'dev' matches meeting-notes' own default, so a machine that never touched this
// setting keeps behaving exactly as it did before the picker existed.
// See docs/superpowers/specs/2026-07-30-meeting-profile-design.md
let runnerProfile = 'dev';
// Last transcription engine picked — same road as runnerModel/runnerProfile.
// 'whisper' matches meeting-notes' own default (config.DEFAULT_ASR_ENGINE), so a
// machine that never touched this setting keeps behaving exactly as before.
let runnerEngine = 'whisper';
// Has this machine ever reached the service? Only then may the Meeting tab show
// a "waiting for the runner" state. On the 8 installed machines that never had a
// recorder, a permanent red light would be noise about a feature they never asked
// for — the tab has to stay exactly as it was.
let runnerSeen = false;
// Grafana/Loki log viewer — two environments from day one because Dev and Prod are
// separate self-hosted instances with separate tokens. Prod is deliberately left
// unconfigured for now; the tab shows it as unavailable rather than pretending.
// See docs/superpowers/specs/2026-07-30-grafana-tab-design.md
let grafanaConfig = { dev: { url: '', token: '' }, prod: { url: '', token: '' } };
// One client per environment, rebuilt on save. Holding the instance (rather than
// constructing per request) is what keeps the request queue and the resolved Loki
// datasource uid alive — Loki 2.6.1 here answers HTTP 429 to concurrent queries, so
// that queue is load-bearing, not an optimisation.
// Two clients per environment, deliberately: `fg` serves the log list the user is
// waiting on, `bg` serves the counts, slow-endpoint and history queries. They have
// separate concurrency budgets, so a background sweep can no longer make the next
// range click queue behind it — that was worth ~20 seconds on a 3-day range.
// Measured safe: 20 queries across 2 lanes and 24 across 3 all succeeded.
const grafanaClients = {};
function grafanaFor(envName, lane) {
  const key = (envName === 'prod' ? 'prod' : 'dev') + ':' + (lane === 'bg' ? 'bg' : 'fg');
  const cfg = grafanaConfig[envName === 'prod' ? 'prod' : 'dev'] || { url: '', token: '' };
  const cached = grafanaClients[key];
  if (cached && cached.url === cfg.url.replace(/\/+$/, '') && cached.token === cfg.token) return cached;
  grafanaClients[key] = new Grafana(cfg);
  return grafanaClients[key];
}
function dropGrafanaClients(envKey) {
  delete grafanaClients[envKey + ':fg'];
  delete grafanaClients[envKey + ':bg'];
}

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
  llmConfig = { baseUrl: saved.llmBaseUrl || '', apiKey: saved.llmApiKey || '' };
  workspaceDir = saved.workspaceDir || '';
  meetingsDir = saved.meetingsDir || '';
  qaSources = Array.isArray(saved.qaSources) ? saved.qaSources : [];
  runnerPort = Number(saved.meetingRunnerPort) || 8765;
  runnerModel = saved.meetingRunnerModel || 'Qwen/Qwen3.6-35B-A3B';
  runnerProfile = saved.meetingRunnerProfile || 'dev';
  runnerEngine = saved.meetingRunnerEngine || 'whisper';
  runnerSeen = saved.meetingRunnerSeen === true;
  grafanaConfig = {
    dev:  { url: saved.grafanaDevUrl  || '', token: saved.grafanaDevToken  || '' },
    prod: { url: saved.grafanaProdUrl || '', token: saved.grafanaProdToken || '' },
  };
  // dev convenience only: unpackaged runs may still use a local .env; never packaged
  if (!app.isPackaged) {
    if (!redmineConfig.url) redmineConfig.url = ENV.REDMINE_URL || '';
    if (!redmineConfig.apiKey) redmineConfig.apiKey = ENV.REDMINE_API_KEY || '';
    if (!llmConfig.baseUrl) llmConfig.baseUrl = ENV.LLM_BASE_URL || '';
    if (!llmConfig.apiKey) llmConfig.apiKey = ENV.LLM_API_KEY || '';
    if (!workspaceDir) workspaceDir = ENV.WORKSPACE_DIR || path.join(__dirname, '..', 'A_Workspace');
    if (!meetingsDir) meetingsDir = ENV.MEETINGS_DIR || path.join(__dirname, '..', 'meeting-notes', 'meetings');
    if (!qaSources.length) {
      qaSources = [{
        label: 'Zinga mobile (Appium)',
        path: ENV.QA_RESULTS_DIR || 'D:\\COWORK\\Test-case-mobile\\appium-bluestacks\\results',
      }];
    }
    if (!grafanaConfig.dev.url)   grafanaConfig.dev.url   = ENV.GRAFANA_DEV_URL   || '';
    if (!grafanaConfig.dev.token) grafanaConfig.dev.token = ENV.GRAFANA_DEV_TOKEN || '';
    if (!grafanaConfig.prod.url)   grafanaConfig.prod.url   = ENV.GRAFANA_PROD_URL   || '';
    if (!grafanaConfig.prod.token) grafanaConfig.prod.token = ENV.GRAFANA_PROD_TOKEN || '';
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
  // detached + unref ตั้งใจให้ตัวติดตั้งรอดหลังแอปปิด ไม่ผูกชะตากับโพรเซสหลักที่กำลังจะตายไป
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
const RISK_ORDER = ['Low', 'Fairly Low', 'Moderate', 'High', 'Very High'];

let issueFormFieldsCache = {};
let trackerIdCache = null;
let priorityIdCache = null;

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

async function loadTrackerMeta() {
  if (trackerIdCache) return;
  const res = await fetch(`${redmineConfig.url}/trackers.json`, { headers: { 'X-Redmine-API-Key': redmineConfig.apiKey } });
  if (!res.ok) throw new Error(`โหลด tracker ไม่สำเร็จ (HTTP ${res.status})`);
  const data = await res.json();
  trackerIdCache = {};
  for (const t of data.trackers || []) trackerIdCache[t.name] = t.id;
}
async function loadPriorityMeta() {
  if (priorityIdCache) return;
  const res = await fetch(`${redmineConfig.url}/enumerations/issue_priorities.json`, { headers: { 'X-Redmine-API-Key': redmineConfig.apiKey } });
  if (!res.ok) throw new Error(`โหลด priority ไม่สำเร็จ (HTTP ${res.status})`);
  const data = await res.json();
  priorityIdCache = {};
  for (const p of data.issue_priorities || []) priorityIdCache[p.name] = p.id;
}

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
    issueFormFieldsCache = buildFieldSchema(allIssuesRaw);
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
        if (risk === 'High' || risk === 'Very High') stats.highRisk++;
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
        priority: issue.priority?.name || '',
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

// ตัวหยั่งความพร้อมแบบถูก ๆ -- คำถามคือ "มีอะไรตอบ HTTP บนพอร์ตนี้ไหม" เท่านั้น
//
// index() ของ session_service แค่ส่งไฟล์สแตติก ไม่เรียก worker probe จึงตอบใน ~11 ms
// เสมอ ต่างจาก /api/state ที่รัน powershell + Get-CimInstance ทั้งเครื่องแบบ sync คาอยู่ใน
// รีเควสต์ (วัดจริง 2026-07-30: 376 / 1151 / 1171 / 1463 / 2140 ms) แล้วแพ้ timeout เดิม
// 1500 ms เป็นส่วนใหญ่ ทำให้วิดเจ็ตรายงานว่าไม่มี service ทั้งที่มันรันอยู่และตอบได้ปกติ
//
// นับ "ตอบกลับมา" ไม่ใช่ res.ok: 404 ก็คือมีเซิร์ฟเวอร์อยู่ตรงนั้นแล้ว ถ้าผูกไว้กับ 200
// วันที่ index.html ฝั่ง meeting-notes ถูกเปลี่ยนชื่อ วิดเจ็ตจะค้างที่ OFF AIR และซ่อน
// ปุ่มอัดหายไป -- คือบั๊กเดิมที่กลับมาทางประตูอื่น
//
// สิ่งที่มันไม่ได้พิสูจน์: ว่าคนที่ตอบคือ session_service จริง แอปอะไรก็ตามที่ถือพอร์ตนี้
// อยู่ก็ตอบได้ คำถาม "เครื่องนี้เคยมี meeting-notes ไหม" จึงตัดสินจาก /api/state ที่
// parse ผ่านเท่านั้น (ดู readRunner) ไม่ใช่จากค่าที่ฟังก์ชันนี้คืน
async function fetchRunnerReady() {
  try {
    await fetch(`http://127.0.0.1:${runnerPort}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch { return false; }   // พอร์ตปิด = ยังไม่ได้เปิด meeting-notes ไม่ใช่ error ที่ต้องโชว์
}

async function fetchRunnerState() {
  try {
    // 5000 ไม่ใช่ 1500: /api/state รัน worker probe แบบ sync ได้ถึง ~2.1 วินาที
    // ค่านี้ตรงกับที่ runner-start/runner-stop ใช้อยู่แล้ว ไม่ใช่ค่าที่คิดขึ้นใหม่
    // ความพร้อมไม่ถูก endpoint นี้ *กั้น* อีกแล้ว (ดู fetchRunnerReady ซึ่งเป็นเส้นทางเร็ว)
    // การรอนานขึ้นจึงไม่ทำให้ผู้ใช้เห็นแถบค้าง -- ทางกลับกันคำตอบที่ parse ผ่านของ
    // endpoint นี้ *ยืนยัน* ความพร้อมได้เองด้วย (ดู readRunner)
    const res = await fetch(`http://127.0.0.1:${runnerPort}/api/state?lang=th`,
      { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }   // อ่านสถานะไม่ทัน -- ไม่ได้แปลว่า service ไม่มี
}

// อ่านความพร้อม + สถานะเป็นก้อนเดียว -- ทั้งฝั่ง push (รอบ poll) และฝั่ง pull
// (runner-get-state ที่ onShow/openRoom/stopRoom เรียก) ต้องได้รูป { ready, state }
// เดียวกันเป๊ะ ไม่งั้น onShow() กับรอบ poll เห็นโลกไม่เหมือนกัน จึงมีที่เดียว
//
// สถานะเป็นใหญ่กว่าตัวหยั่ง: /api/state ตอบและ parse ผ่าน = service ติดต่อได้ *โดยนิยาม*
// ไม่ว่า GET / จะทันหรือไม่ทัน ตัวหยั่งพลาดครั้งเดียวเคยทำให้แถบตกไป OFF AIR (ไม่มีปุ่ม
// หยุด ไม่มีไฟแดง) แล้วรอ 30 วินาทีก่อนถามใหม่ ทั้งที่กำลังอัดอยู่ -- pushMeetings /
// pushWorkspace / pushQaTests เป็น fs walk แบบ sync บนเธรดเดียวกันและยิงทุก 5 นาที
// วอลต์ที่อยู่บน network share ตัวเดียวก็หยุด event loop ได้นานพอให้ตัวนับ 1500 ms ชนะ
//
// แต่เครื่องที่ไม่เคยเห็น service เลย (runnerSeen เป็น false ตลอดชีพเครื่อง) ยังไม่ถาม
// /api/state แม้แต่ครั้งเดียว -- 8 เครื่องที่ติดตั้งไปซึ่งไม่มีตัวอัดจึงไม่ไปจุด worker
// probe (powershell หนึ่งตัวต่อหนึ่งครั้ง) ให้ service ฟรี ๆ และแท็บ Meeting ยังเงียบ
async function readRunner() {
  const probe = await fetchRunnerReady();
  const state = probe || runnerSeen ? await fetchRunnerState() : null;
  // ผูก "เครื่องนี้เคยมี meeting-notes ไหม" กับหลักฐานที่แข็งที่สุดที่มี: JSON จาก
  // /api/state ที่ parse ผ่าน ค่านี้ถูกเขียนลง config แบบถาวร -- GET / ที่ตอบ 200
  // เฉย ๆ พิสูจน์ไม่ได้ว่าเป็น service ของเรา เครื่องที่มีแอปอื่นถือพอร์ตนี้อยู่จะได้
  // บันไดสถานะติดค้างไปตลอดกาลทั้งที่แท็บ Meeting ควรเงียบสนิท
  if (state && !runnerSeen) {
    runnerSeen = true;
    writeConfigMerge({ meetingRunnerSeen: true });
  }
  return { ready: probe || !!state, state };
}

// อายุของเหตุการณ์ล่าสุด ใช้เป็นตัวชี้ว่า pipeline หลังปิดห้องยังเดินอยู่หรือเงียบไปแล้ว
// ts เป็น datetime.now().isoformat() ของ Python ไม่มี timezone ต่อท้าย JS อ่านค่าแบบนั้น
// เป็นเวลาท้องถิ่น ซึ่งถูกต้องตรงนี้เพราะ Python กับ Electron อยู่เครื่องเดียวกัน
function runnerActivityAge(state) {
  const activity = (state && state.activity) || [];
  const last = activity[activity.length - 1];
  return last && last.ts ? Date.now() - Date.parse(last.ts) : Infinity;
}

// Poll cadence follows the situation. The installer goes to 8 machines, most
// without the service at all — hammering 127.0.0.1 once a second all day there
// buys nothing.
function runnerInterval(ready, state) {
  // ไม่มี service ตอบบนเครื่องนี้
  if (!ready) return 30000;
  // พร้อมแล้วแต่ยังอ่านสถานะไม่ได้: รีบถามซ้ำเพื่อปิดช่อง connecting ให้เร็ว
  if (!state) return 2000;
  if (state.recorder !== 'idle') return 1000;
  // Room closed but the watcher's pipeline is still running: keep up the pace
  // while fresh events keep arriving, then ease off once it goes quiet.
  return runnerActivityAge(state) < 90000 ? 1000 : 5000;
}

async function pollRunner() {
  const { ready, state } = await readRunner();
  // isDestroyed() ไม่ใช่แค่ !win: win ไม่เคยถูกเซ็ตเป็น null ที่ไหนเลย และรอบนี้ await
  // ได้ถึง 1500 + 5000 ms ก่อนแตะ webContents ถ้าหน้าต่างถูกทำลายกลางทาง send() จะโยน
  // อยู่ใน async function ที่ไม่มี .catch -- โซ่ poll ตายพร้อม unhandled rejection
  if (win && !win.isDestroyed()) win.webContents.send('runner-update', { ready, state });
  // setTimeout rather than setInterval: the gap changes with the state
  setTimeout(pollRunner, runnerInterval(ready, state));
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
  // ไม่มีด่านตอนปิดอีกแล้ว: วิดเจ็ตไม่ได้เป็นเจ้าของโพรเซสไหนเลย การอัดเป็นของ
  // meeting-notes ซึ่งไม่หยุดตามวิดเจ็ต -- ปิดหน้าต่างขณะกำลังอัดจึงปลอดภัยและ
  // ไม่ต้องถาม ผลพลอยได้คือวิดเจ็ตไม่มีทางฆ่างานที่กำลังทำอยู่ได้อีก
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
// renderer ขอ field ที่ต้องกรอกสำหรับ (project, tracker) คู่นี้ — มาจาก issueFormFieldsCache
// ที่สร้างจาก issue ที่ดึงมาแล้ว (แนวทาง A ของ spec) ไม่เรียก /custom_fields.json (admin-only)
ipcMain.handle('get-issue-form-meta', async (_e, projectId, trackerName) => {
  if (!redmineConfig.url || !redmineConfig.apiKey) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    await Promise.all([loadTrackerMeta(), loadPriorityMeta()]);
    const customFields = issueFormFieldsCache[fieldSchemaKey(projectId, trackerName)] || [];
    return {
      ok: true,
      trackerId: trackerIdCache[trackerName],
      priorityOptions: Object.keys(priorityIdCache),
      customFields,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// สมาชิกจริงของโปรเจกต์ — ต่างจาก assignee list ในแท็บ Redmine ที่มาจาก "คนที่เคยมี issue ถูก
// assign" คนใหม่ในทีมที่ยังไม่เคยได้ assign อะไรเลยจะไม่โผล่ในลิสต์นั้น
ipcMain.handle('get-project-members', async (_e, projectId) => {
  if (!redmineConfig.url || !redmineConfig.apiKey) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    const res = await fetch(`${redmineConfig.url}/projects/${projectId}/memberships.json?limit=100`,
      { headers: { 'X-Redmine-API-Key': redmineConfig.apiKey } });
    if (!res.ok) return { ok: false, error: `Redmine HTTP ${res.status}` };
    const data = await res.json();
    const members = (data.memberships || [])
      .filter(m => m.user)
      .map(m => ({ id: m.user.id, name: m.user.name }));
    return { ok: true, members };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// เรียก llm.js — apiKey/baseUrl มาจากการ์ดตั้งค่า LLM (config.json) renderer ส่งมาแค่ rawNotes/model/language/tracker
ipcMain.handle('draft-issue-text', async (_e, rawNotes, opts) => {
  const result = await draftIssue(rawNotes, {
    ...opts,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
  });
  if (!result.ok) return result;
  const d = result.draft;
  const description = composeDescription(opts.language || 'both', d.description_th || '', d.description_en || '');
  const subject = d.subject_en || d.subject_th || '';
  return { ok: true, draft: { ...d, subject, description } };
});
ipcMain.handle('upload-issue-attachment', async (_e, fileBuffer, filename) => {
  if (!redmineConfig.url || !redmineConfig.apiKey) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    const res = await fetch(`${redmineConfig.url}/uploads.json`, {
      method: 'POST',
      headers: { 'X-Redmine-API-Key': redmineConfig.apiKey, 'Content-Type': 'application/octet-stream' },
      body: fileBuffer,
    });
    if (!res.ok) return { ok: false, error: `Redmine HTTP ${res.status}` };
    const { upload } = await res.json();
    return { ok: true, token: upload.token, filename };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// ปุ่ม "ยืนยันสร้าง" ในหน้า review เท่านั้นที่เรียก handler นี้ — 422 คืน fieldErrors ให้ฟอร์ม
// ไฮไลต์ field ที่ขาด แทนการ retry เงียบ ๆ (ตาข่ายรอง C ของ spec)
ipcMain.handle('create-issue', async (_e, form) => {
  if (!redmineConfig.url || !redmineConfig.apiKey) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Redmine' };
  try {
    await Promise.all([loadTrackerMeta(), loadPriorityMeta()]);
    const key = fieldSchemaKey(form.projectId, form.trackerName);
    const riskField = (issueFormFieldsCache[key] || []).find(f => f.name === 'Risk Level');
    if (form.riskLevel && !riskField) {
      return { ok: false, error: 'ระบบยังไม่รู้จัก field Risk Level ของโปรเจกต์/tracker นี้ (แคชยังไม่มีข้อมูล) — เปิดแท็บ Redmine ทิ้งไว้สักครู่ให้โหลดข้อมูลใหม่ แล้วกลับมาสร้าง issue อีกครั้ง หรือกรอก issue นี้ผ่านหน้าเว็บ Redmine โดยตรงแทน' };
    }
    const body = buildIssuePayload(form, {
      trackerIdByName: trackerIdCache,
      priorityIdByName: priorityIdCache,
      riskLevelFieldId: riskField && riskField.id,
    });
    const res = await fetch(`${redmineConfig.url}/issues.json`, {
      method: 'POST',
      headers: { 'X-Redmine-API-Key': redmineConfig.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let errors = [];
      try { const errBody = await res.json(); errors = errBody.errors || []; } catch {}
      const fieldNames = (issueFormFieldsCache[key] || []).map(f => f.name);
      return { ok: false, error: `Redmine HTTP ${res.status}`, fieldErrors: parseValidationErrors(errors, fieldNames) };
    }
    const { issue } = await res.json();
    pushTasks();
    return { ok: true, id: issue.id, url: `${redmineConfig.url}/issues/${issue.id}` };
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
  currentUserCache = null; statusIdCache = null; trackerIdCache = null; priorityIdCache = null; // tied to the old credentials
  pushTasks();
  return { ok: true };
});
// การ์ดตั้งค่า LLM (แท็บ QA test): base URL + key ของ endpoint แบบ OpenAI-compatible
// ที่ใช้ร่าง issue — เก็บใน config.json เหมือน Redmine/Grafana ไม่ใช่ .env เพราะ .env
// ของแอปที่ติดตั้งแล้วไม่รอดการอัปเดต (ไม่ได้อยู่ใน build.files/extraResources)
ipcMain.handle('get-llm-config', () => ({ baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey }));
ipcMain.handle('save-llm-config', (_e, { baseUrl, apiKey }) => {
  llmConfig = { baseUrl: String(baseUrl || '').trim(), apiKey: String(apiKey || '').trim() };
  writeConfigMerge({ llmBaseUrl: llmConfig.baseUrl, llmApiKey: llmConfig.apiKey });
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
// glossary.md ของ meeting-notes อยู่ระดับเดียวกับโฟลเดอร์ meetings (src/config.py:453
// กำหนด meetings_dir = base_dir / "meetings") จึงอนุมานจาก meetingsDir ได้ ไม่ต้องมี
// setting แยก -- ถ้าใครวาง repo ผิดรูป จะเห็น path ที่หาในข้อความ error ตรง ๆ
function glossaryPath() {
  return meetingsDir ? path.join(path.dirname(meetingsDir), 'glossary.md') : '';
}

ipcMain.handle('get-glossary-state', () => {
  const file = glossaryPath();
  if (!file) return { path: '', exists: false, sections: {}, error: 'ยังไม่ได้ตั้งค่าโฟลเดอร์ประชุม' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { return { path: file, exists: false, sections: {}, error: null }; }
  const g = parseGlossary(text);
  const sections = {};
  for (const [name, bucket] of Object.entries(g.sections)) {
    sections[name] = Object.fromEntries(Object.entries(bucket).map(([t, e]) => [t, e.forms]));
  }
  return { path: file, exists: true, sections, error: null };
});

ipcMain.handle('append-glossary', (_e, entries, meta) => {
  const file = glossaryPath();
  if (!file) return { ok: false, error: 'ยังไม่ได้ตั้งค่าโฟลเดอร์ประชุม' };
  let text;
  // อ่านใหม่ทุกครั้งก่อนเขียน ไม่ cache ข้ามการกด -- ไฟล์นี้คนเปิด editor แก้เองได้ตลอด
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { return { ok: false, error: `ไม่พบไฟล์ glossary.md ที่ ${file}` }; }
  const plan = planWrite(text, entries, meta);
  if (plan.newText !== null) {
    // Important 5: glossary.md เขียนมือ ไม่มี git คุ้มครอง (.gitignore) และไม่มีสำเนาสำรองที่ไหน
    // เลย -- fs.writeFileSync ตรง ๆ เปิดไฟล์แบบ truncate-then-write ถ้าโปรเซสถูกฆ่ากลางคัน
    // (แครช/ปิดเครื่อง/OOM) ระหว่างเขียน ไฟล์จะเหลือครึ่งเดียวถาวรโดยไม่มีทางกู้คืน
    // เขียนลงไฟล์ temp ในโฟลเดอร์เดียวกันก่อน (ต้องอยู่โฟลเดอร์เดียวกันให้ fs.renameSync เป็น
    // atomic rename ในระบบไฟล์เดียวกัน ข้าม filesystem แล้ว rename จะไม่ atomic อีกต่อไป) แล้ว
    // ค่อย rename ทับ -- rename เป็น atomic operation ระดับ OS ผลลัพธ์จึงมีแค่สองสถานะ คือ
    // ไฟล์เดิมทั้งก้อน หรือไฟล์ใหม่ทั้งก้อน ไม่มีสถานะครึ่ง ๆ กลาง ๆ ให้เห็นเลย
    const tmp = path.join(path.dirname(file), `.glossary.md.tmp-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(tmp, plan.newText, 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ไฟล์ temp อาจไม่ถูกสร้างเลยด้วยซ้ำถ้า writeFileSync พังก่อน */ }
      return { ok: false, error: `เขียนไฟล์ไม่สำเร็จ: ${e.message}` };
    }
  }
  const { newText, ...report } = plan;
  return { ok: true, error: null, ...report };
});
// renderer's QA test tab: read/save the list of { label, path } sources
// ---- Grafana tab ----
// Pull, not push, unlike the other four tabs. Those read files or one fixed API call,
// so main can poll and broadcast. Here the query depends on filters the user is moving
// (time range, apps, search), so the renderer has to be the one asking. It polls while
// the tab is visible and stops when it isn't.
//
// The token is never sent to the renderer — only whether one exists and its last four
// characters, enough for "is this the key I pasted?" without handing the secret to a
// window that renders remote log content. (The Redmine card does return its key; this
// one deliberately does not.)
function grafanaConfigForRenderer() {
  const shape = (c) => ({
    url: c.url,
    hasToken: Boolean(c.token),
    tokenHint: c.token ? `…${c.token.slice(-4)}` : '',
  });
  return { dev: shape(grafanaConfig.dev), prod: shape(grafanaConfig.prod) };
}
ipcMain.handle('get-grafana-config', () => grafanaConfigForRenderer());
ipcMain.handle('save-grafana-config', (_e, { env, url, token }) => {
  const key = env === 'prod' ? 'prod' : 'dev';
  // An empty token field means "leave the stored one alone", so re-saving a URL does
  // not silently wipe the credential the user can no longer read back.
  const next = { url: String(url || '').trim(), token: String(token || '').trim() || grafanaConfig[key].token };
  grafanaConfig[key] = next;
  writeConfigMerge(key === 'prod'
    ? { grafanaProdUrl: next.url, grafanaProdToken: next.token }
    : { grafanaDevUrl: next.url, grafanaDevToken: next.token });
  dropGrafanaClients(key);         // drop both lanes' queues/uid with the old credentials
  return { ok: true, config: grafanaConfigForRenderer() };
});
ipcMain.handle('test-grafana-connection', async (_e, { env, url, token }) => {
  const key = env === 'prod' ? 'prod' : 'dev';
  const probe = new Grafana({
    url: String(url || '').trim() || grafanaConfig[key].url,
    token: String(token || '').trim() || grafanaConfig[key].token,
  });
  if (!probe.configured) return { ok: false, error: 'ยังไม่ได้กรอก URL หรือ token' };
  try { return { ok: true, ...(await probe.test()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('grafana-query', async (_e, params) => {
  const g = grafanaFor(params && params.env, 'fg');
  if (!g.configured) return { error: 'ยังไม่ได้ตั้งค่า Grafana', notConfigured: true };
  try { return await g.queryLogs(params || {}); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('grafana-overview', async (_e, params) => {
  const g = grafanaFor(params && params.env, 'bg');
  if (!g.configured) return { error: 'ยังไม่ได้ตั้งค่า Grafana', notConfigured: true };
  const p = params || {};
  // Each part is reported on its own: the slow-endpoint query is the heaviest and a
  // timeout there must not blank out the issue counts that already came back.
  const out = {};
  await Promise.all([
    g.issueCounts(p).then(v => { out.issueCounts = v; }, e => { out.issueCountsError = e.message; }),
    g.slowEndpoints(p).then(v => { out.slowEndpoints = v; }, e => { out.slowEndpointsError = e.message; }),
    g.statusInventory(p).then(v => { out.statusSeen = v; }, e => { out.statusSeenError = e.message; }),
  ]);
  return out;
});
// The problem list comes from the renderer because that is where the log lines are
// parsed and clustered — deriving the same signatures again in main would be a second
// copy of that logic, free to drift from the first.
ipcMain.handle('grafana-history', async (_e, { env, problems, days } = {}) => {
  const g = grafanaFor(env, 'bg');
  if (!g.configured) return { error: 'ยังไม่ได้ตั้งค่า Grafana', notConfigured: true };
  const list = (Array.isArray(problems) ? problems : [])
    .filter(p => p && p.app && p.needle)
    // Bounded on purpose: this is days × problems serial queries against an instance
    // that 429s on concurrency. 12 problems × 8 days is already ~96 round trips.
    .slice(0, 12)
    .map(p => ({ app: String(p.app), needle: String(p.needle).slice(0, 120), level: String(p.level || '') }));
  if (!list.length) return { history: [] };
  try { return { history: await g.history(list, Math.min(Math.max(Number(days) || 8, 2), 14)) }; }
  catch (e) { return { error: e.message }; }
});
// ตัวเลขจริงของทั้งช่วง — แยก handler จาก grafana-query เพราะรายการต้องมาก่อน
// พอช่วงเวลากว้าง queryLogs คืนเป็นกลุ่มตัวอย่าง เลขจากตัวอย่างนั้นเอียงตามแอปที่ log ถี่สุด
// (ที่ 3 วัน menutable-api กิน 2,406 จาก 2,997 บรรทัด) เอาไปโชว์เป็นยอดรวมคือตัวเลขที่โกหก
ipcMain.handle('grafana-summary', async (_e, params) => {
  const g = grafanaFor(params && params.env, 'bg');
  if (!g.configured) return { error: 'ยังไม่ได้ตั้งค่า Grafana', notConfigured: true };
  try { return await g.windowSummary(params || {}); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('grafana-app-groups', () => APP_GROUPS);

ipcMain.handle('get-qa-sources', () => qaSources);
ipcMain.handle('save-qa-sources', (_e, sources) => {
  qaSources = (sources || []).filter(s => s && s.path);
  writeConfigMerge({ qaSources });
  pushQaTests();
  return { ok: true };
});
// renderer's Meeting tab: the recorder controls. The renderer never talks to
// 127.0.0.1 itself — everything it can do goes through these five handles.
// รูปเดียวกับที่ runner-update ส่งเป๊ะ เพราะเป็นตัวอ่านตัวเดียวกัน
ipcMain.handle('runner-get-state', () => readRunner());
ipcMain.handle('runner-start', async (_e, model, name, profile, engine) => {
  try {
    const res = await fetch(`http://127.0.0.1:${runnerPort}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // profile/engine ที่เป็น undefined ต้องไม่กลายเป็น key ใน JSON -- JSON.stringify ตัดให้เอง
      // ผลคือเครื่องที่ยังไม่เคยตั้งค่านี้ส่ง payload เท่าเดิมเป๊ะ แล้วฝั่ง service
      // fallback ไป config.meeting_profile/DEFAULT_ASR_ENGINE ตามเดิม ไม่ใช่ได้ค่า null ที่ไม่มีใครรับมือ
      body: JSON.stringify({ model, name: name || '', profile, asr_engine: engine }),
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
  port: runnerPort, model: runnerModel, profile: runnerProfile, engine: runnerEngine, seen: runnerSeen,
}));
ipcMain.handle('save-runner-config', (_e, cfg) => {
  const patch = {};
  if (cfg && cfg.port) { runnerPort = Number(cfg.port) || 8765; patch.meetingRunnerPort = runnerPort; }
  if (cfg && cfg.model) { runnerModel = cfg.model; patch.meetingRunnerModel = runnerModel; }
  if (cfg && cfg.profile) { runnerProfile = cfg.profile; patch.meetingRunnerProfile = runnerProfile; }
  if (cfg && cfg.engine) { runnerEngine = cfg.engine; patch.meetingRunnerEngine = runnerEngine; }
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
