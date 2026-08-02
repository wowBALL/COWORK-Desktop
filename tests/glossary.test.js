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

const { planWrite, MAPPING_SECTIONS } = require('../glossary.js');

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
  // เดิมใช้ฟอร์ม 'A' แต่ Task 3 เพิ่มการตรวจการชนแล้ว: 'A' เป็น substring ของ "Approve"
  // ที่มีอยู่ใน BASE จริง ๆ (กฎข้อ 1) เลยชนโดยไม่ตั้งใจ เปลี่ยนเป็น 'Zorb' ที่ยาวพอ
  // (กัน warning ข้อ 3) และไม่ชนคำถูกไหนใน BASE เพื่อให้เทสนี้ยังทดสอบเรื่อง dedup ล้วน ๆ
  const r = planWrite(BASE, [
    { term: 'Kubernetes', forms: ['Zorb'], section: 'exact' },
    { term: 'Kubernetes', forms: ['Zorb'], section: 'exact' },
  ], META);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.newText.split('\n')[1], 'Kubernetes: ครูป, ฟลูก, Zorb');
  assert.deepStrictEqual(r.conflicts, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(parseGlossary(r.newText).duplicates.length, parseGlossary(BASE).duplicates.length);
});

test('planWrite: สอง entries ที่ (section, term) ต่างกัน แต่ key โดยเดือย concatenation จะชน -> แยกเป็นสองกลุ่ม', () => {
  // คีย์ต้องใช้อักขระ separator ที่ไม่สามารถปนอยู่ใน section หรือ term ได้เลย
  // เช่น space เดี่ยว ๆ ใช้ไม่ได้:
  // ("exact", "Foo Bar") ก็ได้ key "exact Foo Bar"
  // ("exact Foo", "Bar") ก็ได้ key "exact Foo Bar" ด้วย
  // ต้องใช้ JSON.stringify([section, term]) แทน
  //
  // ทดสอบว่า entry ที่สองไม่ได้หายไปในกลุ่มแรก: forms ของ entry แรกต้องเป็นแค่ ['Zorb']
  // (ไม่ใช่ ['Zorb', 'b'] ซึ่งจะเกิดขึ้นถ้าคีย์ชนแล้ว form 'b' ของ entry ที่สองเพิ่มเข้าไป)
  // และ entry ที่สองต้องเข้า skipped เพราะ section "exact Foo" ไม่มีในไฟล์
  //
  // หมายเหตุ (Task 3, Critical 1): เดิมใช้ฟอร์ม 'a' แต่หลัง Critical 1 คำถูกของกลุ่มตัวเอง
  // ('Foo Bar') เข้า correctTerms ของกฎข้อ 1 ด้วย และ 'a' ดันเป็น substring ของ "Foo Bar"
  // เอง (ตัว a ใน "Bar") ทำให้ชนกฎข้อ 1 เข้าตัวเองโดยไม่ตั้งใจ ทั้งที่เทสนี้ทดสอบเรื่องคีย์
  // การจัดกลุ่มล้วน ๆ ไม่เกี่ยวกับกฎการชน เปลี่ยนเป็น 'Zorb' ที่ไม่ชนอะไรใน BASE หรือ "Foo Bar"
  const r = planWrite(BASE, [
    { term: 'Foo Bar', forms: ['Zorb'], section: 'exact' },
    { term: 'Bar', forms: ['b'], section: 'exact Foo' },
  ], META);

  // entry แรก ต้องเข้า added ด้วย form 'Zorb' เท่านั้น
  assert.strictEqual(r.added.length, 1);
  assert.deepStrictEqual(r.added[0].term, 'Foo Bar');
  assert.deepStrictEqual(r.added[0].forms, ['Zorb']);  // ห้ามมี 'b' ที่มาจาก entry ที่สอง
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

// ยืมกฎจาก tools/check_glossary.py ของ meeting-notes -- ไฟล์จริงวันนี้ไม่มีเคสข้อ 1 หรือ 2 เลย
// (ยืนยันด้วย python -m tools.check_glossary) เคสสองข้อนี้จึงต้องใช้ fixture สังเคราะห์
const CLASH = ['## exact', 'Bill: Bin', 'JWT: cwt'].join('\n') + '\n';

test('ชนข้อ 1: คำผิดใหม่เป็น substring ของคำถูกที่มีอยู่ -> conflict ไม่เขียน', () => {
  const r = planWrite(CLASH, [{ term: 'Beta', forms: ['Bi'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].form, 'Bi');
  assert.strictEqual(r.conflicts[0].clashesWith, 'Bill');
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.newText, null);
});

test('ชนข้อ 2: คำผิดใหม่มีอยู่แล้วแต่ชี้ไปคำถูกอื่น -> conflict', () => {
  const r = planWrite(CLASH, [{ term: 'Xero', forms: ['cwt'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].clashesWith, 'JWT');
  assert.strictEqual(r.newText, null);
});

test('เตือนข้อ 3: คำผิดสั้นกว่า 4 อักขระ -> เตือนแต่ยังเขียนให้', () => {
  const r = planWrite(CLASH, [{ term: 'Sumsub', forms: ['GOM'], section: 'exact' }], META);
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].form, 'GOM');
  assert.strictEqual(r.added.length, 1);
  assert.ok(r.newText.includes('Sumsub: GOM'));
});

test('fuzzy ไม่ถูกตรวจการชน -- ชั้นนั้นโมเดลตีความเอง คำที่มีความหมายจริงจึงปลอดภัย', () => {
  const src = ['## exact', 'Bill: Bin', '## fuzzy', 'X: y'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'Beta', forms: ['Bi'], section: 'fuzzy' }], META);
  assert.deepStrictEqual(r.conflicts, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.added.length, 1);
});

test('คำผิดบางตัวชน บางตัวผ่าน -> เขียนเฉพาะตัวที่ผ่าน', () => {
  const r = planWrite(CLASH, [{ term: 'Beta', forms: ['Bi', 'Betaform'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.deepStrictEqual(r.added, [{ term: 'Beta', forms: ['Betaform'], section: 'exact' }]);
});

// เจอตอนรันแผนนี้จริง: กฎข้อ 1 ต้องเทียบกับคำถูก "ทุกตัว" รวมตัวมันเอง ไม่ใช่ตัวอื่นเท่านั้น
// ใส่ Approv เป็นคำผิดของ Approve จะทำให้ "Approve" ในบทถอดเสียงกลายเป็น "Approvee"
test('คำผิดที่เป็นส่วนหนึ่งของ "คำถูกของตัวเอง" ก็ต้องถูกบล็อก', () => {
  const src = ['## exact', 'Approve: โกรธ'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'Approve', forms: ['Approv'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].clashesWith, 'Approve');
  assert.strictEqual(r.merged.length, 0);
  assert.strictEqual(r.newText, null);
});

// เพิ่มนอกเหนือสเปกเดิม (ได้รับอนุญาตชัดเจน): '*' '[' ']' ประกอบหัว segment ของ transcript
// (`**ผู้พูด 1** [00:00]:`) -- _parse_glossary_file ฝั่ง Python (src/glossary.py) ทิ้งทั้งบรรทัด
// เงียบ ๆ เมื่อเจออักขระเหล่านี้ ไม่ว่าจะอยู่ใน section ไหน ถ้าเขียน form นี้ลงไป ฟอร์มอื่นที่
// ถูกต้องซึ่งอยู่บรรทัดเดียวกันจะตายไปด้วย parseGlossary ฝั่ง read กันไว้แล้ว (hasMarkup)
// นี่คือฝั่ง write ที่ยังไม่มีการกันมาก่อน Task 3
test('คำถูกใหม่มี * -> conflict ทุก section เพราะ Python parser จะทิ้งทั้งบรรทัดตอนอ่าน', () => {
  const r = planWrite(BASE, [{ term: 'Te*st', forms: ['x'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].term, 'Te*st');
  assert.match(r.conflicts[0].reason, /\*/);
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.newText, null);
});

test('ฟอร์มใหม่มี [ ] -> conflict เฉพาะฟอร์มนั้น ฟอร์มอื่นของคำเดียวกันยังเขียนได้ปกติ', () => {
  const r = planWrite(BASE, [{ term: 'Odoo', forms: ['Ud[o]', 'UDU'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].form, 'Ud[o]');
  assert.deepStrictEqual(r.added, [{ term: 'Odoo', forms: ['UDU'], section: 'exact' }]);
});

// ต้องบล็อกแม้ section fuzzy ที่ปกติไม่ถูกตรวจการชน (REPLACING_SECTIONS ไม่รวม fuzzy)
// เพราะ _parse_glossary_file ฝั่ง Python ทิ้งบรรทัด markup โดยไม่สนใจว่าอยู่ section ไหน
test('markup ต้องถูกบล็อกแม้ section fuzzy ที่ไม่ถูกตรวจการชนตามปกติ', () => {
  const r = planWrite(BASE, [{ term: 'Electron', forms: ['อี[เล็ค]ตรอน'], section: 'fuzzy' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].form, 'อี[เล็ค]ตรอน');
  assert.strictEqual(r.merged.length, 0);
  assert.strictEqual(r.newText, null);
});

// === Task 3 (code review): ห้าข้อ -- Critical 1, Critical 2, Important 3, Important 4, Minor 5 ===

test('Critical 1: กฎข้อ 1 ต้องเห็นคำถูกที่กำลังเขียนในคอลนี้เอง แม้มันยังไม่มีใน glossary.md มาก่อน', () => {
  // "Approve" ยังไม่มีอยู่ในไฟล์เลย (มีแค่ Bill: Bin) -- ก่อนแก้ Critical 1 correctTerms
  // สร้างจากไฟล์ก่อนเขียนเท่านั้น (replacingLayer(g) ไม่รู้จัก Approve) จึงปล่อยให้ Approv
  // (substring ของ Approve) เขียนผ่านไปเงียบ ๆ แล้วบทถอดเสียงที่พูด "Approve" ถูกต้องจะถูก
  // แก้เป็น "Approvee" -- ตรงกับ pattern ของเคส Engage/Ingress ที่เกิดขึ้นจริง
  const r = planWrite('## exact\nBill: Bin\n',
    [{ term: 'Approve', forms: ['Approv'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].form, 'Approv');
  assert.strictEqual(r.conflicts[0].clashesWith, 'Approve');
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.newText, null);
});

test('Critical 2: กฎข้อ 1 ต้องรวมคำถูกจาก fuzzy/project-names ด้วย ไม่ใช่แค่ exact/aliases (ยืนยันกับไฟล์จริง)', () => {
  // 'Role' อยู่เฉพาะใน fuzzy ของไฟล์จริง ไม่อยู่ใน exact/aliases เลย -- ยืนยันก่อนว่าเทสนี้
  // ทดสอบสิ่งที่ตั้งใจจริง ๆ (ไม่ใช่บังเอิญชนกับคำถูกใน exact ที่เดิมก็ถูกตรวจอยู่แล้ว)
  assert.ok(realText, `ไม่พบ fixture ที่ ${REAL}`);
  const g = parseGlossary(realText);
  assert.ok(g.sections.fuzzy && g.sections.fuzzy.Role, 'fixture ต้องมี Role ใน fuzzy');
  assert.ok(!(g.sections.exact && g.sections.exact.Role), 'Role ต้องไม่อยู่ใน exact');
  assert.ok(!(g.sections.aliases && g.sections.aliases.Role), 'Role ต้องไม่อยู่ใน aliases');

  const r = planWrite(realText, [{ term: 'RoleTest', forms: ['Rol'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].clashesWith, 'Role');
  assert.strictEqual(r.newText, null);
});

test('Important 3: ฟอร์มเดียวกันชี้ไปคำถูกสองตัวในคอลเดียวกัน -- ตัวที่สองต้องเป็น conflict', () => {
  // เดิม formOwner สร้างจากไฟล์เท่านั้น ไม่อัพเดตระหว่าง entries ในคอลเดียวกัน ฟอร์ม 'Zorb'
  // จึงเขียนทับได้ทั้งสองครั้ง แมป 'Zorb' ไปทั้ง Alpha และ Gamma -- _wrong_to_correct ฝั่ง
  // Python จะเก็บแค่ตัวหลังไว้เงียบ ๆ (dict ปกติ) ทำให้ Alpha สูญเสียคำผิดของตัวเอง
  const r = planWrite(CLASH, [
    { term: 'Alpha', forms: ['Zorb'], section: 'exact' },
    { term: 'Gamma', forms: ['Zorb'], section: 'exact' },
  ], META);
  assert.strictEqual(r.added.length, 1);
  assert.deepStrictEqual(r.added[0], { term: 'Alpha', forms: ['Zorb'], section: 'exact' });
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].term, 'Gamma');
  assert.strictEqual(r.conflicts[0].form, 'Zorb');
  assert.strictEqual(r.conflicts[0].clashesWith, 'Alpha');
});

test('Important 4: ทุกฟอร์มถูกปฏิเสธ (ไม่ใช่มีอยู่แล้ว) -> reason ต้องไม่ใช่ "มีอยู่แล้วทั้งหมด"', () => {
  // 'Bi' ชนกฎข้อ 1 (substring ของ Bill) เลยถูกปฏิเสธ -- ไม่ใช่ว่ามันมีอยู่แล้วในไฟล์
  // เดิม fresh.length === 0 ทุกกรณีถูกรายงานว่า 'มีอยู่แล้วทั้งหมด' ทั้งที่ไม่จริง
  const r = planWrite(CLASH, [{ term: 'Beta', forms: ['Bi'], section: 'exact' }], META);
  assert.strictEqual(r.skipped.length, 1);
  assert.notStrictEqual(r.skipped[0].reason, 'มีอยู่แล้วทั้งหมด');
  assert.match(r.skipped[0].reason, /ปฏิเสธ/);
  // เคส "มีอยู่แล้วจริง" (ครูป มีอยู่แล้วในไฟล์) ต้องยังได้เหตุผลเดิม ไม่ถูกกลืนหายไปด้วย
  const already = planWrite(BASE, [{ term: 'Kubernetes', forms: ['ครูป'], section: 'exact' }], META);
  assert.strictEqual(already.skipped[0].reason, 'มีอยู่แล้วทั้งหมด');
});

test('Minor 5: layer สะสมสถานะข้ามกลุ่มในคอลเดียวกัน แม้มีกลุ่มคั่นกลางที่ถูกข้ามไปเพราะ markup', () => {
  // ถ้า layer ถูกสร้างใหม่ทุกรอบวนลูป (ไม่ hoist) การสะสม formOwner ของ Important 3
  // จะใช้ไม่ได้เลย เทสนี้ยืนยันว่าการข้ามกลุ่มกลาง (Te*st มี markup) ไม่ได้ไปรีเซ็ต
  // สถานะที่กลุ่มแรกเพิ่งสะสมไว้ก่อนกลุ่มสุดท้ายจะอ่านมัน
  const r = planWrite(CLASH, [
    { term: 'Alpha', forms: ['Zorb'], section: 'exact' },
    { term: 'Te*st', forms: ['x'], section: 'exact' },
    { term: 'Gamma', forms: ['Zorb'], section: 'exact' },
  ], META);
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.added[0].term, 'Alpha');
  const gammaConflict = r.conflicts.find(c => c.term === 'Gamma');
  assert.ok(gammaConflict, 'Gamma ต้องเป็น conflict เพราะ Zorb ถูก Alpha จองไปแล้ว');
  assert.strictEqual(gammaConflict.clashesWith, 'Alpha');
});

// === Final review (final-review-fixes): Critical 1, Important 2/3/4, Minor 6/7 ===
//
// Critical 1: term/form เป็น free text แต่ไฟล์มีไวยากรณ์ของตัวเอง (`term: form1, form2  # comment`)
// ทดสอบเป็น property: สำหรับอินพุตที่ถูกปฏิเสธ ต้องไม่เขียนอะไรเลย (newText === null) และสำหรับ
// อินพุตที่ถูกรับ parseGlossary(planWrite(...).newText) ต้องคืน term/forms ตรงกับที่ส่งเข้าไปเป๊ะ ๆ
const ALL_SECTIONS_BASE = [
  '## exact', 'ExistingA: exform',
  '## fuzzy', 'ExistingB: fzform',
  '## project-names', 'ExistingC: pnform',
  '## aliases', 'ExistingD: alform',
].join('\n') + '\n';

// วางตำแหน่งอักขระอันตรายไว้ "กลาง" สตริงเสมอ ไม่ใช่ขอบ -- planWrite trim() ทุกค่าก่อนตรวจ
// (String(raw).trim()) ถ้าวางไว้ขอบ เช่น " # x" ตัว trim จะกินช่องว่างนำหน้าทิ้งจนไม่เหลือ
// " #" ให้ /\s#/ จับ กลายเป็นเทสที่ไม่ได้ทดสอบอะไรจริง
const HOSTILE = [':', ',', 'x:y', 'x,y', ',x', 'x,', 'x #y', 'x\ny', 'x\r\ny'];

test('Critical 1 (round-trip, ปฏิเสธ): term ที่มีอักขระทำลายไวยากรณ์ไฟล์ -- ไม่เขียนอะไรเลย ทุก section', () => {
  for (const section of MAPPING_SECTIONS) {
    for (const bad of HOSTILE) {
      const term = `Bad${bad}Term`;
      const r = planWrite(ALL_SECTIONS_BASE, [{ term, forms: ['SafeForm1234'], section }], META);
      assert.strictEqual(r.newText, null,
        `term ${JSON.stringify(term)} section ${section} ต้องไม่เขียนอะไรเลย`);
      assert.strictEqual(r.conflicts.length, 1,
        `term ${JSON.stringify(term)} section ${section} ต้องเข้า conflicts พอดี 1 รายการ`);
    }
  }
});

test('Critical 1 (round-trip, ปฏิเสธ): form ที่มีอักขระทำลายไวยากรณ์ไฟล์ -- ไม่เขียนอะไรเลย ทุก section', () => {
  for (const section of MAPPING_SECTIONS) {
    for (const bad of HOSTILE) {
      const form = `Bad${bad}Form`;
      const term = `NewTerm${section}${HOSTILE.indexOf(bad)}`;
      const r = planWrite(ALL_SECTIONS_BASE, [{ term, forms: [form], section }], META);
      assert.strictEqual(r.newText, null,
        `form ${JSON.stringify(form)} section ${section} ต้องไม่เขียนอะไรเลย`);
      assert.ok(r.conflicts.length >= 1 || r.skipped.length >= 1,
        `form ${JSON.stringify(form)} section ${section} ต้องถูกปฏิเสธ (conflict หรือ skipped)`);
    }
  }
});

test('Critical 1 (round-trip, ยอมรับ): term/form ปกติที่ผ่านการตรวจ ต้อง parse กลับมาตรงเป๊ะ', () => {
  const r = planWrite(ALL_SECTIONS_BASE,
    [{ term: 'BrandNewTerm', forms: ['SafeFormOne', 'SafeFormTwo'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 0);
  assert.ok(r.newText, 'ต้องเขียนไฟล์จริง');
  const reparsed = parseGlossary(r.newText);
  assert.deepStrictEqual(reparsed.sections.exact.BrandNewTerm.forms, ['SafeFormOne', 'SafeFormTwo']);
});

test('Critical 1 (round-trip, ยอมรับ): merge เข้าบรรทัดเดิมก็ต้อง parse กลับมาตรงเป๊ะ', () => {
  const r = planWrite(ALL_SECTIONS_BASE,
    [{ term: 'ExistingA', forms: ['AddedFormHere'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 0);
  const reparsed = parseGlossary(r.newText);
  assert.deepStrictEqual(reparsed.sections.exact.ExistingA.forms, ['exform', 'AddedFormHere']);
});

test('Critical 1: ตัวอย่างจากรีวิว -- term "Ingress: nginx" ต้องถูกบล็อก ไม่ใช่ทำลาย Ingress เดิม', () => {
  const src = ['## exact', 'Ingress: อิงเกรส, Engage-old'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'Ingress: nginx', forms: ['อิงเกรซ'], section: 'exact' }], META);
  assert.strictEqual(r.newText, null);
  assert.strictEqual(r.conflicts.length, 1);
  assert.match(r.conflicts[0].reason, /:/);
});

test('Critical 1: ตัวอย่างจากรีวิว -- form "C # sharp" ต้องถูกบล็อก ไม่ใช่กลายเป็น "C"', () => {
  const r = planWrite(ALL_SECTIONS_BASE,
    [{ term: 'CSharp', forms: ['C # sharp'], section: 'exact' }], META);
  assert.strictEqual(r.newText, null);
  assert.strictEqual(r.conflicts.length, 1);
});

// Important 2: header ซ้ำต้องรวมบัคเก็ตเดิม ไม่ใช่ทับ
test('Important 2: header ซ้ำ (## exact สองครั้ง) ต้องรวมบัคเก็ตเดียวกัน ไม่ล้างของเก่าทิ้ง', () => {
  const g = parseGlossary(['## exact', 'A: b', '## fuzzy', 'X: y', '## exact', 'C: d'].join('\n'));
  assert.deepStrictEqual(Object.keys(g.sections.exact).sort(), ['A', 'C']);
  assert.deepStrictEqual(g.sections.exact.A.forms, ['b']);
  assert.deepStrictEqual(g.sections.exact.C.forms, ['d']);
});

test('Important 2: header ซ้ำ -- คำเดิมที่ปรากฏซ้ำในบล็อกที่สองต้องเข้า duplicates เหมือนอยู่ section เดียวกัน', () => {
  const g = parseGlossary(['## exact', 'A: b', '## fuzzy', 'X: y', '## exact', 'A: c'].join('\n'));
  assert.deepStrictEqual(g.sections.exact.A.forms, ['c']);
  assert.deepStrictEqual(g.duplicates, [{ section: 'exact', term: 'A', line: 2, shadowedBy: 6 }]);
});

test('Important 2: planWrite ต้องเห็นคำถูกจาก header exact บล็อกแรก แม้มี header exact ซ้ำคั่นกลาง (กฎข้อ 1)', () => {
  // ก่อนแก้ Important 2: sections.exact ถูกบล็อกที่สอง ('## exact' ที่สอง) ทับจนเหลือแค่ Second
  // -- Approve (จากบล็อกแรก) จึงหายไปจาก correctTerms ของกฎข้อ 1 แล้ว Approv จะเขียนผ่านไปเงียบ ๆ
  const src = ['## exact', 'Approve: X', '## fuzzy', 'Other: y', '## exact', 'Second: z'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'New', forms: ['Approv'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].clashesWith, 'Approve');
  assert.strictEqual(r.newText, null);
});

// Important 3: กฎข้อ 1 ทิศตรงข้าม -- คำถูกใหม่ถูกฟอร์มที่มีอยู่แล้วกิน
test('Important 3 (กฎข้อ 1 ทิศตรงข้าม): คำถูกใหม่มีฟอร์มที่มีอยู่แล้วเป็น substring -> conflict', () => {
  // เคสจริงจากไฟล์: "BMAD: BMAT" -- ส่งคำถูกใหม่ "BMATrix" เข้ามา "BMAT" (คำผิดของ BMAD) เป็น
  // substring ของมัน ทุกครั้งที่มีคนพูด "BMATrix" ถูกอยู่แล้วบางส่วนจะถูกแก้เป็น BMAD
  const src = ['## exact', 'BMAD: BMAT'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'BMATrix', forms: ['x1234'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].clashesWith, 'BMAD');
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.newText, null);
});

test('Important 3 (กฎข้อ 1 ทิศตรงข้าม): คำถูกที่มีอยู่แล้ว (merge) ไม่ถูกตรวจซ้ำ', () => {
  const src = ['## exact', 'BMAD: BMAT', 'BMATrix: y1234'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'BMATrix', forms: ['z12345'], section: 'exact' }], META);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.merged.length, 1);
});

test('Important 3 (กฎข้อ 1 ทิศตรงข้าม): section ที่ไม่ guarded (fuzzy) ไม่ถูกตรวจ', () => {
  const src = ['## exact', 'BMAD: BMAT', '## fuzzy'].join('\n') + '\n';
  const r = planWrite(src, [{ term: 'BMATrix', forms: ['x1234'], section: 'fuzzy' }], META);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.added.length, 1);
});

// Minor 7: reason ต้องไม่โกหกเมื่อไม่มีฟอร์มส่งมาเลยตั้งแต่ต้น (คนละเคสกับ "มีอยู่แล้ว")
test('Minor 7: entry ไม่มีฟอร์มส่งมาเลย (forms: []) -> reason ต้องไม่ใช่ "มีอยู่แล้วทั้งหมด"', () => {
  const r = planWrite(BASE, [{ term: 'Ghost', forms: [], section: 'exact' }], META);
  assert.strictEqual(r.skipped.length, 1);
  assert.notStrictEqual(r.skipped[0].reason, 'มีอยู่แล้วทั้งหมด', 'Ghost ไม่เคยอยู่ในไฟล์ การบอกว่า "มีอยู่แล้ว" เป็นเรื่องโกหก');
  assert.strictEqual(r.newText, null);
});

// ===== อัญประกาศคร่อมคำ =====
// เกิดขึ้นจริงแล้ว: glossary.md:183 มี `"Playwright": "PlayLight"` ซึ่งเป็นคนละคีย์กับ
// `Playwright:` ที่บรรทัด 84 และคำผิด `"PlayLight"` ก็ไม่ตรงกับ `PlayLight` ใน transcript
// ทั้งบรรทัดจึงตายสนิท แต่ UI รายงานว่า "เพิ่มใหม่" สำเร็จ
test('planWrite: คำถูกที่มีอัญประกาศคร่อม -> conflict ไม่เขียน', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: '"Playwright"', forms: ['PlayLight'] }], {});
  assert.strictEqual(out.added.length, 0);
  assert.strictEqual(out.conflicts.length, 1);
  // เหมือน conflict ตัวอื่นทุกประการ (markup, กฎข้อ 1/2 ฯลฯ): เมื่อ entry เดียวถูกปฏิเสธทั้งหมด
  // ไม่มี edits/inserts อะไรเลย newText จึงเป็น null (สัญญาณ "ห้ามเขียนไฟล์") ไม่ใช่ string เท่า src
  assert.strictEqual(out.newText, null, 'ห้ามแตะไฟล์เลยเมื่อคำถูกใช้ไม่ได้');
});

test('planWrite: คำผิดที่มีอัญประกาศคร่อม -> conflict ไม่เขียน', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: 'Playwright', forms: ['"PlayLight"'] }], {});
  assert.strictEqual(out.added.length, 0);
  assert.strictEqual(out.conflicts.length, 1);
  assert.strictEqual(out.newText, null);
});

test('planWrite: backtick คร่อมคำก็บล็อกเหมือนกัน', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: '`cheat sheet`', forms: ['cheatTangNiw'] }], {});
  assert.strictEqual(out.conflicts.length, 1);
  assert.strictEqual(out.newText, null);
});

test('planWrite: อัญประกาศกลางคำต้องผ่าน -- ชื่อจริงมี \' อยู่กลางคำได้', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: "O'Reilly", forms: ['OhRiley'] }], {});
  assert.strictEqual(out.conflicts.length, 0, "' กลางคำไม่ใช่ปัญหา");
  assert.strictEqual(out.added.length, 1);
  assert.ok(out.newText.includes("O'Reilly: OhRiley"));
});

// ===== EDGE_QUOTE_RE: ต้องกันทั้งสองขอบแยกกัน ไม่ใช่แค่เคสสมมาตร =====
// เดิมฟิกซ์เจอร์ทั้งหมด (Playwright/PlayLight/cheat sheet) มีอัญประกาศคร่อมทั้งสองข้าง --
// แทนที่ /^[...]|[...]$/ ด้วย /^[...]/ อย่างเดียว หรือ /[...]$/ อย่างเดียว เทสข้างบนก็ยังเขียวหมด
// เพราะ regex ทั้งคู่ยังจับได้ ต้องมีฟิกซ์เจอร์ที่มีอัญประกาศแค่ "ข้างเดียว" เพื่อพิสูจน์ anchor
// แต่ละตัวแยกจากกันจริง ๆ
test('planWrite: อัญประกาศ "หัว" อย่างเดียว (ไม่มีปิดท้าย) ก็ต้องถูกบล็อก -- พิสูจน์ anchor ^', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: '"HalfQuote', forms: ['HalfForm'] }], {});
  assert.strictEqual(out.conflicts.length, 1, 'อัญประกาศนำหน้าอย่างเดียวต้องโดน anchor ^ จับ');
  assert.strictEqual(out.newText, null);
});

test('planWrite: อัญประกาศ "ท้าย" อย่างเดียว (ไม่มีนำหน้า) ก็ต้องถูกบล็อก -- พิสูจน์ anchor $', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: 'TrailQuote"', forms: ['TrailForm'] }], {});
  assert.strictEqual(out.conflicts.length, 1, 'อัญประกาศตามหลังอย่างเดียวต้องโดน anchor $ จับ');
  assert.strictEqual(out.newText, null);
});

// ===== findUnsafeChar: '#' ที่ "ขึ้นต้น" ค่า (คนละเคสกับ " #" กลางคำ) =====
// src/glossary.py ข้ามทุกบรรทัดที่ trim() แล้วขึ้นต้นด้วย '#' ทิ้งเป็น comment (ไม่ใช่แค่
// inline comment กลางบรรทัดแบบที่ INLINE_COMMENT_RE / " #" เช็คอยู่แล้ว) -- ของเดิมเช็คแค่
// " #" (ต้องมีช่องว่างนำหน้า) เพื่อกัน C#/F# เลยปล่อย '#' ที่ขึ้นต้นค่าตรง ๆ ให้ผ่านไปได้
// เขียนแล้ว Python จะอ่านบรรทัดนั้นเป็น comment เงียบ ๆ แต่ UI รายงานว่า "เพิ่มใหม่" สำเร็จ
test('planWrite: คำถูกขึ้นต้นด้วย # -> conflict ไม่เขียน (Python จะข้ามทั้งบรรทัดเป็น comment)', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: '#redmine-support', forms: ['RedMind'] }], {});
  assert.strictEqual(out.added.length, 0);
  assert.strictEqual(out.conflicts.length, 1);
  assert.strictEqual(out.newText, null, 'ห้ามแตะไฟล์เลยเมื่อคำถูกขึ้นต้นด้วย #');
});

test('planWrite: คำผิดขึ้นต้นด้วย # -> conflict ไม่เขียน', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: 'Alpha', forms: ['#WZ'] }], {});
  assert.strictEqual(out.added.length, 0);
  assert.strictEqual(out.conflicts.length, 1);
  assert.strictEqual(out.newText, null);
});

test('planWrite: C# เป็นคำถูกยังใช้ได้ปกติ -- ไม่ใช่ # ขึ้นต้น ต้องไม่โดนบล็อก', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: 'C#', forms: ['CSharpLang'] }], {});
  assert.strictEqual(out.conflicts.length, 0, 'C# ต้องยังใช้งานได้ (# ไม่ได้อยู่ต้นคำ)');
  assert.strictEqual(out.added.length, 1);
  assert.ok(out.newText.includes('C#: CSharpLang'));
});

// ===== findUnsafeChar: ขยายคลาสตัวแบ่งบรรทัดให้ตรงกับ Python str.splitlines() =====
// splitlines() ของ Python ตัดบรรทัดที่ U+000B U+000C U+001C U+001D U+001E U+0085 U+2028 U+2029
// ด้วย ไม่ใช่แค่ CR/LF -- ค่าที่มีอักขระเหล่านี้ปนมา (วางจากคลิปบอร์ด) ผ่านการเช็คเดิมไปได้
// แต่ Python อ่านกลับมาเป็นค่าที่ถูกตัดครึ่งบวกบรรทัดแปลกปลอมอีกบรรทัด ทั้งที่ UI รายงานว่าสำเร็จ
// ทดสอบด้วย unicode escape ของ U+2028 ตรง ๆ ในสตริงเทส ไม่แปะอักขระดิบลงคอมเมนต์ -- ตัวอักขระ
// ดิบเป็น LineTerminator ของ ECMAScript เอง จะไปตัดคอมเมนต์ // กลางคันจนไฟล์ parse ไม่ผ่าน
test('planWrite: คำผิดมี \\u2028 (line separator ที่ splitlines() ของ Python ตัด) -> conflict ไม่เขียน', () => {
  const src = '## exact\nBill: Bin\n';
  const out = planWrite(src, [{ section: 'exact', term: 'Beta', forms: ['foo\u2028bar'] }], {});
  assert.strictEqual(out.added.length, 0);
  assert.strictEqual(out.conflicts.length, 1);
  assert.strictEqual(out.newText, null);
});
