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
    if (!line) return;
    if (line.startsWith('#')) {
      lastContent = ln;
      return;
    }
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
    lastContent = ln;
    lastEntry = ln;
  });
  closeSection();

  return { eol, lines, sections, insertAfter, duplicates };
}

// ต่อคำผิดใหม่ท้ายบรรทัดเดิม โดยไม่ไปอยู่หลัง inline comment
// (`A: b  # หมายเหตุ` + ['c'] -> `A: b, c  # หมายเหตุ`)
function appendForms(raw, forms) {
  const m = /^(.*?)(\s+#.*)$/.exec(raw);
  const body = m ? m[1] : raw;
  const comment = m ? m[2] : '';
  return body.replace(/\s+$/, '') + ', ' + forms.join(', ') + comment;
}

function planWrite(text, entries, meta) {
  const g = parseGlossary(text);
  const out = {
    added: [], merged: [], skipped: [], warnings: [], conflicts: [],
    deadLines: g.duplicates, newText: null,
  };
  const edits = new Map();          // 1-based line -> ข้อความใหม่ของบรรทัดนั้น
  const inserts = new Map();        // 1-based line -> บรรทัดที่จะแทรก "ต่อจาก" บรรทัดนั้น
  const headerDone = new Set();     // เขียน header ครั้งเดียวต่อ section ต่อการกดหนึ่งครั้ง

  // รวม entries ที่ section+term เดียวกันเป็นกลุ่มเดียวก่อนวางแผน -- ถ้าปล่อยให้แต่ละแถว
  // เดินลอจิกแยกกัน สอง entries คำใหม่คำเดียวกันจะแทรกสองบรรทัด หรือสอง entries เติมคำเดิม
  // จะเติมฟอร์มเดียวกันซ้ำสองครั้ง กลายเป็นของตายแบบเดียวกับที่ฟีเจอร์นี้เกิดมาเพื่อป้องกัน
  // union forms แบบ first-seen ตัดตัวซ้ำในกลุ่มออกไปในตัว
  //
  // คีย์ต้องเป็นเช่นนั้นไม่ได้ -- ถ้าต่อ section และ term ด้วยอักขระพิเศษตัวเดียว
  // (เช่น space) สองคู่ที่ต่างกันจะสามารถได้คีย์เดียวกันได้ เช่น
  // ("exact", "Foo Bar") ก็ได้ key "exact Foo Bar"
  // ("exact Foo", "Bar") ก็ได้ key "exact Foo Bar" ด้วย
  // ต่อ JSON.stringify([section, term]) เพราะมันหลีกไม่ได้ -- ไม่มีทางสร้าง
  // สองคู่ (s1, t1) และ (s2, t2) ที่ต่างกันแต่ให้ stringify เดียวกัน
  const groups = new Map();
  const order = [];
  for (const entry of entries || []) {
    const section = entry && entry.section;
    const term = String((entry && entry.term) || '').trim();
    const key = JSON.stringify([section, term]);
    let group = groups.get(key);
    if (!group) {
      group = { section, term, forms: [] };
      groups.set(key, group);
      order.push(group);
    }
    for (const raw of (entry && entry.forms) || []) {
      const form = String(raw).trim();
      if (!form || group.forms.includes(form)) continue;
      group.forms.push(form);
    }
  }

  for (const { section, term, forms } of order) {
    if (!term) {
      out.skipped.push({ term, forms, section, reason: 'ชื่อคำว่างเปล่า' });
      continue;
    }
    const bucket = g.sections[section];
    if (!bucket) {
      // glossary.md เขียนมือ ไม่การันตีว่ามีครบ 4 section เสมอ -- ถ้า section ที่ผู้ใช้เลือก
      // ไม่อยู่ในไฟล์จริง ต้องรายงานเป็น skipped เสมอ ห้ามหายเงียบ ๆ ไม่งั้น UI จะบอกว่าสำเร็จ
      // ทั้งที่ไม่ได้เขียนอะไรลงไฟล์เลย
      out.skipped.push({ term, forms, section, reason: `ไม่พบ section ${section} ในไฟล์` });
      continue;
    }

    const existing = bucket[term];
    const have = new Set(existing ? existing.forms : []);
    const fresh = [];
    for (const form of forms) {
      if (have.has(form) || fresh.includes(form)) continue;
      fresh.push(form);
    }
    if (!fresh.length) {
      out.skipped.push({ term, forms, section, reason: 'มีอยู่แล้วทั้งหมด' });
      continue;
    }

    if (existing) {
      // เข้าบรรทัดสุดท้ายของคำถูกนั้นเสมอ -- parseGlossary เก็บตัวสุดท้ายไว้ให้แล้ว
      // เติมบรรทัดแรกจะได้ไฟล์ที่ดูถูกแต่ไม่มีผลตอนรัน
      const line = existing.line;
      const base = edits.has(line) ? edits.get(line) : g.lines[line - 1];
      edits.set(line, appendForms(base, fresh));
      out.merged.push({ term, forms: fresh, section, line });
    } else {
      // bucket มีอยู่แปลว่า section นี้ถูกพบในไฟล์แน่นอน closeSection() ของ parseGlossary
      // เซ็ต insertAfter[section] ให้เสมอตอนปิด section ที่เป็น MAPPING_SECTIONS จึง anchor
      // ไม่มีทางเป็น null/undefined ตรงนี้ -- ไม่ต้อง guard ซ้ำ
      const anchor = g.insertAfter[section];
      const block = inserts.get(anchor) || [];
      if (!headerDone.has(section)) {
        headerDone.add(section);
        block.push('', `# --- จาก ${meta && meta.title} (${meta && meta.date}) ---`);
      }
      block.push(`${term}: ${fresh.join(', ')}`);
      inserts.set(anchor, block);
      out.added.push({ term, forms: fresh, section });
    }
  }

  if (!edits.size && !inserts.size) return out;

  // ประกอบใหม่ทีเดียวจากบนลงล่าง เลขบรรทัดจึงไม่เลื่อนระหว่างทาง
  const result = [];
  g.lines.forEach((raw, i) => {
    const ln = i + 1;
    result.push(edits.has(ln) ? edits.get(ln) : raw);
    if (inserts.has(ln)) result.push(...inserts.get(ln));
  });
  out.newText = result.join(g.eol);
  return out;
}

module.exports = { parseGlossary, planWrite, MAPPING_SECTIONS };
