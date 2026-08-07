'use strict';
// ชุดเทสระบบ — ใบเทสที่ไม่ผูกกับ issue ไหน ไว้รัน regression ซ้ำได้ทุกเมื่อ
// โครงไฟล์เดียวกับใบของงานเป๊ะ (ใบเทส = ใบสั่งรัน ตั้งแต่เฟส 4) ตรงนี้เทสเฉพาะส่วนที่ต่าง
const test = require('node:test');
const assert = require('node:assert');
const { systemSlug, nextSystemName, systemItemsFrom, serializeQtest, parseQtest } = require('../testingroom.js');
require('../util.js');
const { isSystemSheet, sheetTitle, autoLinked } = require('../tab-testingroom.js');

test('systemSlug: ตัดเฉพาะอักขระที่ Windows ห้ามในชื่อไฟล์ ภาษาไทยรอด', () => {
  assert.strictEqual(systemSlug('Regression ก่อน deploy: อาหาร/ทุกช่องทาง'),
    'Regression ก่อน deploy อาหารทุกช่องทาง');
  assert.strictEqual(systemSlug('a\\b*c?d"e<f>g|h'), 'abcdefgh');
});
test('systemSlug: ชื่อว่างได้ค่าเริ่มต้น ไม่ใช่ไฟล์ชื่อ .md เปล่า', () => {
  assert.strictEqual(systemSlug(''), 'ชุดระบบ');
  assert.strictEqual(systemSlug('  ??  '), 'ชุดระบบ');
  assert.strictEqual(systemSlug(null), 'ชุดระบบ');
});
test('systemSlug: ตัด . กับช่องว่างท้ายชื่อ', () => {
  // Windows ตัดให้เองเงียบ ๆ อยู่แล้ว ตัดเองก่อนจะได้ชื่อไฟล์ตรงกับที่คิดไว้
  assert.strictEqual(systemSlug('ชุด A. '), 'ชุด A');
});

test('nextSystemName: ขึ้นต้นด้วย system- เพื่อให้เรียงมาก่อนใบของงาน', () => {
  // listQtests เรียงชื่อไฟล์จากมากไปน้อย ใบของงานขึ้นต้นด้วยปี (2026…) จึงมาทีหลัง
  const name = nextSystemName([], 'Smoke');
  assert.strictEqual(name, 'system-Smoke.md');
  assert.ok(name.localeCompare('20260807-690.md') > 0);
});
test('nextSystemName: ชื่อซ้ำเติมเลขต่อท้าย ไม่ทับของเดิม', () => {
  // ชุด regression ที่สะสมมานานถูกทับ = ความเสียหายที่กู้ไม่ได้
  assert.strictEqual(nextSystemName(['system-Smoke.md'], 'Smoke'), 'system-Smoke-2.md');
  assert.strictEqual(nextSystemName(['system-Smoke.md', 'system-Smoke-2.md'], 'Smoke'), 'system-Smoke-3.md');
});

test('systemItemsFrom: เอาเฉพาะข้อ auto ที่ผูกไฟล์แล้ว', () => {
  const items = [
    { title: 'ก', by: 'auto', result: 'pass', system: 'w', test: 'a.spec.js' },
    { title: 'ข', by: 'qa', result: 'pass' },
    { title: 'ค', by: 'auto', result: '–', test: '' },
    { title: 'ง', by: 'ข้าม', result: '–', test: 'b.js' },
  ];
  assert.deepStrictEqual(systemItemsFrom(items).map(i => i.title), ['ก']);
});
test('systemItemsFrom: ล้างผล/สาเหตุ/วันที่/run ทิ้ง แต่เก็บระบบกับไฟล์ไว้', () => {
  // ชุดที่เพิ่งสร้างยังไม่เคยรัน ยกผลเก่ามาด้วย = โกหกว่าชุดนี้เคยผ่านแล้ว
  // ส่วน ระบบ/เทส เป็นการตั้งค่า ไม่ใช่ผล ต้องติดมาไม่งั้นต้องมานั่งผูกไฟล์ใหม่ทุกข้อ
  const [it] = systemItemsFrom([{
    title: 'ก', by: 'auto', result: 'fail', cause: 'สคริป', date: '2026-08-01',
    system: 'Zinga web', test: 'a.spec.js', run: 'r1', note: 'พังตรงจ่ายเงิน',
  }]);
  assert.deepStrictEqual(it, {
    title: 'ก', by: 'auto', result: '–', cause: '', date: '',
    system: 'Zinga web', test: 'a.spec.js', run: '', note: '',
  });
});
test('systemItemsFrom: รับค่าที่ไม่ใช่ array ได้โดยไม่โยน', () => {
  assert.deepStrictEqual(systemItemsFrom(null), []);
  assert.deepStrictEqual(systemItemsFrom([null, undefined]), []);
});

test('isSystemSheet / sheetTitle: แยกใบระบบออกจากใบของงาน', () => {
  const sys = { meta: { kind: 'system', name: 'Regression ก่อน deploy' } };
  const work = { meta: { issue: 690, subject: 'sidebar ว่าง' } };
  assert.strictEqual(isSystemSheet(sys), true);
  assert.strictEqual(isSystemSheet(work), false);
  assert.strictEqual(isSystemSheet(null), false);
  assert.strictEqual(sheetTitle(sys), 'Regression ก่อน deploy');
  assert.strictEqual(sheetTitle(work), 'sidebar ว่าง');
});
test('sheetTitle: ใบที่ไม่มีชื่อยังอ่านออกว่าเป็นอะไร ไม่ใช่ช่องว่าง', () => {
  assert.strictEqual(sheetTitle({ meta: { kind: 'system' } }), '(ชุดระบบไม่มีชื่อ)');
  assert.strictEqual(sheetTitle({ meta: {} }), '(ไม่มีหัวเรื่อง)');
});

test('ใบระบบ round-trip ผ่านไฟล์ได้เหมือนใบของงาน', () => {
  // ใช้ serializer/parser ตัวเดียวกัน ถ้า kind/name หายไปตอนบันทึกทับ ใบจะกลายเป็นใบของงาน
  // ที่ไม่มีเลข issue ซึ่งจะไปโผล่ผิดหมวดในลิสต์และมีปุ่มจบงานที่กดแล้วพัง
  const sheet = {
    meta: { qtest: 1, kind: 'system', name: 'Smoke ประจำเช้า', createdAt: '2026-08-07', status: 'open' },
    items: systemItemsFrom([{ title: 'ก', by: 'auto', result: 'pass', system: 'w', test: 'a.spec.js' }]),
    notes: '',
  };
  const back = parseQtest(serializeQtest(sheet));
  assert.strictEqual(back.meta.kind, 'system');
  assert.strictEqual(back.meta.name, 'Smoke ประจำเช้า');
  assert.strictEqual(isSystemSheet(back), true);
  assert.strictEqual(back.items[0].test, 'a.spec.js');
});

test('autoLinked: นับด้วยเกณฑ์เดียวกับ systemItemsFrom เป๊ะ', () => {
  // หน้าจอบอกว่าจะคัดลอก 3 ข้อแล้วได้จริง 2 = ผู้ใช้เข้าใจผิดว่าชุดครบทั้งที่ขาด
  const items = [
    { title: 'ก', by: 'auto', test: 'a.spec.js' },
    { title: 'ข', by: 'qa', test: '' },
    { title: 'ค', by: 'auto', test: '' },
    { title: 'ง', by: 'ข้าม', test: 'b.js' },
    null,
  ];
  assert.strictEqual(autoLinked(items).length, systemItemsFrom(items).length);
  assert.strictEqual(autoLinked(items).length, 1);
});
test('autoLinked: รับค่าที่ไม่ใช่ array ได้', () => {
  assert.deepStrictEqual(autoLinked(null), []);
});
