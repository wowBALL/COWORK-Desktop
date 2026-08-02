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
  isDone, glossKnown, renderMeta, termFromGuess, resetGloss } = require('../tab-meeting.js');

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

// เดิมคอมเมนต์นี้อ้างว่าฟิกซ์เจอร์ตรวจ condition !strict.includes('หรือ') ใน clean โดยเฉพาะ --
// ไม่จริงอีกต่อไปหลังใส่ `&& !!term` เข้า tick: guess มี "หรือ" ซึ่งเป็นอักษรไทย ทำให้
// termFromGuess คืน '' ผ่าน THAI_CHAR เสมอ (ดักไว้ก่อนจะไปถึงเกณฑ์ "หรือ" ใด ๆ) -- term จึงว่าง
// และ tick เป็น false ผ่าน !!term อยู่แล้ว ไม่ต้องพึ่งการ์ด !strict.includes('หรือ') เลย
// ลบการ์ดนั้นออกจาก clean เทสนี้ก็ยังเขียว (ตรวจแล้ว) -- ฟิกซ์เจอร์ที่พิสูจน์การ์ดตัวนี้จริง ๆ
// อยู่ที่ 'หรือ อยู่ในวงเล็บ...' ด้านล่าง (เส้นทางเดียวที่ strict มี "หรือ" แต่ term ไม่มี)
test('glossaryDraft: term มี หรือ แต่ <= 3 คำ → ไม่ติ๊ก (เพราะ "หรือ" เป็นอักษรไทย ไม่ใช่เพราะการ์ดใน clean)', () => {
  const [r] = glossaryDraft([
    { heard: 'BillBin', guess: 'เดาว่าคือ Bill หรือ Bin', n: '' },
  ]);
  assert.strictEqual(r.forms.length, 1);
  assert.strictEqual(r.forms[0], 'BillBin');
  assert.strictEqual(r.tick, false, 'ต้องไม่ติ๊กเพราะ term ว่าง');
  assert.strictEqual(r.term, '', 'term ต้องว่างเพราะมีอักษรไทยปน (THAI_CHAR) ไม่ใช่เพราะการ์ด หรือ');
});

// นี่คือฟิกซ์เจอร์ที่พิสูจน์การ์ด !strict.includes('หรือ') ใน clean จริง ๆ -- ต้องใช้เส้นทางที่
// "หรือ" อยู่ใน strict (ข้อความหลังตัดคำนำ "เดาว่าคือ") แต่ไม่อยู่ใน term ที่ termFromGuess คืนออกมา
// เส้นทางเดียวที่เป็นแบบนั้นคือ "หรือ" อยู่ใน "วงเล็บ" -- termFromGuess ตัดวงเล็บทิ้งก่อนตรวจ
// THAI_CHAR (ดูคอมเมนต์ที่ตัวมันเอง) แต่ strict ของ glossaryDraft ไม่ได้ตัดวงเล็บเลย
test('glossaryDraft: หรือ อยู่ในวงเล็บที่ termFromGuess ตัดออก แต่ strict ยังเห็น -- การ์ดต้องกันติ๊กแม้ term ใช้ได้จริง', () => {
  const [r] = glossaryDraft([{ heard: 'Foo', guess: 'เดาว่าคือ Bar (หรือ)', n: '' }]);
  assert.strictEqual(r.term, 'Bar', 'termFromGuess ตัดวงเล็บออก ต้องได้ term ที่ใช้ได้จริง');
  assert.strictEqual(r.tick, false,
    'strict ("Bar (หรือ)") ยังมี "หรือ" อยู่เพราะไม่ได้ตัดวงเล็บ -- การ์ดต้องกันติ๊กแม้ term ผ่านแล้ว');
});

// ===== termFromGuess =====
// ฟิกซ์เจอร์ทุกตัวยกมาจากฝั่งขวาของ "## คำที่น่าจะถอดเพี้ยน" ในไฟล์จริง ไม่ได้แต่งขึ้นเอง
//
// เกณฑ์แต่ละข้อมีเทสของตัวเองที่ "ตกด้วยเกณฑ์นั้นข้อเดียว" -- ห้ามใช้ฟิกซ์เจอร์ที่ตกหลายข้อ
// พร้อมกัน ไม่งั้นลบเกณฑ์ตัวใดตัวหนึ่งทิ้งแล้วเทสยังเขียว (เคยเกิดกับ glossaryDraft มาแล้ว)
test('termFromGuess: แม็ปตรง ๆ ไม่มีคำนำ -> ได้คำถูก', () => {
  assert.strictEqual(termFromGuess('BMAD'), 'BMAD');
  assert.strictEqual(termFromGuess('GitLab'), 'GitLab');
});

test('termFromGuess: ตัดคำนำ "เดาว่าคือ" ออก', () => {
  assert.strictEqual(termFromGuess('เดาว่าคือ Odoo'), 'Odoo');
  assert.strictEqual(termFromGuess('ฟังไม่ออก เดาว่าคือ Payment'), 'Payment');
});

test('termFromGuess: คำนำที่โมเดลสะกดเพี้ยน "เด่าว่าคือ" ก็ตัดออก', () => {
  assert.strictEqual(termFromGuess('เด่าว่าคือ Solo'), 'Solo');
});

test('termFromGuess: ตัดวงเล็บก่อนตรวจเกณฑ์อื่น -- บริบทในวงเล็บมีอะไรก็ได้', () => {
  // ถ้าตรวจเกณฑ์ก่อนตัดวงเล็บ แถวนี้จะตกเพราะในวงเล็บมีทั้งอักษรไทยและ "หรือ"
  assert.strictEqual(
    termFromGuess('Attendance (ในบริบทคือชื่อ Agent หรือ Bot ที่ช่วยทำงาน)'), 'Attendance');
  assert.strictEqual(termFromGuess('dock (โฟลเดอร์)'), 'dock');
});

test('termFromGuess: มีอักษรไทย -> เป็นคำอธิบาย ไม่ใช่คำถูก', () => {
  // คำถูกใน glossary.md ตัวจริง 106 ตัว (exact 86 + fuzzy 19 + aliases 1) มีอักษรไทย 0
  // ฟิกซ์เจอร์นี้นับได้ 3 คำและไม่มี / , จึงตกด้วยเกณฑ์อักษรไทยข้อเดียวเท่านั้น
  assert.strictEqual(termFromGuess('เดาว่าเป็นชื่อบริษัท Partner สะกดยังไม่แน่'), '');
  assert.strictEqual(termFromGuess('สิงค์ เมนู (Zinga)'), '');
});

test('termFromGuess: มี / -> โมเดลเสนอหลายคำตอบ ไม่เดาแทน', () => {
  // 3 คำ ไม่มีไทย ยาว 14 ตัว -- ตกด้วยเกณฑ์ / ข้อเดียว
  assert.strictEqual(termFromGuess('Chat / ChatGPT'), '');
});

test('termFromGuess: มี , -> ไม่ให้คำถูก', () => {
  // 2 คำ ไม่มีไทย ยาว 9 ตัว -- ตกด้วยเกณฑ์ , ข้อเดียว
  assert.strictEqual(termFromGuess('Bill, Bin'), '');
});

test('termFromGuess: เกิน 3 คำ -> เป็นประโยค ไม่ใช่คำ', () => {
  // 4 คำ ไม่มีไทย ไม่มี / , ยาว 24 ตัว -- ตกด้วยเกณฑ์จำนวนคำข้อเดียว
  assert.strictEqual(termFromGuess('เดาว่าคือ Clean Room Design System'), '');
});

test('termFromGuess: ยาวเกิน 40 ตัวอักษร -> ไม่ให้คำถูก', () => {
  // 3 คำ ไม่มีไทย ไม่มี / , ยาว 61 ตัว -- ตกด้วยเกณฑ์ความยาวข้อเดียว
  assert.strictEqual(
    termFromGuess('Supercalifragilistic Expialidocious Antidisestablishmentarian'), '');
});

test('termFromGuess: ตัดอัญประกาศ/backtick หัวท้าย แต่ไม่แตะตรงกลาง', () => {
  assert.strictEqual(termFromGuess('เดาว่าคือ "Playwright"'), 'Playwright');
  assert.strictEqual(termFromGuess('`cheat sheet` (คู่มือลัด)'), 'cheat sheet');
  assert.strictEqual(termFromGuess("O'Reilly"), "O'Reilly", "' กลางคำต้องรอด");
});

test('termFromGuess: ฝั่งขวาเป็นวงเล็บล้วน -> ว่าง', () => {
  assert.strictEqual(termFromGuess('(ไม่แน่ใจ / ชื่อโปรเจกต์เฉพาะ)'), '');
  assert.strictEqual(termFromGuess(''), '');
});

test('termFromGuess: วัดกับ summary.meta.md จริง -> 35 แถว ได้คำถูก 20', () => {
  const fs = require('node:fs');
  const REAL = 'D:/COWORK/meeting-notes/meetings/' +
    '2026-07-31_19-59-Transfer Knowledge Session/summary.meta.md';
  assert.ok(fs.existsSync(REAL), `ไม่พบ fixture ที่ ${REAL}`);
  const meta = parseMeta(fs.readFileSync(REAL, 'utf8'));
  const sec = meta.sections.find(s => s.title.startsWith('คำที่น่าจะถอดเพี้ยน'));
  assert.ok(sec, 'ไม่พบหัวข้อ "คำที่น่าจะถอดเพี้ยน" ในไฟล์จริง');
  const words = parseWords(sec.body);
  assert.strictEqual(words.length, 35);
  assert.strictEqual(words.filter(w => termFromGuess(w.guess)).length, 20);
});

// ===== glossaryDraft: ของใหม่ในรอบนี้ =====
test('glossaryDraft: เก็บข้อความประเมินดิบไว้ในแถว (guess)', () => {
  const G = 'เดาว่าคือ "End-to-End Test" หรือ "UI Test"';
  const [r] = glossaryDraft([{ heard: 'GORM Pro', guess: G, n: '' }]);
  assert.strictEqual(r.guess, G, 'ต้องเก็บดิบ ๆ ไม่ตัดไม่แต่ง -- UI เป็นคนตัดด้วย CSS');
  assert.strictEqual(r.term, '', 'ข้อความแบบนี้ยังไม่เติมช่องคำถูกให้');
});

test('glossaryDraft: แม็ปตรง ๆ ไม่มีคำนำ -> เติมคำถูกให้ แต่ยังไม่ติ๊ก', () => {
  const [r] = glossaryDraft([{ heard: 'Bmat', guess: 'BMAD', n: '' }]);
  assert.strictEqual(r.term, 'BMAD');
  assert.strictEqual(r.tick, false, 'กฎติ๊กยังเป็นกฎเดิม -- ไม่มีคำนำก็ไม่ติ๊กให้');
});

test('glossaryDraft: ตัดอัญประกาศหัวท้ายออกจากคำผิด', () => {
  // ถ้าไม่ตัด บรรทัดที่เขียนลง glossary.md จะเป็น `"Playwright": "PlayLight"` ซึ่งตายสนิท
  // (เกิดขึ้นจริงแล้วที่ glossary.md:183) -- เป็นคนละคีย์กับ Playwright ที่มีอยู่
  const [r] = glossaryDraft([{ heard: '"PlayLight"', guess: 'เดาว่าคือ "Playwright"', n: '' }]);
  assert.deepStrictEqual(r.forms, ['PlayLight']);
  assert.strictEqual(r.term, 'Playwright');
});

test('glossaryDraft: คำผิดที่เท่ากับคำถูก -> ตัดทิ้ง แถวนั้นส่งไม่ได้', () => {
  // โมเดลกำลังบอกว่า "คำนี้ถูกอยู่แล้ว" ไม่ใช่ของที่ต้องเขียน
  const [r] = glossaryDraft([{ heard: 'Redmine', guess: 'Redmine', n: '' }]);
  assert.strictEqual(r.term, 'Redmine');
  assert.deepStrictEqual(r.forms, []);
  assert.strictEqual(r.tick, false);
});

test('glossaryDraft: เทียบคำผิด=คำถูกแบบไม่สนตัวพิมพ์ใหญ่เล็ก', () => {
  const [r] = glossaryDraft([{ heard: 'redmine / RedMind', guess: 'Redmine', n: '' }]);
  assert.deepStrictEqual(r.forms, ['RedMind']);
});

test('glossaryDraft: ติ๊กอัตโนมัติต้องมีคำถูกที่ใช้ได้จริงด้วย', () => {
  // เส้นทาง clean ผ่านครบ (มีคำนำ, 1 คำ, ไม่มี "หรือ") แต่ termFromGuess ปัดตกเพราะเป็นไทย
  // ถ้าติ๊กให้ทั้งที่ term ว่าง ผู้ใช้จะกดส่งแล้วโดนฟ้องว่า "แถวนี้ยังไม่มีคำถูก"
  const [r] = glossaryDraft([{ heard: 'Sawasdee', guess: 'เดาว่าคือ สวัสดี', n: '' }]);
  assert.strictEqual(r.term, '');
  assert.strictEqual(r.tick, false);
});

test('glossaryDraft: วัดกับ summary.meta.md จริง -> 35 แถว, คำถูก 20, ติ๊ก 2', () => {
  const fs = require('node:fs');
  const REAL = 'D:/COWORK/meeting-notes/meetings/' +
    '2026-07-31_19-59-Transfer Knowledge Session/summary.meta.md';
  assert.ok(fs.existsSync(REAL), `ไม่พบ fixture ที่ ${REAL}`);
  const meta = parseMeta(fs.readFileSync(REAL, 'utf8'));
  const sec = meta.sections.find(s => s.title.startsWith('คำที่น่าจะถอดเพี้ยน'));
  assert.ok(sec, 'ไม่พบหัวข้อ "คำที่น่าจะถอดเพี้ยน" ในไฟล์จริง');
  const rows = glossaryDraft(parseWords(sec.body));
  assert.strictEqual(rows.length, 35);
  assert.strictEqual(rows.filter(r => r.term).length, 20);
  assert.strictEqual(rows.filter(r => r.tick).length, 2, 'กฎติ๊กต้องไม่ขยับจากของเดิม');
  assert.strictEqual(rows.filter(r => r.forms.some(f => /["']/.test(f))).length, 0,
    'ไม่มีอัญประกาศเหลือในคำผิดสักแถว');
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

// Fix 4: forms.length > 0 เดิมดูเหมือนของแถม (Array.prototype.every บน [] คืน true เสมอ) แต่
// วัดกับประชุมจริงแล้วพบว่า 5 จาก 35 แถวมี forms: [] จริง ๆ (Redmine, session file, Zinga, GLM,
// Screenshot -- คำผิดที่โมเดลถอดมาเท่ากับคำถูกเป๊ะ ถูกกรองทิ้งใน glossaryDraft ดูคอมเมนต์
// "คำผิดที่เท่ากับคำถูกเป๊ะ" ที่นั่น) ถ้าไม่มีการ์ดนี้ แถวพวกนั้นจะโดนตีว่า "อยู่ใน glossary แล้ว"
// (done: true) ทั้งที่ไม่มีฟอร์มไหนเลยที่ยืนยันได้จริงว่าอยู่ใน known -- ป้ายจะโกหกและแถวจะถูก
// disable การกรอกทั้งที่ยังไม่เคยถูกส่งไปไหนเลย
test('Fix 4: isDone -- แถวที่ forms ว่างเปล่า (มิสทรานสคริปต์เท่ากับคำถูกเป๊ะ) ต้องไม่ถือว่าเสร็จแล้ว แม้ section มีอยู่ใน known', () => {
  const known = glossKnown({ sections: { exact: { Foo: ['bar'] } } });
  assert.strictEqual(
    isDone({ term: 'Redmine', forms: [], section: 'exact' }, known),
    false,
    'forms ว่างเปล่าต้องไม่ถือว่า "เสร็จแล้ว" -- [].every(...) เป็น true เสมอโดยไม่มีอะไรถูกตรวจจริง'
  );
});

// Minor 8: mtGloss.rows เดิมเป็น array แบนก้อนเดียวใช้ร่วมกันทุกหัวข้อแบบคำในประชุมเดียว --
// หัวข้อที่สองจะเห็นธง "ร่างแล้ว" จากหัวข้อแรกแล้วไม่ร่างของตัวเอง ทำให้ข้อมูลของหัวข้อแรก
// ไปโผล่ซ้ำใต้หัวข้อที่สอง เทสนี้ประกอบ meta ที่มีสองหัวข้อแบบคำ แล้วตรวจว่าแต่ละ section
// แสดงเฉพาะคำของตัวเอง ไม่เห็นคำของอีก section เลย
test('Minor 8: renderMeta -- สองหัวข้อแบบคำในประชุมเดียวกัน ต้องไม่ทับ/ปนกัน', () => {
  resetGloss();
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

// ตัวช่วยประกอบ meta ขั้นต่ำที่ renderMeta รับได้ -- ฟิลด์ครบตามที่ renderMeta อ่านจริง
const metaWith = body => ({
  model: 'test-model', modelNote: '', profile: 'dev', glossary: [], fuzzy: [], other: [],
  sections: [{ title: 'คำที่น่าจะถอดเพี้ยน', body }],
});

test('renderMeta: วาดข้อความประเมินของ AI พร้อม tooltip ข้อความเต็ม', () => {
  resetGloss();
  const html = renderMeta(metaWith('- Bmat → BMAD (ได้ยิน 2 ครั้ง)'));
  assert.ok(html.includes('class="gai"'), 'ต้องมีคอลัมน์ข้อความประเมิน');
  assert.ok(html.includes('title="BMAD"'), 'ส่วนที่ล้นต้องอ่านได้จาก tooltip');
});

test('renderMeta: ไม่มีข้อความประเมิน -> ไม่วาดคอลัมน์เปล่า', () => {
  resetGloss();
  const html = renderMeta(metaWith('- Bmat →  (ได้ยิน 2 ครั้ง)'));
  assert.ok(!html.includes('class="gai"'), 'แถวที่ฝั่งขวาว่างไม่ควรมีช่องว่างลอย ๆ');
});

test('renderMeta: อัญประกาศในข้อความประเมินต้องถูก escape ก่อนใส่ใน title', () => {
  // util.js esc() escape " เป็น &quot; ต่อจาก textContent->innerHTML โดยเฉพาะเพื่อกรณีนี้
  // ถ้าไม่ผ่าน esc() เครื่องหมาย " ตัวแรกจะปิด attribute แล้วที่เหลืองอกเป็น attribute ขยะ
  resetGloss();
  const html = renderMeta(metaWith('- X → เดาว่าคือ "Playwright" (ได้ยิน 1 ครั้ง)'));
  assert.ok(html.includes('title="เดาว่าคือ &quot;Playwright&quot;"'),
    'title ต้องเก็บข้อความเต็มในรูปที่ escape แล้ว');
});

test('renderMeta: เครื่องหมาย <> ในข้อความประเมินต้องถูก escape ก่อนใส่ในข้อความที่มองเห็นด้วย (ไม่ใช่แค่ title)', () => {
  // renderMeta ถูก assign เข้า DOM ผ่าน body.innerHTML= (ดู mtOpenMeeting) ถ้าฝั่งข้อความที่
  // มองเห็น (ระหว่าง > กับ </span>) ไม่ผ่าน esc() ค่า guess ที่มี < หรือ > จะกลายเป็น markup
  // ดิบที่หลุดเข้า DOM ตรง ๆ -- ใช้ <> แทน " เพราะ " ทดสอบฝั่ง title ไปแล้วในเทสก่อนหน้า และ
  // esc() escape < / > ผ่านเส้นทาง textContent->innerHTML คนละจุดกับที่ escape "
  resetGloss();
  const html = renderMeta(metaWith('- X → เดาว่าคือ <Playwright> (ได้ยิน 1 ครั้ง)'));
  assert.ok(html.includes('>เดาว่าคือ &lt;Playwright&gt;</span>'),
    'ข้อความที่มองเห็นต้องเก็บรูปที่ escape แล้ว');
  assert.ok(!html.includes('<Playwright>'),
    'ห้ามมี markup ดิบของ guess หลุดเข้าไปใน HTML ที่ส่งต่อให้ innerHTML=');
});
