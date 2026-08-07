// Reads Appium/BlueStacks QA result folders (one timestamp-named subfolder per
// run, each with test-log.txt and, on failure, failure.xml) into a plain
// object for the QA test tab. Pure fs/path — no Electron needed.
// See docs/superpowers/specs/2026-07-27-qa-test-tab-design.md
const fs = require('fs');
const path = require('path');

// a run folder's status comes from the last line of test-log.txt — a run
// killed/crashed mid-way never writes a RESULT line at all
function parseLog(text) {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n').filter(Boolean);
  const ts = l => (/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/.exec(l) || [])[1];
  const first = ts(lines[0]), last = ts(lines[lines.length - 1]);
  // colon เป็นทางเลือก — ฝั่งมือถือ 6 ใน 10 ไฟล์เขียนว่า "🚀 เริ่มทดสอบ dine-in order (Till)..."
  // ไม่มี colon เดิมจึงได้ name เป็น null แล้วขึ้น "(ไม่ระบุชื่อเทส)" ทุกรอบโดยไม่มีใครสังเกต
  // (ที่ไม่เคยเห็นเพราะผลรันที่มีอยู่บังเอิญมาจากสองไฟล์ที่มี colon ทั้งหมด)
  const nameLine = lines.find(l => /🚀 เริ่มทดสอบ/.test(l));
  const name = nameLine ? nameLine.replace(/^.*🚀 เริ่มทดสอบ:?\s*/, '').trim() || null : null;
  // ชื่อไฟล์เทสที่ตัวรันเขียนบอกไว้เอง — ต่างจาก name ตรงที่เป็น id จริง เอาไป map กับข้อ
  // checklist ใน Testing Room ได้ ล็อกเก่าที่ยังไม่มีบรรทัดนี้คืน null (ยังใช้งานได้ตามเดิม)
  const testLine = lines.find(l => /\bTEST:\s/.test(l));
  const testId = testLine ? testLine.replace(/^.*\bTEST:\s*/, '').trim() || null : null;
  const lastLine = lines[lines.length - 1] || '';
  const status = /RESULT:\s*PASS/.test(lastLine) ? 'PASS'
    : /RESULT:\s*FAIL/.test(lastLine) ? 'FAIL' : 'CRASH';
  return { name, testId, status, startedAt: first, endedAt: last, log: lines.join('\n') };
}

// one source → array of runs, newest first
function readQaSource(source) {
  const entries = fs.readdirSync(source.path, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name)); // timestamp folder names sort chronologically
  return entries.map(e => {
    const runDir = path.join(source.path, e.name);
    const logFile = path.join(runDir, 'test-log.txt');
    if (!fs.existsSync(logFile)) return null;
    const parsed = parseLog(fs.readFileSync(logFile, 'utf8'));
    return {
      id: e.name,
      dir: runDir,
      sourceLabel: source.label || path.basename(source.path),
      ...parsed,
      testKey: runTestKey(parsed),
      hasXml: fs.existsSync(path.join(runDir, 'failure.xml')),
    };
  }).filter(Boolean);
}

// sources: { label, path }[] — every configured source, in order
function readQaResults(sources) {
  if (!sources || !sources.length) {
    return { runs: [], sources: [], error: 'ไม่พบโฟลเดอร์ QA test: (ไม่ได้ตั้งค่า)' };
  }
  const runs = [];
  for (const source of sources) {
    if (!source || !source.path) continue;
    // one bad source (missing folder, permissions) shouldn't blank the others — skip it
    try { runs.push(...readQaSource(source)); } catch (e) {}
  }
  runs.sort((a, b) => b.id.localeCompare(a.id));
  return { runs, sources: sources.map(s => s.label || path.basename(s.path)) };
}

// ---- "รอบนี้มาจากเทสตัวไหน" ----
// testId (ชื่อไฟล์จากบรรทัด TEST:) เป็นของจริง แต่ล็อกที่เขียนก่อน 2026-08-06 ไม่มีบรรทัดนั้น
// เลย — ผลรันที่มีอยู่ตอนนี้ทุกอันเป็นแบบนั้นทั้งหมด ถ้าจัดกลุ่มด้วย testId ล้วนจะได้กอง
// "ไม่รู้ไฟล์" กองเดียวจนกว่าจะรันรอบใหม่ จึงตกไปใช้ชื่อไทยจาก 🚀 เริ่มทดสอบ แทน
// (ชื่อไทยไม่ใช่ id: ไฟล์คนละไฟล์เขียนซ้ำกันได้ ใช้ได้แค่แยกกลุ่มคร่าว ๆ ไม่ใช่ใช้จับคู่กับใบเทส)
function runTestKey(run) {
  if (!run) return '';
  return String(run.testId || run.name || '').trim();
}
module.exports = { readQaResults, parseLog, runTestKey };
