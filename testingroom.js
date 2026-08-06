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
const COLUMNS = ['#', 'สิ่งที่ต้องทดสอบ', 'ทำโดย', 'ผล', 'run', 'หมายเหตุ'];
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
  const items = [];
  let n = 0;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const cells = splitRow(t).map(c => c.trim());
    if (cells.length < COLUMNS.length) continue;
    if (cells[0] === COLUMNS[0]) continue;                 // แถวหัวตาราง
    if (/^:?-{3,}:?$/.test(cells[0])) continue;            // แถวคั่น
    n += 1;
    items.push({
      n,
      title: unescCell(cells[1]),
      by: oneOf(BY, cells[2], 'qa'),
      result: oneOf(RESULT, cells[3], '–'),
      run: unescCell(cells[4]),
      note: unescCell(cells[5]),
    });
  }
  const at = body.indexOf(NOTES_HEADING);
  const notes = at === -1 ? '' : body.slice(at + NOTES_HEADING.length).trim();
  return { meta, items, notes };
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

module.exports = {
  BY, RESULT, parseQtest, serializeQtest, qtestFilename, nextQtestName, listQtests,
};
