'use strict';
// Testing Room — เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM (แบบเดียวกับ tab-grafana.js)
// พวกนี้คือที่เก็บกฎที่พลาดแล้วเงียบ: ข้อที่ข้ามต้องไม่ค้างเป็นงานที่ยังไม่เทส ·
// ใบเปล่าต้องไม่ขึ้นว่าเสร็จ · กดปุ่มผลซ้ำต้องถอนกลับได้
const test = require('node:test');
const assert = require('node:assert');
const { progressOf, sheetDone, applyAction, emptyItem } = require('../tab-testingroom.js');

const it = (by, result) => ({ title: 'x', by, result, run: '', note: '' });

test('progressOf: นับ pass/fail/ค้าง/ข้าม แยกกัน', () => {
  assert.deepStrictEqual(
    progressOf([it('qa', 'pass'), it('auto', 'fail'), it('qa', '–'), it('ข้าม', '–')]),
    { total: 4, skipped: 1, active: 3, pass: 1, fail: 1, todo: 1 });
});
test('progressOf: ข้อที่ข้ามไม่ถูกนับเป็นงานค้าง', () => {
  // ไม่งั้นใบที่ตัดสินใจข้ามข้อที่เหลือแล้วจะไม่มีวันเสร็จ
  assert.strictEqual(progressOf([it('qa', 'pass'), it('ข้าม', '–'), it('ข้าม', '–')]).todo, 0);
});
test('progressOf: รับค่าที่ไม่ใช่ array ได้โดยไม่โยน', () => {
  assert.strictEqual(progressOf(null).total, 0);
  assert.strictEqual(progressOf(undefined).active, 0);
});

test('sheetDone: ทุกข้อที่ไม่ข้ามมีผลแล้ว = เสร็จ', () => {
  assert.strictEqual(sheetDone([it('qa', 'pass'), it('auto', 'fail'), it('ข้าม', '–')]), true);
});
test('sheetDone: เหลือข้อที่ยังไม่มีผล = ยังไม่เสร็จ', () => {
  assert.strictEqual(sheetDone([it('qa', 'pass'), it('qa', '–')]), false);
});
test('sheetDone: ใบเปล่าและใบที่ข้ามหมด ไม่นับว่าเสร็จ', () => {
  // ใบที่เพิ่งสร้างยังไม่มีข้อ ต้องไม่ขึ้นป้าย "เสร็จ" ตั้งแต่วินาทีแรก
  assert.strictEqual(sheetDone([]), false);
  assert.strictEqual(sheetDone([it('ข้าม', '–'), it('ข้าม', '–')]), false);
});
test('sheetDone: มี fail ก็ถือว่าเทสครบแล้ว', () => {
  // "เสร็จ" คือเทสครบ ไม่ใช่ผ่านหมด — งานที่ fail คือผลที่สมบูรณ์แล้วเหมือนกัน
  assert.strictEqual(sheetDone([it('qa', 'fail')]), true);
});

test('applyAction: กดผลใส่ข้อที่ยังไม่เทส', () => {
  assert.strictEqual(applyAction(it('qa', '–'), 'pass').result, 'pass');
});
test('applyAction: กดซ้ำปุ่มเดิม = ถอนกลับเป็นยังไม่เทส', () => {
  assert.strictEqual(applyAction(it('qa', 'pass'), 'pass').result, '–');
});
test('applyAction: กดอีกปุ่ม = เปลี่ยนผล ไม่ใช่ถอน', () => {
  assert.strictEqual(applyAction(it('qa', 'pass'), 'fail').result, 'fail');
});
test('applyAction: กดข้าม ล้างผลและเลข run ทิ้ง', () => {
  const before = { title: 'x', by: 'auto', result: 'pass', run: '20260727173450', note: 'n' };
  const after = applyAction(before, 'ข้าม');
  assert.deepStrictEqual(after, { title: 'x', by: 'ข้าม', result: '–', run: '', note: 'n' });
});
test('applyAction: กดข้ามซ้ำ = เลิกข้าม กลับมาเป็น qa', () => {
  assert.strictEqual(applyAction(it('ข้าม', '–'), 'ข้าม').by, 'qa');
});
test('applyAction: ให้ผลกับข้อที่ข้ามอยู่ = เลิกข้ามไปในตัว', () => {
  const after = applyAction(it('ข้าม', '–'), 'pass');
  assert.strictEqual(after.by, 'qa');
  assert.strictEqual(after.result, 'pass');
});
test('applyAction: ไม่แก้ไอเทมเดิม', () => {
  const before = it('qa', '–');
  applyAction(before, 'fail');
  assert.strictEqual(before.result, '–');
});

test('emptyItem: ข้อใหม่เริ่มที่ qa และยังไม่มีผล', () => {
  assert.deepStrictEqual(emptyItem(), { title: '', by: 'qa', result: '–', run: '', note: '' });
});
