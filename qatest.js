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
  const nameLine = lines.find(l => l.includes('🚀 เริ่มทดสอบ:'));
  const name = nameLine ? nameLine.split('🚀 เริ่มทดสอบ:')[1].trim() : null;
  const lastLine = lines[lines.length - 1] || '';
  const status = /RESULT:\s*PASS/.test(lastLine) ? 'PASS'
    : /RESULT:\s*FAIL/.test(lastLine) ? 'FAIL' : 'CRASH';
  return { name, status, startedAt: first, endedAt: last, log: lines.join('\n') };
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

module.exports = { readQaResults, parseLog };
