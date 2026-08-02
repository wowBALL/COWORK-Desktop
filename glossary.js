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

// Critical 1: term/form เป็น free text จาก UI แต่ไฟล์มีไวยากรณ์ของตัวเอง
// (`term: form1, form2  # comment`) -- ถ้าค่าที่ส่งมามีอักขระที่ไฟล์ใช้เป็นตัวแบ่งปนอยู่
// มันจะไม่รอด round-trip กลับผ่าน parseGlossary เงียบ ๆ:
//   `:` ตัวแรกในบรรทัดถูกตีเป็นตัวแบ่ง term/forms -- ส่วนที่เหลือของ term เดิมเลื่อนไปกลาย
//       เป็นส่วนหนึ่งของ forms แทน (เคส "Ingress: nginx" ในรีวิว)
//   `,` ถูกตีเป็นตัวแบ่งฟอร์ม -- ฟอร์มเดียวที่มี , ปนกลายเป็นหลายฟอร์ม หรือฟอร์มที่ขึ้นต้น/
//       ลงท้ายด้วย , ทำให้เกิด token ว่างที่ split(',').map(trim).filter(Boolean) กลืนทิ้งเงียบ ๆ
//   " #" (เว้นวรรคตามด้วย #) เปิด inline comment กลืนส่วนที่เหลือของบรรทัดทันที (เคส
//       "C # sharp" ในรีวิว) -- ต้องมีช่องว่างนำหน้าเหมือน INLINE_COMMENT_RE ไม่งั้น C#/F# ใช้ไม่ได้
//   \n หรือ \r แทรกบรรทัดใหม่เข้ากลางไฟล์ตรง ๆ -- ช่องกรอกคำถูก/คำผิดเป็น <input> ปกติพิมพ์
//       ผ่านคีย์บอร์ดไม่ได้ แต่วางจากคลิปบอร์ดหลายบรรทัดได้
// ตรวจคู่กับ hasMarkup เสมอ (ไม่ใช่กลไกคู่ขนานที่สอง) ด้วยเหตุผลเดียวกันทุกประการ: กัน entry
// จาก UI ทำลาย entry อื่นที่มีอยู่แล้วในไฟล์แบบเงียบ ๆ แล้วรายงานว่าสำเร็จ
// คืนอักขระที่เจอ (สำหรับใส่ในข้อความ error) หรือ null เมื่อปลอดภัย
function findUnsafeChar(s) {
  const str = String(s || '');
  if (str.includes(':')) return ':';
  if (str.includes(',')) return ',';
  if (/[\r\n]/.test(str)) return '\\n';
  if (/\s#/.test(str)) return ' #';
  return null;
}
function hasUnsafeChars(s) {
  return findUnsafeChar(s) !== null;
}

function parseGlossary(text) {
  const src = String(text || '');
  // Minor 9 (ข้อจำกัดที่รู้อยู่แล้ว): ตรวจ EOL ครั้งเดียวสำหรับทั้งไฟล์ -- ไฟล์ที่ผสม LF/CRLF ปนกัน
  // จะถูก normalise ทั้งไฟล์เป็น EOL เดียว ทำลายการรับประกัน "เฉพาะบรรทัดที่แก้เท่านั้นที่ต่าง"
  // ไม่ทำอะไรเพิ่มโดยเจตนา: glossary.md จริงเป็น LF ล้วน และไฟล์ผสม EOL ก็พังกับ splitlines()
  // ฝั่ง Python (_read_lines) อยู่แล้วตั้งแต่ต้น ไม่ใช่ข้อจำกัดใหม่ที่โมดูลนี้เพิ่มเข้ามา
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
      // Important 2: header ซ้ำ (สอง `## exact` ในไฟล์เดียวกัน) ต้องรวมเข้าบัคเก็ตเดิม ไม่ใช่
      // ล้างทิ้ง -- ของเดิม `sections[section] = {}` รีเซ็ตทุกครั้งที่เจอ header ชื่อนี้ ทำให้
      // เทอมของบล็อกแรกมองไม่เห็นจากตรงนี้ไปเลย: rule 1/2 ของ planWrite จะมองไม่เห็นคำถูกที่
      // ตายไปแล้ว แล้ว planWrite จะ "เพิ่ม" บรรทัดใหม่ทับคำเดิมที่ยังใช้งานอยู่จริง (ตรงกับบั๊ก
      // append-kills-a-live-entry ที่โมดูลนี้เกิดมาเพื่อป้องกัน) ต้องรวม ไม่ใช่ทับ ให้ตรงกับ
      // _parse_glossary_file ฝั่ง Python ที่ buckets[section] ชี้ dict เดียวตลอดทั้งไฟล์อยู่แล้ว
      if (MAPPING_SECTIONS.includes(section)) sections[section] = sections[section] || {};
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

// ชั้นที่ apply_exact แทนที่จริง -- fuzzy/project-names ไม่อยู่ในนี้โดยเจตนา
// สองชั้นนั้นโมเดลเป็นคนตีความตามบริบท คำที่มีความหมายของตัวเองจึงปลอดภัยเมื่ออยู่ที่นั่น
// (นั่นคือเหตุผลทั้งหมดที่ชั้นนั้นมีอยู่) การเตือนเรื่องมันจึงเป็นการเตือนผิดที่
const REPLACING_SECTIONS = ['exact', 'aliases'];
const MIN_SAFE_LENGTH = 4;

// กฎข้อ 1 (คำผิดกินคำถูก) ต้องเทียบกับคำถูกจาก "ทุก" section ไม่ใช่แค่ exact/aliases --
// tools/check_glossary.py (all_correct, ~บรรทัด 63-70) รวม fuzzy และ project-names เข้ามา
// ด้วยเจตนาชัดเจน: คำถูกใน fuzzy ก็เป็นคำที่คนพูดออกมาถูกได้เหมือนกัน ถ้าคำผิดของ exact
// ไปกินมัน ความเสียหายก็เท่ากับกินคำถูกใน exact เอง
//
// กฎข้อ 2 (formOwner) ยังคง exact+aliases เท่านั้นโดยเจตนา -- ตรงกับ _replacing_layers
// ฝั่ง Python ที่ไม่รวม fuzzy/project-names เพราะสองชั้นนั้นโมเดลตีความเอง (ดูคอมเมนต์
// REPLACING_SECTIONS ด้านบน) ห้ามขยายฝั่งนี้ตามฝั่ง correctTerms
function replacingLayer(g) {
  const correctTerms = [];
  for (const name of MAPPING_SECTIONS) {
    for (const term of Object.keys(g.sections[name] || {})) correctTerms.push(term);
  }
  const formOwner = new Map();
  for (const name of REPLACING_SECTIONS) {
    for (const [term, e] of Object.entries(g.sections[name] || {})) {
      for (const f of e.forms) formOwner.set(f, term);
    }
  }
  return { correctTerms, formOwner };
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

  // ข้อ 5 (Minor): g ไม่เปลี่ยนระหว่าง entries ในคอลนี้ -- สร้าง layer จากไฟล์แค่ครั้งเดียว
  // แล้ว "ขยาย" มันด้วยสิ่งที่กำลังจะเขียนในคอลเดียวกันนี้เอง (ข้อ Critical 1 และ Important 3):
  //  - correctTerms: เติมคำถูกของ "ทุกกลุ่ม" ในคอลนี้ล่วงหน้าก่อนวนลูป เพราะคำที่กำลังจะถูก
  //    เขียน (รวมทั้งคำของกลุ่มตัวเอง) ต้องได้รับการป้องกันเหมือนคำถูกที่มีอยู่แล้วในไฟล์อยู่
  //    ก่อน -- ถ้าไม่มีขั้นนี้ คำใหม่ที่ยังไม่เคยอยู่ใน glossary.md จะไม่ถูกป้องกันเลยระหว่าง
  //    กำลังเขียนมันเข้าไปครั้งแรก (Critical 1: `Approve` + form `Approv` ต้องชนแม้ `Approve`
  //    ยังไม่มีในไฟล์)
  //  - formOwner: อัพเดต "ระหว่าง" วนลูป ไม่ใช่ล่วงหน้า เพราะ "ฟอร์มที่ถูกรับไปแล้วก่อนหน้า
  //    ในคอลนี้" มีความหมายเป็นลำดับ (Important 3) -- กลุ่มหลังต้องเห็นสิ่งที่กลุ่มก่อนหน้า
  //    เพิ่งรับไปเท่านั้น ไม่ใช่เห็นล่วงหน้าทุกกลุ่มเหมือน correctTerms
  const layer = replacingLayer(g);
  for (const grp of order) {
    const t = String((grp && grp.term) || '').trim();
    if (t && !layer.correctTerms.includes(t)) layer.correctTerms.push(t);
  }

  for (const { section, term, forms } of order) {
    if (!term) {
      out.skipped.push({ term, forms, section, reason: 'ชื่อคำว่างเปล่า' });
      continue;
    }

    // คำถูกเองมี * [ ] -- อักขระเหล่านี้ประกอบหัว segment ของ transcript เช่น
    // `**ผู้พูด 1** [00:00]:` -- _parse_glossary_file ฝั่ง Python (src/glossary.py) ทิ้งทั้ง
    // บรรทัดเงียบ ๆ เมื่อเจออักขระเหล่านี้ ไม่ว่าจะอยู่ section ไหน (ไม่ได้แยกชั้นเหมือน
    // REPLACING_SECTIONS ด้านบน) เขียนแล้วฟอร์มอื่นที่ถูกต้องในบรรทัดเดียวกันจะตายไปด้วย
    // parseGlossary ฝั่ง read กันคำเหล่านี้ไว้แล้ว (hasMarkup) นี่คือฝั่ง write
    //
    // Critical 1: เช็คคู่กับ hasUnsafeChars ในบล็อกเดียวกัน -- คำถูกที่มี `:` `,` " #" หรือ
    // \n ปนก็ทำลาย round-trip ผ่านไวยากรณ์ของไฟล์เองเหมือนกับ * [ ] ทุกประการ (ดูคอมเมนต์
    // findUnsafeChar ด้านบน) ต้องบล็อกทุก section เหมือนกัน ไม่ใช่แค่ guarded
    const termMarkup = hasMarkup(term);
    const termBadChar = termMarkup ? null : findUnsafeChar(term);
    if (termMarkup || termBadChar) {
      const reason = termMarkup
        ? `คำถูก "${term}" มีอักขระ * [ ] ซึ่งเป็นหัว segment ของ transcript -- ` +
          'Python parser จะทิ้งทั้งบรรทัดนี้ตอนอ่าน ฟอร์มอื่นที่ถูกต้องในบรรทัดเดียวกันจะหายไปด้วย'
        : `คำถูก "${term}" มีอักขระ "${termBadChar}" ซึ่งเป็นไวยากรณ์ของไฟล์เอง ` +
          '(`term: form1, form2  # comment`) -- เขียนแล้วอ่านกลับมาจะไม่เท่าเดิม บรรทัดนี้จะพังเงียบ ๆ';
      const list = forms.length ? forms : [undefined];
      for (const form of list) {
        out.conflicts.push({ term, form, section, clashesWith: null, reason });
      }
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
    const guarded = REPLACING_SECTIONS.includes(section);

    // Important 3 (กฎข้อ 1 ทิศตรงข้าม): กฎข้อ 1 เดิมตรวจแค่ "ฟอร์มใหม่กินคำถูกที่มีอยู่"
    // แต่ไม่เคยตรวจทิศตรงข้าม "คำถูกใหม่ถูกฟอร์มที่มีอยู่แล้วกิน" -- check_glossary.py
    // (find_collisions) วนคำผิด×คำถูกทุกคู่แบบไม่มีทิศทาง ไม่ใช่แค่ฟอร์มใหม่ vs คำถูกเดิม
    // เคส BMAD: BMAT ของจริง -- ส่งคำถูกใหม่ "BMATrix" เข้ามา "BMAT" (คำผิดของ BMAD) เป็น
    // substring ของมัน ทุกครั้งที่มีคนพูด "BMATrix" ถูกอยู่แล้ว exact.BMAD จะไปแก้ "BMAT" ที่
    // ซ่อนอยู่ข้างในให้เพี้ยนเป็น "BMADrix" -- ตรวจเฉพาะตอนคำนี้ "ใหม่" ต่อ section (ไม่ใช่
    // merge เข้าของเดิม) เพราะถ้ามันมีอยู่แล้วแปลว่ามันเคยผ่านจุดนี้ (หรือมีมาก่อนโมดูลนี้) แล้ว
    // ใช้ layer.formOwner ตัวเดียวกับกฎข้อ 2 โดยเจตนา (ไม่ใช่ correctTerms) -- คงความไม่สมมาตร
    // เดิมไว้: formOwner เป็น exact+aliases เท่านั้น ไม่ขยายตาม correctTerms ที่ครอบทุก section
    if (guarded && !existing) {
      const eatenBy = [...layer.formOwner].find(([f]) => f !== term && term.includes(f));
      if (eatenBy) {
        const [f, owner] = eatenBy;
        out.conflicts.push({ term, form: undefined, section, clashesWith: owner,
          reason: `คำถูก "${term}" มี "${f}" (คำผิดของ "${owner}") อยู่ข้างใน -- ทุกครั้งที่มีคน` +
            `พูด "${term}" ถูกอยู่แล้ว บางส่วนของมันจะถูกแก้ให้เพี้ยนเป็นส่วนหนึ่งของ "${owner}"` });
        continue;
      }
    }

    const fresh = [];
    // Important 4: ต้องแยกให้ออกว่า fresh ว่างเปล่าเพราะ "มีอยู่แล้วทั้งหมด" (ของจริง)
    // หรือเพราะ "ถูกปฏิเสธทั้งหมด" (ชนกฎ/มี markup) -- สองเหตุผลนี้ไม่เหมือนกัน ผู้ใช้ต้องรู้
    // ว่าเกิดอะไรขึ้นจริง ไม่ใช่โดนบอกว่า "มีอยู่แล้ว" ทั้งที่ไม่มี
    let anyRejected = false;
    for (const form of forms) {
      if (have.has(form) || fresh.includes(form)) continue;

      // ฟอร์มมี * [ ] -- เหตุผลเดียวกับคำถูกด้านบน แต่ตรวจแยกรายฟอร์ม เพราะฟอร์มอื่นในคำ
      // เดียวกันที่ไม่มีอักขระนี้ยังปลอดภัยและควรเขียนต่อได้ตามปกติ ใช้ทุก section เหมือนกัน
      // ไม่จำกัดแค่ guarded เพราะ Python parser ไม่แยกชั้นตอนเจอ markup
      //
      // Critical 1: เช็คคู่กับ hasUnsafeChars เหมือนฝั่งคำถูกด้านบน -- ฟอร์มที่มี `:` `,` " #"
      // หรือ \n ปนก็ไม่รอด round-trip ผ่านไวยากรณ์ของไฟล์เอง (เคส "C # sharp" ในรีวิว)
      const formMarkup = hasMarkup(form);
      const formBadChar = formMarkup ? null : findUnsafeChar(form);
      if (formMarkup || formBadChar) {
        const reason = formMarkup
          ? `"${form}" มีอักขระ * [ ] ซึ่งเป็นหัว segment ของ transcript -- ` +
            'Python parser จะทิ้งทั้งบรรทัดนี้ตอนอ่าน'
          : `"${form}" มีอักขระ "${formBadChar}" ซึ่งเป็นไวยากรณ์ของไฟล์เอง ` +
            '(`term: form1, form2  # comment`) -- เขียนแล้วอ่านกลับมาจะไม่เท่าเดิม';
        out.conflicts.push({ term, form, section, clashesWith: null, reason });
        anyRejected = true;
        continue;
      }

      if (guarded) {
        // 1. คำผิดที่กินคำถูก -- ทุกครั้งที่มีคนพูดถูก มันจะถูกแก้ให้เพี้ยน
        //    เทียบแบบเดียวกับ Python เป๊ะ ๆ: `wrong != target and wrong in target`
        //    ต้องกันเคส form === t (ฟอร์มเท่ากับคำถูกเป๊ะ) ไม่งั้น .includes จะ match ตัวเอง
        //    เสมอ (string ใด ๆ includes ตัวเอง) กลายเป็น false positive ที่ Python ไม่ทำ
        const eaten = layer.correctTerms.find(t => t !== form && t.includes(form));
        if (eaten) {
          out.conflicts.push({ term, form, section, clashesWith: eaten,
            reason: `"${form}" เป็นส่วนหนึ่งของคำถูก "${eaten}" -- ใส่แล้วคำที่พูดถูกจะถูกแก้ให้เพี้ยน` });
          anyRejected = true;
          continue;
        }
        // 2. คำผิดเดียวกันชี้ไปคำถูกคนละตัว -- กำกวม ต้องให้คนตัดสิน
        const owner = layer.formOwner.get(form);
        if (owner && owner !== term) {
          out.conflicts.push({ term, form, section, clashesWith: owner,
            reason: `"${form}" ถูกใช้เป็นคำผิดของ "${owner}" อยู่แล้ว` });
          anyRejected = true;
          continue;
        }
        // 3. สั้นเกินไป -- กฎที่ glossary.md ประกาศไว้เอง เตือนแต่ไม่บล็อก
        //    เพราะของจริงที่สั้นและถูกต้องมีอยู่ (Bin, cwt, jks, Udo)
        if (form.length < MIN_SAFE_LENGTH) {
          out.warnings.push({ term, form, section,
            reason: `"${form}" สั้นกว่า ${MIN_SAFE_LENGTH} อักขระ -- อาจไปโดนกลางคำอื่น` });
        }
        // Important 3: ฟอร์มที่เพิ่งผ่านการตรวจในกลุ่มนี้ต้องเข้า formOwner "ทันที" ไม่ใช่
        // รอรอบถัดไปของ planWrite -- กลุ่มถัดไปในคอลเดียวกันที่ใช้ฟอร์มเดียวกันแต่คำถูกคนละตัว
        // ต้องเห็นเจ้าของตัวนี้ผ่านกฎข้อ 2 ด้านบน ไม่งั้นฟอร์มเดียวกันจะแมปไปคำถูกสองตัวเงียบ ๆ
        layer.formOwner.set(form, term);
      }
      fresh.push(form);
    }
    if (!fresh.length) {
      // Important 4 / Minor 7: 'มีอยู่แล้วทั้งหมด' เป็นความจริงเฉพาะตอนมีฟอร์มส่งมาจริง และ
      // ไม่มีฟอร์มไหนถูกปฏิเสธเลย -- ต้องแยกสามกรณีออกจากกัน ผู้ใช้ต้องรู้ว่าเกิดอะไรขึ้นจริง:
      //   1. ไม่มีฟอร์มส่งมาเลยตั้งแต่ต้น (forms.length === 0) -- ไม่ใช่ "มีอยู่แล้ว" (Ghost
      //      ไม่เคยอยู่ในไฟล์) และไม่ใช่ "ถูกปฏิเสธ" (ไม่มีอะไรให้ตรวจด้วยซ้ำ) เป็นคนละเรื่องกัน
      //   2. มีฟอร์มส่งมาแต่ถูกปฏิเสธหมด (ชนกฎข้อ 1/2 หรือมีอักขระต้องห้าม)
      //   3. มีฟอร์มส่งมาและไม่มีอะไรถูกปฏิเสธเลย แต่ทุกฟอร์มมีอยู่แล้วในไฟล์จริง ๆ
      const reason = !forms.length
        ? 'ไม่มีคำผิดที่จะเพิ่ม'
        : anyRejected
        ? `ทุกฟอร์มของ "${term}" ถูกปฏิเสธ (ชนกับคำถูกอื่นหรือมีอักขระต้องห้าม) ไม่ใช่เพราะมีอยู่แล้ว`
        : 'มีอยู่แล้วทั้งหมด';
      out.skipped.push({ term, forms, section, reason });
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
