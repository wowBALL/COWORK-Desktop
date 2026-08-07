'use strict';

// ใบเทส (Qtest) ของ Testing Room — markdown หนึ่งไฟล์ต่อหนึ่งรอบการรับงานเข้าเทส
// เก็บที่ <qtestDir>/yyyymmdd-<เลข issue>.md  ส่งเทสซ้ำวันเดียวกันเติม -2, -3 ต่อท้าย
//
// ตัวไฟล์เป็น source of truth ตัวเดียว (ตัดสินใจ 2026-08-06) — เปิดใน Obsidian/VS Code
// อ่านรู้เรื่องและแก้มือได้ ฝั่ง UI อ่านมาทั้งใบแล้วเขียนทับทั้งใบทุกครั้งที่ติ๊กผล
// จึงต้องรักษา key ใน frontmatter ที่โมดูลนี้ไม่รู้จักไว้ให้ครบเสมอ (ดูเทสข้อ "key ที่โมดูล
// ไม่รู้จักต้องรอด") ไม่งั้นจะเป็นบั๊กคลาสเดียวกับ whole-file-rewrite-drops-the-key-you-omit
//
// pure fs/path ล้วน ไม่มี Electron — รันผ่าน node --test ได้ตรงเหมือน qatest.js
const fs = require('fs');
const path = require('path');

const BY = ['qa', 'auto', 'ข้าม'];
const RESULT = ['–', 'pass', 'fail'];
// "สาเหตุ" = ผลการตรวจของ QA ว่าข้อที่ auto fail เป็นบั๊กของระบบจริง หรือสคริปเทสเองพัง
// ค่าว่าง = ยังไม่ได้เข้าไปตรวจ — ต่างจาก "ไม่มีปัญหา" ต้องแยกออกจากกันให้ได้
const CAUSE = ['', 'แอป', 'สคริป'];
// "วันที่" = วันที่ข้อนั้นได้ผล แยกรายข้อ ไม่ใช่วันเดียวทั้งใบ — ใบหนึ่งมักเทสข้ามหลายวัน
// เพิ่มเข้ามาทีหลัง จึงอ่านตำแหน่งคอลัมน์จากแถวหัวตาราง ไม่ใช่นับตำแหน่งตายตัว
// (ใบเก่าที่มี 6 คอลัมน์ต้องอ่านได้ครบทุกแถวเหมือนเดิม ดูเทส "ใบเก่าที่ยังไม่มีคอลัมน์วันที่")
// "เทส" = ชื่อไฟล์เทสอัตโนมัติที่ข้อนี้ผูกไว้ (ตรงกับ TEST: ใน test-log.txt ของรอบรัน)
// "ระบบ" = label ของแหล่งที่ไฟล์นั้นอยู่ — ชื่อไฟล์อย่างเดียวบอกไม่ได้ว่าต้องรันด้วยอะไร
// และสองแหล่งมีไฟล์ชื่อซ้ำกันได้ · ทั้งคู่เป็นการตั้งค่า ไม่ใช่ผล จึงไม่ถูกล้างตอนถอนผล/กดข้าม
const COLUMNS = ['#', 'สิ่งที่ต้องทดสอบ', 'ทำโดย', 'ผล', 'สาเหตุ', 'วันที่', 'ระบบ', 'เทส', 'run', 'หมายเหตุ'];
const LEGACY_COLUMNS = ['#', 'สิ่งที่ต้องทดสอบ', 'ทำโดย', 'ผล', 'run', 'หมายเหตุ'];
const NOTES_HEADING = '## บันทึกเพิ่มเติม';

// ---- frontmatter ----
// YAML ที่ใช้จริงในใบเทสมีแค่ key: value ชั้นเดียว จึงเขียนเองแทนการลาก dependency เข้ามา
// ค่าที่เป็น string ถูก quote เมื่อมันจะถูกอ่านกลับผิดชนิด (ดูเหมือนเลข/บูลีน) หรือมีอักขระ
// ที่ YAML ใช้เอง — ที่เหลือปล่อยเปล่าไว้ให้คนอ่านสบายตา
function needsQuote(s) {
  return s === '' || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /:\s|\s#|["\n]/.test(s)
    || /^(true|false|null|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s) || /^\s|\s$/.test(s);
}
function dumpValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v == null ? '' : v);
  return needsQuote(s) ? JSON.stringify(s) : s;
}
function loadValue(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s.startsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

// ---- ตารางเป็นข้อ ----
// เนื้อ cell ที่มี | ในตัวเองจะทำให้คอลัมน์เลื่อนทั้งแถว escape ตอนเขียน ถอดตอนอ่าน
function escCell(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function unescCell(s) { return String(s == null ? '' : s).replace(/\\\|/g, '|').replace(/\\\\/g, '\\').trim(); }
// split ที่เคารพ \| — ตัดที่ | ที่ไม่มี backslash นำหน้าเท่านั้น
function splitRow(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) { cur += line[i] + line[i + 1]; i++; continue; }
    if (line[i] === '|') { out.push(cur); cur = ''; continue; }
    cur += line[i];
  }
  out.push(cur);
  return out.slice(1, -1); // ทิ้งช่องว่างหน้า | แรกและหลัง | สุดท้าย
}
function byPosition(names) {
  const map = {};
  names.forEach((c, i) => { map[c] = i; });
  return map;
}
function oneOf(list, v, fallback) {
  const s = String(v == null ? '' : v).trim();
  return list.includes(s) ? s : fallback;
}

function serializeQtest(sheet) {
  const meta = (sheet && sheet.meta) || {};
  const items = (sheet && Array.isArray(sheet.items)) ? sheet.items : [];
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) lines.push(`${k}: ${dumpValue(v)}`);
  lines.push('---', '', '## Checklist', '');
  lines.push(`| ${COLUMNS.join(' | ')} |`);
  lines.push(`|${COLUMNS.map(() => '---').join('|')}|`);
  items.forEach((it, i) => {
    // เลขลำดับมาจากตำแหน่งจริงเสมอ ไม่ใช่ค่า n ที่ส่งเข้ามา — พอ UI ลบข้อกลางทิ้ง
    // ลำดับต้องไล่ใหม่ ไม่ใช่ค้างเป็น 1,3,4
    const cells = [
      String(i + 1),
      escCell(it.title),
      oneOf(BY, it.by, 'qa'),
      oneOf(RESULT, it.result, '–'),
      oneOf(CAUSE, it.cause, ''),
      escCell(it.date),
      escCell(it.system),
      escCell(it.test),
      escCell(it.run),
      escCell(it.note),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  });
  lines.push('', NOTES_HEADING, '');
  const notes = String((sheet && sheet.notes) || '');
  if (notes) lines.push(notes);
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

// คืน null เมื่อไฟล์ไม่ใช่ใบเทส (ไม่มี frontmatter) — ตัวเรียกใช้กรองทิ้งเอง ไม่ต้อง try/catch
function parseQtest(text) {
  const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!fm) return null;
  const meta = {};
  for (const line of fm[1].split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (m) meta[m[1]] = loadValue(m[2]);
  }
  const body = src.slice(fm[0].length);
  // สแกนหาตารางเฉพาะส่วนก่อน "บันทึกเพิ่มเติม" — โน้ตเป็นข้อความอิสระ ใครแปะตาราง markdown
  // ลงไปได้ ถ้าสแกนทั้งไฟล์ตารางในโน้ตจะกลายเป็นข้อทดสอบ
  const notesAt = body.indexOf(NOTES_HEADING);
  const table = notesAt === -1 ? body : body.slice(0, notesAt);
  const notes = notesAt === -1 ? '' : body.slice(notesAt + NOTES_HEADING.length).trim();

  const items = [];
  let cols = null;   // ชื่อคอลัมน์ → ตำแหน่ง มาจากแถวหัวตารางจริงในไฟล์
  let n = 0;
  for (const line of table.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const cells = splitRow(t).map(c => c.trim());
    if (cells[0] === COLUMNS[0]) {                         // แถวหัวตาราง
      cols = {};
      cells.forEach((c, i) => { if (c) cols[c] = i; });
      continue;
    }
    if (/^:?-{3,}:?$/.test(cells[0])) continue;            // แถวคั่น
    // ไม่มีหัวตาราง (ถูกลบทิ้ง/เขียนมือ) — เดาจากจำนวนช่องแทนที่จะทิ้งข้อมูลทั้งใบ
    const layout = cols || byPosition(cells.length === LEGACY_COLUMNS.length ? LEGACY_COLUMNS : COLUMNS);
    const at = name => (layout[name] == null ? '' : unescCell(cells[layout[name]]));
    if (cells.length < 2) continue;
    n += 1;
    items.push({
      n,
      title: at('สิ่งที่ต้องทดสอบ'),
      by: oneOf(BY, at('ทำโดย'), 'qa'),
      result: oneOf(RESULT, at('ผล'), '–'),
      cause: oneOf(CAUSE, at('สาเหตุ'), ''),
      date: at('วันที่'),
      system: at('ระบบ'),
      test: at('เทส'),
      run: at('run'),
      note: at('หมายเหตุ'),
    });
  }
  return { meta, items, notes };
}

// ---- สรุปผลกลับไป Redmine ----
// ข้อความที่ปุ่ม ✅/❌ จะเขียนลง field "Test Results" ของ issue — คนอ่านคือ dev ที่รับงานต่อ
// และผู้ตรวจย้อนหลัง ไม่ใช่โปรแกรม จึงเขียนเป็นข้อความล้วน ไม่ใช่ตาราง markdown: Redmine
// เรนเดอร์ field นี้ด้วย textile ซึ่งไม่รู้จักตาราง markdown แล้วจะได้ท่อ | เต็มหน้าจอ
// ป้ายผลใช้ [PASS]/[FAIL] แทนสัญลักษณ์ ✓/✗ เพราะ field นี้ถูกก๊อปไปวางในอีเมล/แชตบ่อย
const OUTCOMES = {
  success: { word: 'ผ่าน', status: 'Resolved' },
  fail: { word: 'ไม่ผ่าน', status: 'In Progress' },
};
// ป้ายของข้อหนึ่ง — "ข้าม" มาก่อนผล เพราะข้อที่ข้ามไม่ได้ถูกทดสอบ ผลที่ค้างอยู่ (ถ้ามี)
// ไม่มีความหมายแล้ว ส่วนข้อที่ยังไม่ติ๊กต้องพูดออกมาตรง ๆ ไม่ใช่หายไปเฉย ๆ จากสรุป
// ป้ายผลที่ dev จะเห็นใน Redmine — ข้อที่ fail เพราะสคริปเทสเองพังต้องไม่ถูกอ่านว่าระบบพัง
// ไม่งั้น dev จะไปไล่หาบั๊กที่ไม่มีอยู่ · fail ที่ QA ยังไม่ได้ตรวจก็ต้องไม่ถูกเหมาว่าเป็นบั๊กเช่นกัน
const CAUSE_LABEL = { 'แอป': '[FAIL·บั๊กระบบ]', 'สคริป': '[FAIL·สคริปเทสเอง]' };
function itemLabel(it) {
  if (!it || it.by === 'ข้าม') return '[ข้าม]';
  if (it.result === 'pass') return '[PASS]';
  if (it.result === 'fail') return CAUSE_LABEL[it.cause] || '[FAIL]';
  return '[ยังไม่ทดสอบ]';
}
function itemLine(it, i) {
  const bits = [];
  if (it.date) bits.push(it.date);
  if (it.by === 'auto') {
    bits.push(['auto', it.system, it.run ? 'run ' + it.run : ''].filter(Boolean).join(' · '));
  }
  const tail = bits.length ? ` — ${bits.join(' · ')}` : '';
  const head = `${i + 1}. ${itemLabel(it)} ${it.title || '(ไม่มีหัวข้อ)'}${tail}`;
  // หมายเหตุคือที่ที่ QA เขียนว่าพังยังไง — ส่วนที่มีค่าที่สุดของใบ ต้องติดไปด้วยเสมอ
  return it.note ? `${head}\n   หมายเหตุ: ${it.note}` : head;
}

// tally รับมาจากข้างนอก (progressOf ใน tab-testingroom.js) ไม่นับเองซ้ำ — กฎว่าข้อที่ "ข้าม"
// ไม่นับเป็นงานค้างมีที่เดียว ถ้าโมดูลนี้นับเองจะกลายเป็นสองสูตรที่เพี้ยนจากกันได้เงียบ ๆ
function formatTestResults(sheet, tally, outcome, today) {
  const meta = (sheet && sheet.meta) || {};
  const items = (sheet && Array.isArray(sheet.items)) ? sheet.items : [];
  const t = tally || { pass: 0, fail: 0, skipped: 0, todo: 0, total: items.length };
  const o = OUTCOMES[outcome] || OUTCOMES.fail;
  // แยก "ไม่ผ่านเพราะสคริปเทสเอง" ออกมาตั้งแต่บรรทัดสรุป — คนอ่านผ่าน ๆ เห็นแค่ตัวเลขบรรทัดนี้
  const counts = [`ผ่าน ${t.pass}`,
    `ไม่ผ่าน ${t.fail}${t.scriptFail ? ` (สคริปเทสเอง ${t.scriptFail})` : ''}`,
    `ข้าม ${t.skipped}`];
  if (t.todo) counts.push(`ยังไม่ทดสอบ ${t.todo}`);
  const lines = [
    `ผลทดสอบรอบที่ ${meta.round || 1} — สรุป: ${o.word}${today ? ' (' + today + ')' : ''}`,
    `${counts.join(' · ')} (ทั้งหมด ${t.total} ข้อ)`,
    '',
  ];
  if (items.length) lines.push(...items.map(itemLine));
  else lines.push('(ใบเทสนี้ไม่มีข้อทดสอบ)');
  const notes = String((sheet && sheet.notes) || '').trim();
  if (notes) lines.push('', 'บันทึกเพิ่มเติม:', notes);
  // ชื่อไฟล์ใบเทสท้ายสุด — คนอ่านย้อนหลังจะได้รู้ว่าสรุปนี้มาจากใบไหนในเครื่อง QA
  if (sheet && sheet.file) lines.push('', `(จากใบเทส ${sheet.file})`);
  return lines.join('\n');
}

// ต่อท้ายของเดิมเสมอ ไม่ทับ (ตัดสินใจ 2026-08-07) — งานหนึ่งใบเทสหลายรอบ ประวัติการเทส
// ทุกรอบต้องสะสมอยู่ใน field เดียวกัน ไม่ใช่รอบล่าสุดลบรอบก่อนหน้าทิ้ง
// เส้นคั่นช่วยให้ยังแยกออกว่าอันไหนรอบไหนตอนอ่านย้อน
function mergeTestResults(existing, block) {
  const old = String(existing == null ? '' : existing).replace(/\s+$/, '');
  return old ? `${old}\n\n---\n\n${block}` : String(block == null ? '' : block);
}

// ---- ชุดเทสระบบ ----
// ใบเทสรูปแบบเดียวกันเป๊ะ ต่างกันแค่ไม่มีเลข issue — เพราะใบเทสคือใบสั่งรันอยู่แล้ว
// (ตัดสินใจเฟส 4) ชุด regression ที่ไม่ผูกกับงานไหนจึงเป็นแค่ใบที่ไม่มีเจ้าของ ▶ Run all
// กับ ⤓ ดึงผล ใช้ได้เหมือนกันหมด ที่ใช้ไม่ได้มีอย่างเดียวคือ ✅/❌ จบงาน (ไม่มีงานให้ส่งกลับ)
//
// ไม่มี "รอบ" ด้วย — ชุดระบบเป็นของถาวรที่กลับมารันซ้ำ ประวัติการรันอยู่ในโฟลเดอร์ผลรันแล้ว
// การแตกใบใหม่ทุกครั้งที่รันจะกลายเป็นขยะที่ต้องมาไล่ลบเอง
// (isSystemSheet / sheetTitle อยู่ฝั่ง renderer ใน tab-testingroom.js — เป็นเรื่องของการแสดงผล
//  และ renderer require ไฟล์นี้ไม่ได้เพราะมันใช้ fs · ที่นี่เก็บเฉพาะส่วนที่เขียนไฟล์)
//
// ชื่อที่ผู้ใช้ตั้งเป็นภาษาไทยได้ ตัดเฉพาะอักขระที่ Windows ห้ามในชื่อไฟล์
function systemSlug(name) {
  const s = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|]/g, '')    // อักขระที่ Windows ห้ามในชื่อไฟล์ (ภาษาไทยใช้ได้ปกติ)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');          // Windows ตัด . กับช่องว่างท้ายชื่อทิ้งเงียบ ๆ อยู่แล้ว
  return s || 'ชุดระบบ';
}
// ขึ้นต้นด้วย system- เพื่อให้เรียงมาก่อนใบที่ขึ้นต้นด้วยปี (listQtests เรียงชื่อจากมากไปน้อย)
function nextSystemName(existing, name) {
  const files = Array.isArray(existing) ? existing : [];
  const base = 'system-' + systemSlug(name);
  let out = base + '.md';
  for (let i = 2; files.includes(out); i++) out = `${base}-${i}.md`;
  return out;
}
// ข้อ auto ที่ผูกไฟล์ไว้แล้วในใบหนึ่ง → ข้อตั้งต้นของชุดระบบ
// ล้างผล/สาเหตุ/วันที่/เลข run ทิ้งทั้งหมด — ชุดที่เพิ่งสร้างยังไม่เคยรัน การยกผลเก่ามาด้วย
// เท่ากับโกหกว่าชุดนี้เคยผ่านแล้ว ส่วน "ระบบ/เทส" เป็นการตั้งค่า ต้องติดมา
function systemItemsFrom(items) {
  return (Array.isArray(items) ? items : [])
    .filter(it => it && it.by === 'auto' && it.test)
    .map(it => ({
      title: it.title || '', by: 'auto', result: '–', cause: '', date: '',
      system: it.system || '', test: it.test, run: '', note: '',
    }));
}

// ---- ชื่อไฟล์ / รอบ ----
function stamp(receivedAt) { return String(receivedAt || '').replace(/-/g, '').slice(0, 8); }
function qtestFilename(receivedAt, issue) { return `${stamp(receivedAt)}-${issue}.md`; }

// รอบ = จำนวนใบของ issue นี้ที่มีอยู่แล้ว +1 (นับข้ามวันด้วย ไม่ใช่นับเฉพาะวันนี้)
// regex ปิดท้ายด้วย (-\d+)?\.md เพื่อไม่ให้ issue 6901 ถูกนับเป็นรอบของ 690
function nextQtestName(dir, receivedAt, issue) {
  let existing = [];
  try { existing = fs.readdirSync(dir); } catch {}
  const mine = new RegExp(`^\\d{8}-${issue}(-\\d+)?\\.md$`);
  const round = existing.filter(f => mine.test(f)).length + 1;
  const base = stamp(receivedAt) + '-' + issue;
  let name = base + '.md';
  for (let i = 2; existing.includes(name); i++) name = `${base}-${i}.md`;
  return { name, round };
}

// ใบทั้งหมดในโฟลเดอร์ ใหม่สุดก่อน (ชื่อไฟล์ขึ้นต้นด้วยวันที่ จึงเรียงตามชื่อได้ตรง ๆ)
// โฟลเดอร์ที่ยังไม่มี/อ่านไม่ได้ = ยังไม่มีใบ ไม่ใช่ error — Testing Room เพิ่งเริ่มใช้ก็เจอเคสนี้
function listQtests(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md')); } catch { return []; }
  return files.sort((a, b) => b.localeCompare(a)).map(f => {
    let sheet = null;
    try { sheet = parseQtest(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
    return sheet ? { file: f, path: path.join(dir, f), ...sheet } : null;
  }).filter(Boolean);
}

// ใบล่าสุดของ issue หนึ่ง — เรียงตาม round ก่อน ไม่ใช่ชื่อไฟล์: localeCompare ตัดสิน
// "20260806-690-2.md" กับ "20260806-690.md" ตามกฎภาษา ซึ่งชั่งน้ำหนัก - กับ . ไม่แน่นอน
// round มาจาก frontmatter ที่ปุ่ม 🧪 เขียนไว้ เป็นตัวเลขที่ตั้งใจให้เรียงอยู่แล้ว
function latestQtestFor(sheets, issue) {
  return (Array.isArray(sheets) ? sheets : [])
    .filter(s => s && s.meta && String(s.meta.issue) === String(issue))
    .sort((a, b) => (Number(b.meta.round) || 1) - (Number(a.meta.round) || 1)
      || String(b.file || '').localeCompare(String(a.file || '')))[0] || null;
}

// ดัชนีย้อนกลับ run → เลข issue ที่อ้างถึงรอบรันนั้น
//
// ใบเทสเก็บคอลัมน์ run รายข้ออยู่แล้ว คำถาม "ผลรันรอบนี้ถูกใช้ตอบงานไหน" จึงตอบได้จากใบเทส
// ล้วน ๆ ไม่ต้องเขียนอะไรลงในโฟลเดอร์ผลรัน และไม่ต้องให้ตัวรันรู้จักเลข issue (มันไม่รู้ และ
// รอบที่รันจากเมนูเองก็ไม่มีเลขให้อยู่ดี) — เหตุผลเดียวกับที่ไม่เปลี่ยนชื่อโฟลเดอร์ผลรัน
// เป็น yyyymmdd-issue (ตัดสินใจ 2026-08-07)
//
// รอบเดียวถูกอ้างได้หลายงาน (ชุด regression ที่ใช้ตอบหลาย issue) จึงเป็น array ไม่ใช่ค่าเดียว
// เรียงเลขน้อยไปมากเพื่อให้ป้ายบนหน้าจอไม่สลับที่ไปมาทุกครั้งที่โหลดใหม่
function issuesByRun(sheets) {
  const out = {};
  for (const s of (Array.isArray(sheets) ? sheets : [])) {
    const issue = s && s.meta && s.meta.issue;
    if (issue == null || issue === '') continue;
    for (const it of (s.items || [])) {
      const run = it && String(it.run || '').trim();
      if (!run) continue;
      if (!out[run]) out[run] = [];
      if (!out[run].includes(issue)) out[run].push(issue);
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
  return out;
}

module.exports = {
  BY, RESULT, CAUSE, OUTCOMES, parseQtest, serializeQtest, qtestFilename, nextQtestName, listQtests, issuesByRun,
  systemSlug, nextSystemName, systemItemsFrom,
  formatTestResults, mergeTestResults, latestQtestFor,
};
