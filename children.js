// ทะเบียนโพรเซสลูกของ main process
//
// อะไรที่วิดเจ็ต spawn เองต้องผ่านไฟล์นี้ทั้งหมด เพื่อให้ตอนแอปปิดมีที่เดียวที่รู้ว่ามีลูกอยู่กี่ตัว
// -- ข้อยกเว้นเดียวคือตัวติดตั้งอัปเดตใน main.js ที่ตั้งใจให้รอดหลังแอปปิด
//
// ทะเบียนนี้ไม่รู้จัก session_service หรือ HTTP ใด ๆ เจ้าของโพรเซสเป็นคนส่ง isBusy เข้ามาเอง
// โพรเซสชนิดใหม่ในอนาคตจึงเสียบเข้ามาได้โดยไม่ต้องแก้ไฟล์นี้
const { spawn: realSpawn, execFile } = require('child_process');

// ---- ตรรกะตัดสินใจ ตอนแอปกำลังจะปิด ---------------------------------------
// บริสุทธิ์ ไม่แตะโพรเซสจริง เพื่อให้เทสต์ได้โดยไม่ต้องเปิด Electron
//   kill  = ฆ่าทุกตัวแล้วปิดได้เลย
//   ask   = มีตัวยุ่ง ต้องถามผู้ใช้ก่อน
//   quiet = มีตัวยุ่ง แต่อยู่ระหว่างอัปเดต ห้ามเด้งกล่องกลางทาง ปิดเฉพาะตัวที่ว่าง
function decideQuit(states, opts) {
  const updating = !!(opts && opts.updating);
  const live = (states || []).filter(s => s && s.pid);
  if (!live.some(s => s.busy)) return 'kill';
  return updating ? 'quiet' : 'ask';
}

// ---- หา orphan จากรอบก่อน ---------------------------------------------------
// เทียบ path แบบ normalize แล้ว: WMI คืน slash กับตัวพิมพ์ไม่ตรงกับที่เราประกอบเองได้
function normPath(p) {
  return String(p == null ? '' : p).replace(/\//g, '\\').toLowerCase();
}

function matchOrphan(procs, opts) {
  const want = new Set(((opts && opts.exePaths) || []).map(normPath));
  const needle = String((opts && opts.needle) || '').toLowerCase();
  return (procs || [])
    .filter(p => p && p.ProcessId && want.has(normPath(p.ExecutablePath))
      && String(p.CommandLine || '').toLowerCase().includes(needle))
    .map(p => p.ProcessId);
}

// ---- ฆ่าโพรเซสจริง ----------------------------------------------------------
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function taskkill(args) {
  return new Promise(resolve => {
    execFile('taskkill', args, { windowsHide: true }, () => resolve());
  });
}

// /T เสมอ เพราะลูกอาจมีลูกของมันเองอีกที (session_service เรียก ffmpeg) ฆ่าแค่ตัวแม่จะเหลือหลานลอย
// ลองแบบสุภาพก่อน รอ 3 วินาที ยังไม่ตายค่อย /F -- โพรเซสที่ไม่มีหน้าต่างมักไม่รับ WM_CLOSE
// จึงคาดว่าส่วนใหญ่จะไปจบที่ /F แต่ตัวที่ปิดตัวเองได้สวยก็ควรได้โอกาสนั้น
async function defaultKill(pid) {
  await taskkill(['/PID', String(pid), '/T']);
  for (let i = 0; i < 6 && alive(pid); i++) await sleep(500);
  if (alive(pid)) await taskkill(['/PID', String(pid), '/T', '/F']);
  return !alive(pid);
}

// ---- ตัวทะเบียน -------------------------------------------------------------
function createRegistry(deps) {
  const spawnFn = (deps && deps.spawnFn) || realSpawn;
  const killFn = (deps && deps.killFn) || defaultKill;
  const kids = new Map();   // pid -> { pid, name, isBusy }

  function put(pid, meta) {
    kids.set(pid, {
      pid,
      name: (meta && meta.name) || String(pid),
      isBusy: (meta && meta.isBusy) || null,
    });
  }

  function spawnTracked(exe, args, opts, meta) {
    const child = spawnFn(exe, args, opts);
    // ต้องผูก 'error' ก่อนเช็ค pid เสมอ -- ตอน spawn ล้มเหลว (ENOENT/EACCES/EPERM) บน Windows
    // child.pid ยังเป็น undefined ตอนนี้ ถ้าเช็คแล้ว return ก่อนผูก listener โพรเซสจะยิง 'error'
    // แบบ async ภายหลังโดยไม่มีใครฟัง กลายเป็น uncaught exception ที่ทำ main process ของ Electron ล่มทั้งตัว
    if (child && child.on) child.on('error', (err) => {
      console.log('[children] spawn failed', exe, err && err.message);
      // pid อาจยังไม่เคยถูกตั้งค่า (ล้มเหลวตั้งแต่ spawn) จึงต้องเช็คก่อนลบ ไม่งั้นจะลบ key undefined ทิ้งเปล่า ๆ
      if (child.pid) kids.delete(child.pid);
    });
    if (!child || !child.pid) return null;
    put(child.pid, meta);
    // ลูกที่ตายเองต้องหลุดออกจากทะเบียน ไม่งั้นตอนปิดจะไปไล่ฆ่า pid ที่คนอื่นใช้ต่อไปแล้ว
    if (child.on) child.on('exit', () => kids.delete(child.pid));
    if (child.unref) child.unref();
    return child;
  }

  // รับ orphan ที่รอบก่อนทิ้งไว้ -- ไม่มี event 'exit' ให้ฟัง เพราะไม่ใช่ลูกของโพรเซสนี้
  function adopt(pid, meta) {
    if (!pid || kids.has(pid)) return false;
    put(pid, meta);
    return true;
  }

  function list() {
    return [...kids.values()].map(k => ({ pid: k.pid, name: k.name }));
  }

  // isBusy ที่เรียกไม่ติดแปลว่าโพรเซสตายไปแล้ว ไม่ใช่ว่ามันยุ่ง -- ถ้าตีเป็นยุ่ง
  // ผู้ใช้จะโดนถามทุกครั้งที่ปิดแอปโดยที่ไม่มีอะไรทำงานอยู่จริง
  async function states() {
    return Promise.all([...kids.values()].map(async k => {
      let busy = false;
      if (k.isBusy) { try { busy = !!(await k.isBusy()); } catch { busy = false; } }
      return { pid: k.pid, name: k.name, busy };
    }));
  }

  async function stopAll(pids) {
    for (const pid of (pids || [...kids.keys()])) {
      await killFn(pid);
      kids.delete(pid);
    }
  }

  return { spawnTracked, adopt, list, states, stopAll };
}

module.exports = { decideQuit, matchOrphan, createRegistry, registry: createRegistry({}) };
