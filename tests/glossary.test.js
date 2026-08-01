const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { parseGlossary } = require('../glossary.js');

// fixture คือไฟล์จริงของ meeting-notes ไม่ใช่ข้อมูลแต่ง (ไฟล์นี้ gitignored อยู่ที่ repo นั้น
// และมีชื่อระบบภายในปนอยู่ จึงห้ามก๊อปเข้ามาไว้ใน repo นี้)
//
// *** ใช้ / ไม่ใช่ \ *** -- '\C' '\m' ในสตริง JS เป็น escape ที่ไม่รู้จัก แบ็กสแลชจะถูก
// กลืนหายเงียบ ๆ ได้ path ผิดที่ existsSync คืน false แล้วเทสก็ผ่านแบบ skip โดยไม่มีใครรู้
const REAL = 'D:/COWORK/meeting-notes/glossary.md';
const realText = fs.existsSync(REAL) ? fs.readFileSync(REAL, 'utf8') : null;

// ห้ามใช้ { skip } กับเทสที่อ่าน fixture จริง -- เทสที่ข้ามตัวเองเงียบ ๆ พิสูจน์อะไรไม่ได้
// ถ้าเครื่องไหนไม่มีไฟล์นี้ ต้องเห็นว่ามันหาย ไม่ใช่เห็นว่า "ผ่าน"
test('fixture ของจริงต้องหาเจอ', () => {
  assert.ok(realText, `ไม่พบ fixture ที่ ${REAL} -- แก้ REAL ให้ตรงกับเครื่องนี้`);
});

test('parseGlossary: แยก section เป็นตารางคำ พร้อมเลขบรรทัด 1-based', () => {
  const g = parseGlossary([
    '## exact',
    '# comment',
    'PostgreSQL: โพสเกรส, พอสเกรส',
    '',
    '## fuzzy',
    'Electron: อิเล็กตรอน  # เฉพาะ desktop app',
  ].join('\n'));
  assert.deepStrictEqual(g.sections.exact.PostgreSQL.forms, ['โพสเกรส', 'พอสเกรส']);
  assert.strictEqual(g.sections.exact.PostgreSQL.line, 3);
  // inline comment ต้องถูกตัดออกจาก forms ไม่งั้น "# เฉพาะ desktop app" กลายเป็นคำผิด
  assert.deepStrictEqual(g.sections.fuzzy.Electron.forms, ['อิเล็กตรอน']);
});

test('parseGlossary: คีย์ซ้ำใน section เดียวกัน -- ตัวหลังชนะ ตัวหน้าเข้า duplicates', () => {
  const g = parseGlossary(['## exact', 'Approve: App Proof', 'Approve: โกรธ'].join('\n'));
  assert.deepStrictEqual(g.sections.exact.Approve.forms, ['โกรธ']);
  assert.deepStrictEqual(g.duplicates, [
    { section: 'exact', term: 'Approve', line: 2, shadowedBy: 3 },
  ]);
});

test('parseGlossary: คีย์ซ้ำ "ข้าม" section ไม่ใช่ duplicate', () => {
  const g = parseGlossary(['## exact', 'GORM: กรอม', '## fuzzy', 'GORM: กรม'].join('\n'));
  assert.deepStrictEqual(g.duplicates, []);
  assert.deepStrictEqual(g.sections.exact.GORM.forms, ['กรอม']);
  assert.deepStrictEqual(g.sections.fuzzy.GORM.forms, ['กรม']);
});

test('parseGlossary: ข้ามคำที่มี * [ ] -- อักขระเหล่านี้ประกอบหัว segment transcript', () => {
  // `*` `[` `]` เป็นอักขระที่ประกอบหัว segment ของ transcript เช่น `**ผู้พูด 1** [00:00]:`
  // ถ้า glossary มีคำเหล่านี้ คำนั้นจะทำให้ transcript parse ไม่ออก ต้องข้ามมัน
  // นอก correct term เราต้องข้ามเรคคอร์ดด้วยถ้า form ใดก็ตามมีอักขระเหล่านี้
  const g = parseGlossary(['## exact', 'Test: form[1]'].join('\n'));
  assert.deepStrictEqual(g.sections.exact.Test, undefined);
  assert.deepStrictEqual(g.duplicates, []);
});

test('parseGlossary: correct term มี * ทำให้ข้ามบรรทัดนั้น', () => {
  const g = parseGlossary(['## exact', 'Te*st: form1'].join('\n'));
  assert.strictEqual(g.sections.exact['Te*st'], undefined);
  assert.strictEqual(g.duplicates.length, 0);
});

test('parseGlossary: form มี [ ทำให้ข้ามบรรทัดนั้น', () => {
  const g = parseGlossary(['## exact', 'Test: form[1]'].join('\n'));
  assert.strictEqual(g.sections.exact.Test, undefined);
  assert.strictEqual(g.duplicates.length, 0);
});

test('parseGlossary: correct term มี ] ทำให้ข้าม ตัวเดิมที่ถูก correct ก่อนหน้านี้ไม่ถูก shadow', () => {
  // ถ้าคำถูก correct มาก่อน แล้วเจอบรรทัดซ้ำที่มี markup ต้องข้ามบรรทัดใหม่
  // บรรทัดเดิมต้องอยู่ไว้ตามเดิม ไม่เข้า duplicates
  const g = parseGlossary([
    '## exact',
    'GitHub: กิทฮับ',      // บรรทัดที่ 2 -- ถูก correct
    'GitHub]: กิทหับ',     // บรรทัดที่ 3 -- มี ] ต้องข้าม
  ].join('\n'));
  assert.deepStrictEqual(g.sections.exact.GitHub.forms, ['กิทฮับ']);
  assert.strictEqual(g.sections.exact.GitHub.line, 2);
  assert.deepStrictEqual(g.duplicates, []);
});

test('parseGlossary: จำ EOL ของไฟล์ไว้ (CRLF ต้องไม่กลายเป็น LF)', () => {
  assert.strictEqual(parseGlossary('## exact\r\nA: b\r\n').eol, '\r\n');
  assert.strictEqual(parseGlossary('## exact\nA: b\n').eol, '\n');
});

test('parseGlossary: insertAfter ชี้บรรทัด entry สุดท้ายของ section (ไม่ใช่ comment ท้าย)', () => {
  const g = parseGlossary([
    '## exact',      // 1
    'A: b',          // 2
    'C: d',          // 3  <- entry สุดท้าย
    '',              // 4
    '# หมายเหตุท้าย section',  // 5
    '## fuzzy',      // 6
  ].join('\n'));
  assert.strictEqual(g.insertAfter.exact, 3);
});

test('parseGlossary: section ที่มีแต่ comment -- insertAfter ตกไปที่บรรทัดมีเนื้อสุดท้าย', () => {
  const g = parseGlossary([
    '## project-names',  // 1
    '# ว่างไว้โดยเจตนา',  // 2
    '',                   // 3
    '## aliases',         // 4
  ].join('\n'));
  assert.strictEqual(g.insertAfter['project-names'], 2);
});

test('parseGlossary: section ที่มีเฉพาะ entry ที่มี markup -- insertAfter ชี้ heading ไม่ใช่บรรทัด rejected', () => {
  // ถ้า entry มี * [ ] ต้องถูก reject และไม่ไปอัพเดต lastContent ไม่งั้น insertAfter จะชี้ไปยัง
  // บรรทัดที่ถูก reject แล้ว
  const g = parseGlossary([
    '## exact',      // 1
    'Te*st: form1',  // 2 - rejected (มี *)
  ].join('\n'));
  assert.strictEqual(g.insertAfter.exact, 1);  // ต้องชี้ heading ไม่ใช่ line 2
  assert.strictEqual(g.sections.exact['Te*st'], undefined);
});

// เทสนี้คือเหตุผลที่ฟีเจอร์นี้ต้อง merge ไม่ใช่ append -- พิสูจน์ว่าไฟล์จริงมีของตายอยู่
test('parseGlossary: ไฟล์จริงมีคีย์ซ้ำที่ src/glossary.py มองไม่เห็น', () => {
  const g = parseGlossary(realText);
  const dup = g.duplicates.map(d => `${d.section}/${d.term}`);
  assert.ok(dup.includes('exact/JWKS'), `ควรเจอ exact/JWKS แต่ได้ ${JSON.stringify(dup)}`);
  assert.ok(dup.includes('exact/Approve'));
  assert.ok(dup.includes('exact/Merge Request'));
});
