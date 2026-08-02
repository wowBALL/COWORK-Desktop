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
    'GitHub: กิทฮับ]',     // บรรทัดที่ 3 -- ซ้ำคีย์ มี ] ในคำแปล ต้องข้าม
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

test('parseGlossary: บรรทัดผิดรูป (ไม่มี : หรือคำหรือคำแปลว่าง) ไม่ไปอัพเดต lastContent', () => {
  // บรรทัดผิดรูปต้องข้าม แต่ต้องไม่ไปอัพเดต lastContent เหมือนกับบรรทัด markup
  // เพื่อให้ insertAfter ชี้บรรทัด entry สุดท้ายที่ถูก valid หรือ heading เท่านั้น
  const g = parseGlossary([
    '## exact',         // 1
    'just some text',   // 2 - ผิดรูป (ไม่มี :)
  ].join('\n'));
  assert.strictEqual(g.insertAfter.exact, 1);  // ต้องชี้ heading ไม่ใช่ line 2
  assert.deepStrictEqual(g.sections.exact, {});
  assert.deepStrictEqual(g.duplicates, []);
});

// เทสนี้คือเหตุผลที่ฟีเจอร์นี้ต้อง merge ไม่ใช่ append -- พิสูจน์ว่าไฟล์จริงมีของตายอยู่
test('parseGlossary: ไฟล์จริงมีคีย์ซ้ำที่ src/glossary.py มองไม่เห็น', () => {
  const g = parseGlossary(realText);
  const dup = g.duplicates.map(d => `${d.section}/${d.term}`);
  assert.ok(dup.includes('exact/JWKS'), `ควรเจอ exact/JWKS แต่ได้ ${JSON.stringify(dup)}`);
  assert.ok(dup.includes('exact/Approve'));
  assert.ok(dup.includes('exact/Merge Request'));
});

const { planWrite } = require('../glossary.js');

const META = { title: 'Stanup', date: '2026-07-31' };
const BASE = [
  '## exact',                 // 1
  'Kubernetes: ครูป, ฟลูก',    // 2
  'Approve: App Proof',       // 3
  'Approve: โกรธ',            // 4
  '',                         // 5
  '# ท้าย section',           // 6
  '## fuzzy',                 // 7
  'Electron: อิเล็กตรอน  # เฉพาะ desktop app',  // 8
].join('\n') + '\n';

test('planWrite: คำถูกที่ยังไม่มี -> added และแทรกใต้ header ที่บอกที่มา', () => {
  const r = planWrite(BASE, [{ term: 'Odoo', forms: ['Udo', 'UDU'], section: 'exact' }], META);
  assert.deepStrictEqual(r.added, [{ term: 'Odoo', forms: ['Udo', 'UDU'], section: 'exact' }]);
  assert.deepStrictEqual(r.merged, []);
  // insertAfter.exact = 4 (บรรทัด entry สุดท้าย) ของใหม่จึงเริ่มที่ index 4
  const out = r.newText.split('\n');
  assert.strictEqual(out[3], 'Approve: โกรธ');             // บรรทัด 4 เดิม ไม่ถูกแตะ
  assert.strictEqual(out[4], '');                          // บรรทัดว่างคั่นที่แทรกเข้ามา
  assert.strictEqual(out[5], '# --- จาก Stanup (2026-07-31) ---');
  assert.strictEqual(out[6], 'Odoo: Udo, UDU');
  assert.strictEqual(out[7], '');                          // บรรทัดว่างเดิม (บรรทัด 5)
});

test('planWrite: คำถูกที่มีอยู่แล้ว -> merged เข้าบรรทัดเดิม ไม่สร้างคีย์ซ้ำใหม่', () => {
  const r = planWrite(BASE, [{ term: 'Kubernetes', forms: ['คูป'], section: 'exact' }], META);
  assert.deepStrictEqual(r.added, []);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.merged[0].line, 2);
  assert.strictEqual(r.newText.split('\n')[1], 'Kubernetes: ครูป, ฟลูก, คูป');
  // เขียนแล้วต้องไม่มีคีย์ซ้ำงอกเพิ่ม
  assert.strictEqual(parseGlossary(r.newText).duplicates.length,
                     parseGlossary(BASE).duplicates.length);
});

test('planWrite: คำถูกที่มีหลายบรรทัด -> merge เข้าบรรทัดสุดท้าย (บรรทัดที่ Python อ่านจริง)', () => {
  const r = planWrite(BASE, [{ term: 'Approve', forms: ['แอปพรูฟ'], section: 'exact' }], META);
  assert.strictEqual(r.merged[0].line, 4);
  assert.strictEqual(r.newText.split('\n')[3], 'Approve: โกรธ, แอปพรูฟ');
  assert.strictEqual(r.newText.split('\n')[2], 'Approve: App Proof');   // บรรทัดตายไม่ถูกแตะ
});

test('planWrite: บรรทัดที่มี inline comment -> คำใหม่แทรกก่อน # ไม่ใช่หลัง', () => {
  const r = planWrite(BASE, [{ term: 'Electron', forms: ['อีเล็คตรอน'], section: 'fuzzy' }], META);
  assert.strictEqual(r.newText.split('\n')[7],
    'Electron: อิเล็กตรอน, อีเล็คตรอน  # เฉพาะ desktop app');
});

test('planWrite: คำผิดที่มีอยู่แล้วครบ -> skipped ไม่แตะไฟล์', () => {
  const r = planWrite(BASE, [{ term: 'Kubernetes', forms: ['ครูป'], section: 'exact' }], META);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.merged.length, 0);
  assert.strictEqual(r.newText, null);
});

test('planWrite: entries ว่าง -> newText เป็น null', () => {
  assert.strictEqual(planWrite(BASE, [], META).newText, null);
});

test('planWrite: comment / บรรทัดว่าง / EOL ของเดิมต้องเหมือนเดิมเป๊ะ', () => {
  const r = planWrite(BASE, [{ term: 'Odoo', forms: ['Udo'], section: 'exact' }], META);
  const before = BASE.split('\n');
  const after = r.newText.split('\n');
  // ทุกบรรทัดเดิมยังอยู่ เรียงเหมือนเดิม (ของใหม่จากแค่แทรกเพิ่ม)
  let i = 0;
  for (const line of before) {
    const at = after.indexOf(line, i);
    assert.notStrictEqual(at, -1, `บรรทัดหาย: ${JSON.stringify(line)}`);
    i = at + 1;
  }
  assert.ok(r.newText.endsWith('\n'), 'ต้องยังจบด้วย newline');
  assert.ok(!r.newText.includes('\r'), 'ไฟล์ LF ห้ามกลายเป็น CRLF');
});

test('planWrite: ไฟล์ CRLF ต้องเขียนกลับเป็น CRLF', () => {
  const crlf = BASE.replace(/\n/g, '\r\n');
  const r = planWrite(crlf, [{ term: 'Odoo', forms: ['Udo'], section: 'exact' }], META);
  assert.ok(r.newText.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(r.newText), 'ห้ามมี LF โดด ๆ ปนในไฟล์ CRLF');
});

// BASE มีแค่ section exact กับ fuzzy -- project-names และ aliases ไม่มีอยู่ในไฟล์เลย
test('planWrite: section ที่ไม่มีในไฟล์ -> ต้องเข้า skipped พร้อมเหตุผลระบุชื่อ section ห้ามหายเงียบ', () => {
  const r = planWrite(BASE, [{ term: 'Odoo', forms: ['Udo'], section: 'project-names' }], META);
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.merged.length, 0);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].term, 'Odoo');
  assert.match(r.skipped[0].reason, /project-names/);
  // เมื่อเป็น entry เดียวที่ส่งเข้ามา และเขียนอะไรไม่ได้เลย newText ต้องเป็น null
  assert.strictEqual(r.newText, null);
});

test('planWrite: สอง entries เติมคำใหม่คำเดียวกันในการกดครั้งเดียว -> ได้บรรทัดใหม่บรรทัดเดียว ไม่ใช่สอง', () => {
  const r = planWrite(BASE, [
    { term: 'Odoo', forms: ['Udo'], section: 'exact' },
    { term: 'Odoo', forms: ['UDU'], section: 'exact' },
  ], META);
  assert.strictEqual(r.added.length, 1);
  assert.deepStrictEqual(r.added[0], { term: 'Odoo', forms: ['Udo', 'UDU'], section: 'exact' });
  const lines = r.newText.split('\n').filter(l => l.startsWith('Odoo:'));
  assert.strictEqual(lines.length, 1, `ต้องมีบรรทัด Odoo แค่บรรทัดเดียว ได้ ${JSON.stringify(lines)}`);
  assert.strictEqual(lines[0], 'Odoo: Udo, UDU');
  // เขียนแล้วต้องไม่มีคีย์ซ้ำงอกเพิ่ม (ถ้าโค้ดเก่ากลับมา จะมี Odoo สองบรรทัดในไฟล์เดียวกัน)
  assert.strictEqual(parseGlossary(r.newText).duplicates.length, parseGlossary(BASE).duplicates.length);
});

test('planWrite: สอง entries เติมฟอร์มเดียวกันเข้าคำเดิมในการกดครั้งเดียว -> เติมครั้งเดียว ไม่ซ้ำ', () => {
  const r = planWrite(BASE, [
    { term: 'Kubernetes', forms: ['A'], section: 'exact' },
    { term: 'Kubernetes', forms: ['A'], section: 'exact' },
  ], META);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.newText.split('\n')[1], 'Kubernetes: ครูป, ฟลูก, A');
  assert.strictEqual(parseGlossary(r.newText).duplicates.length, parseGlossary(BASE).duplicates.length);
});

test('planWrite: สอง entries ที่ (section, term) ต่างกัน แต่ key โดยเดือย concatenation จะชน -> แยกเป็นสองกลุ่ม', () => {
  // คีย์ต้องใช้อักขระ separator ที่ไม่สามารถปนอยู่ใน section หรือ term ได้เลย
  // เช่น space เดี่ยว ๆ ใช้ไม่ได้:
  // ("exact", "Foo Bar") ก็ได้ key "exact Foo Bar"
  // ("exact Foo", "Bar") ก็ได้ key "exact Foo Bar" ด้วย
  // ต้องใช้ JSON.stringify([section, term]) แทน
  //
  // ทดสอบว่า entry ที่สองไม่ได้หายไปในกลุ่มแรก: forms ของ entry แรกต้องเป็นแค่ ['a']
  // (ไม่ใช่ ['a', 'b'] ซึ่งจะเกิดขึ้นถ้าคีย์ชนแล้ว form 'b' ของ entry ที่สองเพิ่มเข้าไป)
  // และ entry ที่สองต้องเข้า skipped เพราะ section "exact Foo" ไม่มีในไฟล์
  const r = planWrite(BASE, [
    { term: 'Foo Bar', forms: ['a'], section: 'exact' },
    { term: 'Bar', forms: ['b'], section: 'exact Foo' },
  ], META);

  // entry แรก ต้องเข้า added ด้วย form 'a' เท่านั้น
  assert.strictEqual(r.added.length, 1);
  assert.deepStrictEqual(r.added[0].term, 'Foo Bar');
  assert.deepStrictEqual(r.added[0].forms, ['a']);  // ห้ามมี 'b' ที่มาจาก entry ที่สอง
  assert.deepStrictEqual(r.added[0].section, 'exact');

  // entry ที่สอง ต้องเข้า skipped เพราะ section ไม่มี
  assert.strictEqual(r.skipped.length, 1);
  assert.deepStrictEqual(r.skipped[0].term, 'Bar');
  assert.deepStrictEqual(r.skipped[0].forms, ['b']);  // form ต้องมี 'b' เท่านั้น ไม่ใช่อันอื่น
  assert.deepStrictEqual(r.skipped[0].section, 'exact Foo');
  assert.match(r.skipped[0].reason, /exact Foo/);

  // ไม่มี merged
  assert.strictEqual(r.merged.length, 0);
});
