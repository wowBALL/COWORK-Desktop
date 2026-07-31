const test = require('node:test');
const assert = require('node:assert');

// tab-meeting.js หยิบ util/dateFilter จาก global.COWORK ตอนโหลด — require สองไฟล์นี้ก่อน
// (แบบเดียวกับ datefilter.test.js) ให้ตั้ง global.COWORK.util / .dateFilter ให้เอง
require('../util.js');
require('../datefilter.js');
const { parseMeta, splitCounts, parseWords, parseSpots } = require('../tab-meeting.js');

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
