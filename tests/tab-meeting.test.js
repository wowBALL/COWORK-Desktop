const test = require('node:test');
const assert = require('node:assert');

// tab-meeting.js หยิบ util/dateFilter จาก global.COWORK ตอนโหลด — require สองไฟล์นี้ก่อน
// (แบบเดียวกับ datefilter.test.js) ให้ตั้ง global.COWORK.util / .dateFilter ให้เอง
require('../util.js');
require('../datefilter.js');

// util.js esc() สร้าง <div> จริงแล้วอ่าน textContent->innerHTML เพื่อ escape ให้ถูกต้อง (ดู
// คอมเมนต์ในไฟล์นั้น: ห้ามเขียนใหม่เป็น regex ทั้งก้อน) renderMeta เรียก esc() ทุกจุด จึงต้องมี
// document.createElement('div') ขั้นต่ำให้เรียกได้ -- ไม่ใช่ DOM เต็ม (แบบเดียวกับ El() ใน
// tab-redmine.dom.test.js) แค่พอให้ esc() ไม่ throw 'document is not defined'
global.document = {
  createElement() {
    return {
      _text: '',
      set textContent(v) { this._text = String(v); },
      get textContent() { return this._text; },
      get innerHTML() {
        return this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  },
};

const { parseMeta, splitCounts, parseWords, parseSpots, glossaryDraft, landedRows,
  isDone, glossKnown, renderMeta } = require('../tab-meeting.js');

// ฟิกซ์เจอร์ทั้งหมดยกมาจากไฟล์จริง (ไม่ใช่ข้อมูลที่แต่งขึ้นเอง):
// D:\COWORK\meeting-notes\meetings\2026-07-31_09-59-Stanup2\summary.meta.md
// D:\COWORK\meeting-notes\meetings\2026-07-31_09-59-Stanup\summary.meta.md
// เขียนโดย meeting-notes/src/storage.py:save_summary() — ดูรูปแบบจริงที่นั่น ไม่ใช่ที่นี่

const STANUP2 = `สรุปด้วย claude-opus-5 (เขียนมือแทน GLM-5.2 ที่ endpoint ช้าผิดปกติ)
ประเภทประชุม: dev
แก้คำตาม glossary: rollback 6 จุด, Zitadel 4 จุด, BMAD 1 จุด, Casdoor 1 จุด, GitLab 1 จุด
คำ fuzzy ที่เจอในห้อง: branch 14 ครั้ง, Git 10 ครั้ง, Kubernetes 7 ครั้ง, production 5 ครั้ง

## คำที่น่าจะถอดเพี้ยน (ยังไม่อยู่ใน glossary)
- Udo / UDU / ODO / Voodoo / โฟดู → เดาว่าคือ Odoo (ได้ยินมากกว่า 20 ครั้ง)
- Zero / ZERO → เดาว่าคือ Xero (ได้ยินมากกว่า 20 ครั้ง)
- cwt / CWT → เดาว่าคือ JWT (ได้ยิน 3 ครั้ง)

## จุดที่ควรตรวจเอง
- ทั้งไฟล์: มีผู้พูด 3 คนที่ไม่ได้ลงทะเบียนเสียง คือ ผู้พูด 1 (คนที่พูดมากที่สุด ถูกเรียกว่า "พี่เอก" ตลอด), ผู้พูด 2 และ ผู้พูด 8 — ชื่อจริงยังไม่ยืนยัน และระบบแยกเสียงอาจสลับบรรทัดระหว่างผู้พูดได้
- 08:00–16:20 (lalita อธิบาย Reconcile): ประโยคขาดเป็นท่อน มีคำที่ถอดไม่ออกปนอยู่หลายจุด ("ใกล้ค immens", "nouvelle", "ลุนรึ่งบ้า") ตัวเลขจำนวนรายการที่ลบ/ที่กลับมาควรฟังซ้ำ
- 14:30–15:05: ช่วงถาม-ตอบระหว่าง ผู้พูด 1 กับ lalita เรื่องวิธี 1-2-3 เสียงทับกันจนจับใจความไม่ชัด
`;

// ประชุมเก่ากว่า ไม่มีบรรทัด "หมายเหตุ" ในวงเล็บท้าย "สรุปด้วย" — ต้องอ่านโมเดลได้เฉย ๆ ไม่มี modelNote
const STANUP = `สรุปด้วย claude-sonnet-5 (เขียนมือแทน GLM-5.2 ที่ endpoint ช้าผิดปกติ)
ประเภทประชุม: dev
แก้คำตาม glossary: rollback 6 จุด, Zitadel 4 จุด, BMAD 1 จุด, Casdoor 1 จุด, GitLab 1 จุด
คำ fuzzy ที่เจอในห้อง: branch 14 ครั้ง, Git 10 ครั้ง, Kubernetes 7 ครั้ง, production 5 ครั้ง

## คำที่น่าจะถอดเพี้ยน (ยังไม่อยู่ใน glossary)
- รายเส้น → เดาว่าเป็นชื่อระบบ/โปรเจกต์ที่เกี่ยวกับ Account Payroll (ไม่แน่ใจความหมายที่แท้จริง) (ได้ยิน 5 ครั้ง)
- cwt / CWT → เดาว่าคือ JWT (ได้ยินหลายครั้ง)

## จุดที่ควรตรวจเอง
- ช่วง 02:56-16:35 (คำอธิบายบั๊ก Bank Reconciliation ของวิดา) เป็น Monologue ยาวที่ถูกตัดเป็นประโยคสั้นๆ จำนวนมาก ควรฟังซ้ำเพื่อยืนยันรายละเอียดทางเทคนิค เช่น ตัวเลขเปอร์เซ็นต์และชื่อบริษัท "SixDG" ที่อาจถอดเสียงผิด
`;

// ===== parseMeta: บรรทัดหัว =====
test('parseMeta อ่าน model + หมายเหตุในวงเล็บ + ประเภทประชุม จาก Stanup2', () => {
  const m = parseMeta(STANUP2);
  assert.strictEqual(m.model, 'claude-opus-5');
  assert.strictEqual(m.modelNote, 'เขียนมือแทน GLM-5.2 ที่ endpoint ช้าผิดปกติ');
  assert.strictEqual(m.profile, 'dev');
});

test('parseMeta: glossary/fuzzy แยกเป็นรายการคำครบจำนวนตามไฟล์จริง', () => {
  const m = parseMeta(STANUP2);
  assert.strictEqual(m.glossary.length, 5);
  assert.deepStrictEqual(m.glossary[0], { term: 'rollback', n: '6 จุด' });
  assert.strictEqual(m.fuzzy.length, 4);
  assert.deepStrictEqual(m.fuzzy[0], { term: 'branch', n: '14 ครั้ง' });
});

test('parseMeta เก็บทุกหัวข้อ ## แบบทั่วไป ไม่ผูกชื่อหัวข้อตายตัว', () => {
  const m = parseMeta(STANUP2);
  assert.strictEqual(m.sections.length, 2);
  assert.strictEqual(m.sections[0].title, 'คำที่น่าจะถอดเพี้ยน (ยังไม่อยู่ใน glossary)');
  assert.strictEqual(m.sections[1].title, 'จุดที่ควรตรวจเอง');
});

test('parseMeta คืน null เมื่อไม่มีไฟล์ (readText คืนสตริงว่าง)', () => {
  assert.strictEqual(parseMeta(''), null);
  assert.strictEqual(parseMeta('   \n  '), null);
});

test('parseMeta: บรรทัดหัวที่ยังไม่รู้จักโผล่เป็น "other" ไม่หายเงียบ', () => {
  const m = parseMeta('สรุปด้วย claude-opus-5\nบรรทัดใหม่ที่โค้ดนี้ยังไม่รู้จัก: ค่าอะไรสักอย่าง');
  assert.strictEqual(m.other.length, 1);
  assert.strictEqual(m.other[0], 'บรรทัดใหม่ที่โค้ดนี้ยังไม่รู้จัก: ค่าอะไรสักอย่าง');
});

test('parseMeta: ไม่มีหัวข้อ ## เลย ยังคืนบรรทัดหัวได้ (sections ว่าง)', () => {
  const m = parseMeta('สรุปด้วย claude-opus-5\nประเภทประชุม: dev');
  assert.strictEqual(m.model, 'claude-opus-5');
  assert.strictEqual(m.profile, 'dev');
  assert.deepStrictEqual(m.sections, []);
});

test('parseMeta: Stanup (ไฟล์เก่ากว่า) ก็อ่านได้เหมือนกัน โมเดลต่างกัน', () => {
  const m = parseMeta(STANUP);
  assert.strictEqual(m.model, 'claude-sonnet-5');
  assert.strictEqual(m.sections.length, 2);
});

// ===== splitCounts =====
test('splitCounts แยก "term N หน่วย" คั่นด้วยคอมมา', () => {
  assert.deepStrictEqual(
    splitCounts('rollback 6 จุด, Zitadel 4 จุด'),
    [{ term: 'rollback', n: '6 จุด' }, { term: 'Zitadel', n: '4 จุด' }],
  );
});

test('splitCounts: ค่าที่ไม่ตรงรูปแบบ "N หน่วย" ยังไม่หาย (n ว่าง)', () => {
  assert.deepStrictEqual(splitCounts('คำแปลก ๆ'), [{ term: 'คำแปลก ๆ', n: '' }]);
});

// ===== parseWords ("ได้ยิน → เดาว่า") =====
test('parseWords แยกฝั่งซ้าย/ขวาของ "→" และดึงจำนวนครั้งจากวงเล็บท้ายบรรทัด', () => {
  const m = parseMeta(STANUP2);
  const w = parseWords(m.sections[0].body);
  assert.strictEqual(w.length, 3);
  assert.deepStrictEqual(w[0], {
    heard: 'Udo / UDU / ODO / Voodoo / โฟดู',
    guess: 'เดาว่าคือ Odoo',
    n: 'ได้ยินมากกว่า 20 ครั้ง',
  });
  assert.deepStrictEqual(w[2], { heard: 'cwt / CWT', guess: 'เดาว่าคือ JWT', n: 'ได้ยิน 3 ครั้ง' });
});

// ===== parseSpots (ป้ายเวลา) =====
test('parseSpots ดึงป้ายเวลา en dash "–" ออกจากเนื้อหา', () => {
  const m = parseMeta(STANUP2);
  const s = parseSpots(m.sections[1].body);
  const withTs = s.find(x => x.tx.includes('lalita อธิบาย Reconcile'));
  assert.strictEqual(withTs.ts, '08:00–16:20');
  assert.match(withTs.tx, /^\(lalita อธิบาย Reconcile\)/);
});

test('parseSpots ดึงป้ายเวลา hyphen "-" ธรรมดาด้วย (Stanup ใช้ hyphen ไม่ใช่ en dash)', () => {
  const m = parseMeta(STANUP);
  const s = parseSpots(m.sections[1].body);
  assert.strictEqual(s[0].ts, '02:56-16:35');
});

test('parseSpots: บรรทัด "ทั้งไฟล์:" ไม่มีป้ายเวลาตัวเลข ใช้คำว่า "ทั้งไฟล์" เป็น ts แทน', () => {
  const m = parseMeta(STANUP2);
  const s = parseSpots(m.sections[1].body);
  assert.strictEqual(s[0].ts, 'ทั้งไฟล์');
  assert.match(s[0].tx, /^มีผู้พูด 3 คน/);
});

// ===== glossaryDraft =====
test('glossaryDraft: แถวปกติ -> แยกคำผิดด้วย / และตัดคำนำ "เดาว่าคือ" ออก', () => {
  const [r] = glossaryDraft([
    { heard: 'Udo / UDU / ODO', guess: 'เดาว่าคือ Odoo', n: 'ได้ยิน 20 ครั้ง' },
  ]);
  assert.deepStrictEqual(r.forms, ['Udo', 'UDU', 'ODO']);
  assert.strictEqual(r.term, 'Odoo');
  assert.strictEqual(r.section, 'exact');
  assert.strictEqual(r.tick, true);
});

test('glossaryDraft: ตัดวงเล็บบริบทออกจากฝั่งคำผิด -- วงเล็บไม่ใช่คำผิด', () => {
  const [r] = glossaryDraft([
    { heard: 'กรอม / กรม / Column (ที่บอกว่าเป็น ORM ของ Golang)', guess: 'เดาว่าคือ GORM', n: '' },
  ]);
  assert.deepStrictEqual(r.forms, ['กรอม', 'กรม', 'Column']);
});

test('glossaryDraft: คำนำ "ฟังไม่ออก เดาว่าคือ" ก็ตัดออก', () => {
  const [r] = glossaryDraft([{ heard: 'Peythearn', guess: 'ฟังไม่ออก เดาว่าคือ Payment', n: '' }]);
  assert.strictEqual(r.term, 'Payment');
  assert.strictEqual(r.tick, true);
});

test('glossaryDraft: ฝั่งขวาเป็นประโยค -> term ว่าง ไม่ติ๊กให้', () => {
  const [r] = glossaryDraft([
    { heard: 'GOM', guess: 'เดาว่าคือชื่อผู้ให้บริการ KYC ตัวเดียวกับ Sumsub', n: '' },
  ]);
  assert.strictEqual(r.term, '');
  assert.strictEqual(r.tick, false);
  assert.deepStrictEqual(r.forms, ['GOM']);   // คำผิดยังต้องมี ให้คนกรอกคำถูกเอง
});

test('glossaryDraft: มีสองคำตอบ ("หรือ") -> ไม่ติ๊กให้', () => {
  const [r] = glossaryDraft([
    { heard: 'ClearCat', guess: 'เดาว่าคือ Clear Cache หรือ Clear-cut', n: '' },
  ]);
  assert.strictEqual(r.term, '');
  assert.strictEqual(r.tick, false);
});

test('glossaryDraft: วัดกับ summary.meta.md จริง -> ติ๊กอัตโนมัติ 24 จาก 32 แถว', () => {
  const fs = require('node:fs');
  // ใช้ / ไม่ใช่ \ -- backslash ในสตริง JS เป็น escape ทำให้ path เพี้ยนเงียบ ๆ
  const REAL = 'D:/COWORK/meeting-notes/meetings/2026-07-31_09-59-Stanup/summary.meta.md';
  assert.ok(fs.existsSync(REAL), `ไม่พบ fixture ที่ ${REAL}`);
  const meta = parseMeta(fs.readFileSync(REAL, 'utf8'));
  const rows = glossaryDraft(parseWords(meta.sections[0].body));
  assert.strictEqual(rows.length, 32);
  assert.strictEqual(rows.filter(r => r.tick).length, 24);
});

test('glossaryDraft: ตรวจสอบแยกต่างหาก: term > 3 คำ (ไม่มี หรือ) → ไม่ติ๊ก', () => {
  // ฟิกซ์เจอร์นี้ตรวจสอบเฉพาะ condition term.split(/\\s+/).length <= 3
  // โดยให้ term ยาว 4 คำแต่ไม่มี หรือ (ตัดการรวมกันกับ !term.includes('หรือ'))
  const [r] = glossaryDraft([
    { heard: 'ClearRoomDS', guess: 'เดาว่าคือ Clean Room Design System', n: '' },
  ]);
  assert.strictEqual(r.forms.length, 1);
  assert.strictEqual(r.forms[0], 'ClearRoomDS');
  assert.strictEqual(r.tick, false, 'ต้องไม่ติ๊กเพราะ 4 คำเกิน');
  assert.strictEqual(r.term, '', 'term ต้องว่างเพราะไม่ผ่าน clean check');
});

test('glossaryDraft: ตรวจสอบแยกต่างหาก: term มี หรือ แต่ <= 3 คำ → ไม่ติ๊ก', () => {
  // ฟิกซ์เจอร์นี้ตรวจสอบเฉพาะ condition !term.includes('หรือ')
  // โดยให้ term มี หรือ แต่นับคำแล้วได้ 3 คำ (ตัดการรวมกันกับ term.split(/\\s+/).length <= 3)
  const [r] = glossaryDraft([
    { heard: 'BillBin', guess: 'เดาว่าคือ Bill หรือ Bin', n: '' },
  ]);
  assert.strictEqual(r.forms.length, 1);
  assert.strictEqual(r.forms[0], 'BillBin');
  assert.strictEqual(r.tick, false, 'ต้องไม่ติ๊กเพราะมี หรือ');
  assert.strictEqual(r.term, '', 'term ต้องว่างเพราะไม่ผ่าน clean check');
});

// ===== landedRows =====
// ตัวนี้ตัดสินว่าแถวไหน "เขียนสำเร็จแล้ว" จึงเคลียร์ติ๊กได้ -- ถ้าตัดสินผิดฝั่งใดฝั่งหนึ่ง
// ผู้ใช้จะเสียโอกาส retry (เคลียร์ติ๊กแถวที่ยังไม่ได้เขียน) หรือส่งซ้ำโดยไม่จำเป็น
const KEY = (section, term) => section + '\u0000' + term;

test('landedRows: เอาเฉพาะ added/merged ไม่เอา skipped/conflicts/warnings', () => {
  const landed = landedRows({
    added:     [{ section: 'exact', term: 'Odoo',  forms: ['Udo'] }],
    merged:    [{ section: 'fuzzy', term: 'Role',  forms: ['Low'] }],
    skipped:   [{ section: 'exact', term: 'JWT',   forms: ['cwt'] }],
    conflicts: [{ section: 'exact', term: 'Bill',  form: 'Bi' }],
    warnings:  [{ section: 'exact', term: 'GOM',   form: 'GOM' }],
  });
  assert.ok(landed.has(KEY('exact', 'Odoo')));
  assert.ok(landed.has(KEY('fuzzy', 'Role')));
  assert.ok(!landed.has(KEY('exact', 'JWT')), 'skipped ต้องไม่นับว่าเขียนแล้ว');
  assert.ok(!landed.has(KEY('exact', 'Bill')), 'conflicts ต้องไม่นับว่าเขียนแล้ว');
  assert.ok(!landed.has(KEY('exact', 'GOM')), 'warnings ไม่ได้แปลว่ามี entry ของตัวเอง');
  assert.strictEqual(landed.size, 2);
});

// เคสที่เป็นเหตุผลทั้งหมดที่ต้องจับคู่ด้วย (section,term) แทนฟอร์ม
test('landedRows: แถวที่ถูกปฏิเสธทั้งหมด ไม่ถูกนับ แม้จะแชร์ฟอร์มกับแถวที่เขียนสำเร็จ', () => {
  const landed = landedRows({
    added:     [{ section: 'exact', term: 'Written',  forms: ['a', 'b'] }],
    skipped:   [{ section: 'exact', term: 'Rejected', forms: ['b', 'c'] }],
    conflicts: [{ section: 'exact', term: 'Rejected', form: 'b' }],
  });
  assert.ok(landed.has(KEY('exact', 'Written')));
  assert.ok(!landed.has(KEY('exact', 'Rejected')), "'b' โผล่ทั้งสองแถว แต่ Rejected ไม่ได้ถูกเขียน");
});

test('landedRows: term เดียวกันคนละ section เป็นคนละคีย์', () => {
  const landed = landedRows({ added: [{ section: 'exact', term: 'GORM', forms: ['กรอม'] }] });
  assert.ok(landed.has(KEY('exact', 'GORM')));
  assert.ok(!landed.has(KEY('fuzzy', 'GORM')), 'GORM ใน fuzzy เป็นคนละแถว ห้าม match ข้ามชั้น');
});

test('landedRows: res ว่าง/null/ไม่มีคีย์ -> Set ว่าง ไม่ throw', () => {
  assert.strictEqual(landedRows(null).size, 0);
  assert.strictEqual(landedRows(undefined).size, 0);
  assert.strictEqual(landedRows({}).size, 0);
  assert.strictEqual(landedRows({ added: [], merged: [] }).size, 0);
});

// === Final review (final-review-fixes): Important 4, Minor 8 ===

// Important 4: badge "อยู่ใน glossary แล้ว" เดิม section-blind (known เป็น Set แบนรวมทุก section)
// -- ฟอร์มที่มีอยู่จริงใน section หนึ่งทำให้แถวของ section อื่นที่บังเอิญใช้ฟอร์มชื่อเดียวกัน
// (แต่ตั้งใจชี้ไปคำถูกคนละตัว) ถูกตีว่า "เสร็จแล้ว" ทั้งที่ planWrite จะเขียนให้จริง
test('Important 4: isDone ต้องดูเฉพาะ known ของ section เป้าหมายของแถวนั้น ไม่ union รวมทุก section', () => {
  // 'proof' มีอยู่จริงใน fuzzy (→ Kubernetes) แต่ไม่มีใน exact เลย
  const known = glossKnown({ sections: { fuzzy: { Kubernetes: ['proof'] }, exact: {} } });
  const rowExact = { term: 'SomeNewTerm', forms: ['proof'], section: 'exact', tick: true };
  assert.strictEqual(isDone(rowExact, known), false,
    "แถว exact ที่ใช้ฟอร์ม 'proof' ต้องไม่ถูกตีว่าเสร็จแล้ว เพราะ 'proof' ไม่ได้อยู่ใน exact");
  const rowFuzzy = { term: 'Kubernetes', forms: ['proof'], section: 'fuzzy', tick: true };
  assert.strictEqual(isDone(rowFuzzy, known), true, "แถว fuzzy ที่ตรงกับของในไฟล์จริงต้องเสร็จแล้ว");
});

test('Important 4: glossKnown สร้าง Map แยกตาม section ไม่ union ฟอร์มรวมกันข้าม section', () => {
  const known = glossKnown({ sections: { fuzzy: { Kubernetes: ['proof'] }, exact: { Foo: ['bar'] } } });
  assert.ok(known.get('fuzzy').has('proof'));
  assert.ok(!known.get('fuzzy').has('bar'), 'fuzzy ต้องไม่เห็นฟอร์มของ exact');
  assert.ok(known.get('exact').has('bar'));
  assert.ok(!known.get('exact').has('proof'), 'exact ต้องไม่เห็นฟอร์มของ fuzzy');
});

test('Important 4: isDone -- section ที่ไม่มี known เลย (undefined) ต้องได้ false ไม่ throw', () => {
  const known = glossKnown({ sections: {} });
  assert.strictEqual(isDone({ term: 'X', forms: ['a'], section: 'exact' }, known), false);
});

// Minor 8: mtGloss.rows เดิมเป็น array แบนก้อนเดียวใช้ร่วมกันทุกหัวข้อแบบคำในประชุมเดียว --
// หัวข้อที่สองจะเห็นธง "ร่างแล้ว" จากหัวข้อแรกแล้วไม่ร่างของตัวเอง ทำให้ข้อมูลของหัวข้อแรก
// ไปโผล่ซ้ำใต้หัวข้อที่สอง เทสนี้ประกอบ meta ที่มีสองหัวข้อแบบคำ แล้วตรวจว่าแต่ละ section
// แสดงเฉพาะคำของตัวเอง ไม่เห็นคำของอีก section เลย
test('Minor 8: renderMeta -- สองหัวข้อแบบคำในประชุมเดียวกัน ต้องไม่ทับ/ปนกัน', () => {
  const meta = {
    model: 'test-model', modelNote: '', profile: 'dev', glossary: [], fuzzy: [], other: [],
    sections: [
      { title: 'หัวข้อหนึ่ง', body: '- Udo / UDU → เดาว่าคือ Odoo (ได้ยิน 5 ครั้ง)' },
      { title: 'หัวข้อสอง', body: '- Foo / Bar → เดาว่าคือ Baz (ได้ยิน 3 ครั้ง)' },
    ],
  };
  const html = renderMeta(meta);
  const i0 = html.indexOf('data-gsec="0"');
  const i1 = html.indexOf('data-gsec="1"');
  assert.ok(i0 !== -1 && i1 !== -1, 'ต้องวาดทั้งสอง section ออกมา');
  const block0 = html.slice(i0, i1);
  const block1 = html.slice(i1);
  assert.ok(block0.includes('Odoo'), 'section แรกต้องมีคำของตัวเอง (Odoo)');
  assert.ok(!block0.includes('Baz'), 'section แรกต้องไม่เห็นคำของ section สอง (Baz)');
  assert.ok(block1.includes('Baz'), 'section สองต้องมีคำของตัวเอง (Baz)');
  assert.ok(!block1.includes('Odoo'), 'section สองต้องไม่เห็นคำของ section แรกซ้ำ (Odoo)');
});
