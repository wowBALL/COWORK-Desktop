// วางแผนการเขียนคำกลับเข้า glossary.md ของ meeting-notes -- บริสุทธิ์ล้วน รับ string คืน object
// ไม่แตะ fs ไม่ใช้ Electron จึงรันด้วย `node --test` ได้ตรง ๆ เหมือน meetings.js
//
// ทำไมต้องมีโมดูลนี้แทนที่จะ append บรรทัดท้ายไฟล์เฉย ๆ:
// src/glossary.py:323 ของ meeting-notes เขียนว่า buckets[section][correct] = parsed
// ซึ่งเป็น assignment ไม่ใช่ merge -- คีย์ซ้ำใน section เดียวกันจึงทับกันเงียบ ๆ
// (ตอนเขียนโมดูลนี้ ไฟล์จริงมีของตายแบบนี้อยู่ 3 บรรทัด) การ "เพิ่มคำ" ด้วยการ append
// จึงเป็นการฆ่าคำที่ทำงานอยู่ ต้องรวมเข้าบรรทัดเดิมเท่านั้น
'use strict';

// ต้องตรงกับ _SECTION_RE และ _MAPPING_SECTIONS ฝั่ง Python เป๊ะ ๆ
const SECTION_RE = /^##\s+([\w-]+)\s*$/;
const MAPPING_SECTIONS = ['exact', 'fuzzy', 'project-names', 'aliases'];
// ต้องมีช่องว่างนำหน้า # ถึงนับเป็น comment -- `C#` กับ `F#` เป็นชื่อภาษาจริง
const INLINE_COMMENT_RE = /\s+#.*$/;

// `*` `[` `]` เป็นอักขระที่ประกอบหัว segment ของ transcript เช่น `**ผู้พูด 1** [00:00]:`
// ตรงกับ _has_markup ใน meeting-notes/src/glossary.py:258
function hasMarkup(term) {
  return ['*', '[', ']'].some(char => term.includes(char));
}

function parseGlossary(text) {
  const src = String(text || '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const sections = {};
  const insertAfter = {};
  const duplicates = [];
  let section = null;
  let lastEntry = null;    // บรรทัด entry สุดท้ายของ section ปัจจุบัน (1-based)
  let lastContent = null;  // บรรทัดที่มีตัวอักษรสุดท้าย เผื่อ section ไม่มี entry เลย

  const closeSection = () => {
    if (section && MAPPING_SECTIONS.includes(section)) {
      insertAfter[section] = lastEntry !== null ? lastEntry : lastContent;
    }
  };

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.trim();
    const head = SECTION_RE.exec(line);
    if (head) {
      closeSection();
      section = head[1];
      if (MAPPING_SECTIONS.includes(section)) sections[section] = {};
      lastEntry = null;
      lastContent = ln;
      return;
    }
    if (!section) return;
    if (line) lastContent = ln;
    if (!line || line.startsWith('#')) return;
    if (!MAPPING_SECTIONS.includes(section)) return;

    const body = line.replace(INLINE_COMMENT_RE, '').trim();
    const at = body.indexOf(':');
    if (at === -1) return;
    const term = body.slice(0, at).trim();
    const forms = body.slice(at + 1).split(',').map(s => s.trim()).filter(Boolean);
    if (!term || !forms.length) return;

    // ข้ามเรคคอร์ดที่มี * [ ] เพราะอักขระเหล่านี้ประกอบหัว segment ของ transcript
    // ถ้า glossary มีคำเหล่านี้ คำนั้นจะทำให้ transcript parse ไม่ออก (ตรงกับ Python)
    const unsafe = [term, ...forms].filter(hasMarkup);
    if (unsafe.length > 0) return;

    // ตัวหลังทับตัวหน้าเหมือน Python -- ตัวหน้าจึงเป็น "บรรทัดตาย" ที่ต้องรายงาน
    const prev = sections[section][term];
    if (prev) duplicates.push({ section, term, line: prev.line, shadowedBy: ln });
    sections[section][term] = { forms, line: ln };
    lastEntry = ln;
  });
  closeSection();

  return { eol, lines, sections, insertAfter, duplicates };
}

module.exports = { parseGlossary, MAPPING_SECTIONS };
