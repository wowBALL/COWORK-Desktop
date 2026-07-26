// Reads the meeting-notes vault (one folder per meeting, each with summary.md /
// transcript.md / optional audio) into a plain object for the Meeting tab.
// Pure fs/path — no Electron needed, so it can be run standalone with
// `node meetings.js "D:\COWORK\meeting-notes\meetings"`.
const fs = require('fs');
const path = require('path');

const AUDIO_RE = /\.(ogg|mp3|wav|m4a|webm)$/i;
// headings that say nothing about *what* was discussed — never offered as a topic chip
const GENERIC_TOPIC = /^(สรุป(การประชุม)?|ประเด็นสำคัญ|action items?|หัวข้อ|บทสรุป|รายละเอียด|อื่น ?ๆ)$/i;
// a transcript line: **ผู้พูด 1** [00:01]: ข้อความ
const UTT_RE = /^\*\*(.+?)\*\*\s*\[(.+?)\]\s*:\s*(.*)$/;

// the .md files are CRLF; regexes anchored with $ silently miss unless we normalize
function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; }
}

// folder name → { date, time, title }
// 2026-07-24_19-01-Meet1900 | 2026-07-24_12-23 | 2026-07-24_Meet19
function parseFolderName(name) {
  const m = /^(\d{4}-\d{2}-\d{2})_(?:(\d{2})-(\d{2})(?:-(.*))?|(.*))$/.exec(name);
  if (!m) return { date: '', time: '', title: name };
  return {
    date: m[1],
    time: m[2] ? `${m[2]}:${m[3]}` : '',
    // โฟลเดอร์ที่มีแต่วัน-เวลา (ไม่ได้ตั้งชื่อประชุม) ใช้เวลาเป็นชื่อแทน
    title: (m[4] || m[5] || '').trim() || (m[2] ? `ประชุม ${m[2]}:${m[3]}` : name),
  };
}

// หัวข้อย่อยที่คุยกัน — ใช้ `### หัวข้อ` ก่อน ถ้าไม่มีค่อยใช้ bullet ที่ขึ้นต้นด้วย **ตัวหนา**
function topicsOf(summary) {
  const out = [];
  for (const m of summary.matchAll(/^###\s*\d*[.)]?\s*(.+)$/gm)) out.push(m[1]);
  if (!out.length)
    for (const m of summary.matchAll(/^\s*[-*]\s+\*\*(.+?)\*\*/gm)) out.push(m[1]);
  return [...new Set(out.map(t => t.replace(/\*\*/g, '').replace(/[:：]\s*$/, '').trim()))]
    .filter(t => t && !GENERIC_TOPIC.test(t))
    .slice(0, 6);
}

// จำนวน bullet ใต้หัวข้อ "Action Items" — ตัดที่หัวข้อระดับเดียวกันหรือสูงกว่า
// (บางไฟล์ซอย Action Items เป็น ### ย่อยอีกที ห้ามตัดตรงนั้น)
function actionCount(summary) {
  const h = /^(#{1,4})\s*Action Items?.*$/im.exec(summary);
  if (!h) return 0;
  const rest = summary.slice(h.index + h[0].length);
  const stop = new RegExp(`^#{1,${h[1].length}}\\s`, 'm').exec(rest);
  const block = stop ? rest.slice(0, stop.index) : rest;
  return (block.match(/^\s*[-*]\s+\S/gm) || []).length;
}

// สรุปที่ AI ยอมแพ้ ("ขออภัย...") ไม่ควรดูเหมือนสรุปปกติ
function summaryUsable(summary) {
  const t = summary.trim();
  return !!t && !/^ขออภัย/.test(t);
}

function parseTranscript(raw) {
  const speakers = [];
  const utterances = [];
  for (const line of raw.split('\n')) {
    const m = UTT_RE.exec(line.trim());
    if (!m) continue;
    let i = speakers.indexOf(m[1]);
    if (i === -1) { speakers.push(m[1]); i = speakers.length - 1; }
    utterances.push({ who: m[1], speaker: i, ts: m[2], text: m[3] });
  }
  return { speakers, utterances };
}

// รายละเอียดเต็มของประชุมเดียว — โหลดตอนกดเข้าไปอ่าน ไม่ส่งมาพร้อมรายการ
function readTranscript(root, id) {
  const dir = path.join(root, id);
  // id มาจาก renderer — กันไม่ให้หลุดออกนอก root
  if (path.dirname(dir) !== path.resolve(root)) return { error: 'invalid id' };
  const raw = readText(path.join(dir, 'transcript.md'));
  return { id, ...parseTranscript(raw), error: null };
}

function readMeeting(root, name) {
  const dir = path.join(root, name);
  let files = [];
  try { files = fs.readdirSync(dir).sort(); } catch { return null; }
  const { date, time, title } = parseFolderName(name);
  const summary = readText(path.join(dir, 'summary.md'));
  const transcript = readText(path.join(dir, 'transcript.md'));
  const { speakers, utterances } = parseTranscript(transcript);
  const audioName = files.find(f => AUDIO_RE.test(f)) || null;
  let audioSize = 0;
  if (audioName) { try { audioSize = fs.statSync(path.join(dir, audioName)).size; } catch {} }
  return {
    id: name, dir, date, time, title,
    summary,                                  // markdown ดิบ — renderer เป็นคน render
    topics: topicsOf(summary),
    actions: actionCount(summary),
    usable: summaryUsable(summary),
    speakers: speakers.length,
    lines: utterances.length,
    lastStamp: utterances.length ? utterances[utterances.length - 1].ts : '',
    audio: audioName ? { name: audioName, size: audioSize, path: path.join(dir, audioName) } : null,
    files: files.map(f => ({ name: f, path: path.join(dir, f) })),
  };
}

function readMeetings(root) {
  if (!root || !fs.existsSync(root)) {
    return { meetings: [], stats: null, error: `ไม่พบโฟลเดอร์ meetings: ${root || '(ไม่ได้ตั้งค่า)'}` };
  }
  const meetings = [];
  for (const name of fs.readdirSync(root)) {
    let st;
    try { st = fs.statSync(path.join(root, name)); } catch { continue; }
    if (!st.isDirectory()) continue;
    const m = readMeeting(root, name);
    if (m) meetings.push(m);
  }
  // ใหม่สุดขึ้นก่อน
  meetings.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.id.localeCompare(a.id));

  const stats = {
    total: meetings.length,
    days: new Set(meetings.map(m => m.date)).size,
    actions: meetings.reduce((s, m) => s + m.actions, 0),
    lines: meetings.reduce((s, m) => s + m.lines, 0),
    audio: meetings.filter(m => m.audio).length,
  };
  return { meetings, stats, error: null };
}

module.exports = { readMeetings, readTranscript };

// standalone sanity run: node meetings.js "D:\COWORK\meeting-notes\meetings"
if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'meeting-notes', 'meetings');
  const out = readMeetings(dir);
  console.log(JSON.stringify({ ...out, meetings: out.meetings.map(m => ({ ...m, summary: m.summary.slice(0, 60) + '…' })) }, null, 2));
}
