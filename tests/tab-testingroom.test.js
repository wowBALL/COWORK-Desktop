'use strict';
// Testing Room — เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM (แบบเดียวกับ tab-grafana.js)
// พวกนี้คือที่เก็บกฎที่พลาดแล้วเงียบ: ข้อที่ข้ามต้องไม่ค้างเป็นงานที่ยังไม่เทส ·
// ใบเปล่าต้องไม่ขึ้นว่าเสร็จ · กดปุ่มผลซ้ำต้องถอนกลับได้
const test = require('node:test');
const assert = require('node:assert');
const { progressOf, sheetDone, applyAction, emptyItem, doneAtFor } = require('../tab-testingroom.js');

const TODAY = '2026-08-06';
const it = (by, result, date = '') => ({ title: 'x', by, result, date, run: '', note: '' });

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
  assert.strictEqual(applyAction(TODAY, it('qa', '–'), 'pass').result, 'pass');
});
test('applyAction: กดซ้ำปุ่มเดิม = ถอนกลับเป็นยังไม่เทส', () => {
  assert.strictEqual(applyAction(TODAY, it('qa', 'pass'), 'pass').result, '–');
});
test('applyAction: กดอีกปุ่ม = เปลี่ยนผล ไม่ใช่ถอน', () => {
  assert.strictEqual(applyAction(TODAY, it('qa', 'pass'), 'fail').result, 'fail');
});
test('applyAction: กดข้าม ล้างผล/วันที่/เลข run ทิ้ง', () => {
  const before = { title: 'x', by: 'auto', result: 'pass', date: '2026-08-01', run: '20260727173450', note: 'n' };
  const after = applyAction(TODAY, before, 'ข้าม');
  assert.deepStrictEqual(after, { title: 'x', by: 'ข้าม', result: '–', date: '', run: '', note: 'n' });
});
test('applyAction: กดข้ามซ้ำ = เลิกข้าม กลับมาเป็น qa', () => {
  assert.strictEqual(applyAction(TODAY, it('ข้าม', '–'), 'ข้าม').by, 'qa');
});
test('applyAction: ให้ผลกับข้อที่ข้ามอยู่ = เลิกข้ามไปในตัว', () => {
  const after = applyAction(TODAY, it('ข้าม', '–'), 'pass');
  assert.strictEqual(after.by, 'qa');
  assert.strictEqual(after.result, 'pass');
});
test('applyAction: ไม่แก้ไอเทมเดิม', () => {
  const before = it('qa', '–');
  applyAction(TODAY, before, 'fail');
  assert.strictEqual(before.result, '–');
});

test('emptyItem: ข้อใหม่เริ่มที่ qa และยังไม่มีผล', () => {
  assert.deepStrictEqual(emptyItem(), { title: '', by: 'qa', result: '–', date: '', test: '', run: '', note: '' });
});

// ---- วันที่ที่ทดสอบ (แยกรายข้อ) ----

test('applyAction: ให้ผล = ประทับวันที่ของข้อนั้น', () => {
  assert.strictEqual(applyAction(TODAY, it('qa', '–'), 'pass').date, TODAY);
  assert.strictEqual(applyAction(TODAY, it('qa', '–'), 'fail').date, TODAY);
});
test('applyAction: เปลี่ยนผล = ประทับวันที่ใหม่ทับ', () => {
  // เทสซ้ำแล้วผลเปลี่ยน วันที่ต้องเป็นวันที่เทสรอบล่าสุด ไม่ใช่วันที่บันทึกครั้งแรก
  assert.strictEqual(applyAction(TODAY, it('qa', 'fail', '2026-08-01'), 'pass').date, TODAY);
});
test('applyAction: ถอนผล = ล้างวันที่ทิ้ง', () => {
  // ข้อที่ยังไม่ได้เทสต้องไม่มีวันที่ค้าง ไม่งั้นดูเผิน ๆ เหมือนเทสไปแล้ว
  assert.strictEqual(applyAction(TODAY, it('qa', 'pass', '2026-08-01'), 'pass').date, '');
});

test('doneAtFor: ใบที่เทสครบ = วันที่ของข้อที่เทสหลังสุด', () => {
  assert.strictEqual(doneAtFor([
    it('qa', 'pass', '2026-08-01'), it('auto', 'fail', '2026-08-06'), it('ข้าม', '–'),
  ]), '2026-08-06');
});
test('doneAtFor: ใบที่ยังเทสไม่ครบ = ว่าง', () => {
  assert.strictEqual(doneAtFor([it('qa', 'pass', '2026-08-01'), it('qa', '–')]), '');
});
test('doneAtFor: ใบเปล่า/ข้ามหมด = ว่าง', () => {
  assert.strictEqual(doneAtFor([]), '');
  assert.strictEqual(doneAtFor([it('ข้าม', '–')]), '');
});
test('doneAtFor: ครบแต่ไม่มีวันที่เลย (ใบเก่า/แก้มือ) = ว่าง ไม่ใช่เดาวันให้', () => {
  // เดาวันที่ให้เท่ากับโกหก — ปล่อยว่างแล้วผู้ใช้เติมเองได้ ดีกว่าเห็นวันที่ที่ไม่เคยเกิดขึ้น
  assert.strictEqual(doneAtFor([it('qa', 'pass'), it('qa', 'fail')]), '');
});

// ---- ดึงผลจากชุดเทสอัตโนมัติ ----
const { applyAutoResult, autoSummary } = require('../tab-testingroom.js');

const auto = (test, extra = {}) => ({ title: 'x', by: 'auto', result: '–', date: '', test, run: '', note: '', ...extra });

test('applyAutoResult: PASS เติมผล วันที่ และเลข run', () => {
  const r = applyAutoResult(auto('a.js'), { run: '20260727173450', status: 'PASS', startedAt: '2026-07-27 17:34:50' });
  assert.strictEqual(r.result, 'pass');
  assert.strictEqual(r.date, '2026-07-27');   // วันที่ที่รันจริง ไม่ใช่วันที่กดดึง
  assert.strictEqual(r.run, '20260727173450');
});
test('applyAutoResult: FAIL เติมเป็น fail', () => {
  assert.strictEqual(applyAutoResult(auto('a.js'), { run: 'r1', status: 'FAIL', startedAt: '2026-07-27 17:34:50' }).result, 'fail');
});
test('applyAutoResult: CRASH เก็บเลข run แต่ไม่ตัดสินผล', () => {
  // run ที่ตายกลางคันไม่ได้บอกว่าระบบผิดหรือถูก — เติมเป็น fail จะปนปัญหา BlueStacks/เน็ต
  // เข้ากับบั๊กจริง แต่ยังเก็บเลข run ไว้ให้กดไปดู log ได้ว่าตายตรงไหน
  const r = applyAutoResult(auto('a.js', { result: 'pass', date: '2026-08-01' }), { run: 'r9', status: 'CRASH', startedAt: '2026-08-06 09:00:00' });
  assert.strictEqual(r.result, '–');
  assert.strictEqual(r.date, '');
  assert.strictEqual(r.run, 'r9');
});
test('applyAutoResult: ไม่มีผลรัน = ไม่แตะอะไรเลย', () => {
  const before = auto('a.js', { result: 'pass', date: '2026-08-01', run: 'r1' });
  assert.deepStrictEqual(applyAutoResult(before, null), before);
});
test('applyAutoResult: ไม่แก้ไอเทมเดิม', () => {
  const before = auto('a.js');
  applyAutoResult(before, { run: 'r1', status: 'PASS', startedAt: '2026-07-27 17:34:50' });
  assert.strictEqual(before.run, '');
});

test('autoSummary: แยกจำนวนเติมได้ / รันไม่จบ / ยังไม่เคยรัน / ยังไม่ผูกไฟล์', () => {
  const items = [
    auto('a.js'), auto('b.js'), auto('c.js'), auto(''),
    { title: 'y', by: 'qa', result: '–', date: '', test: '', run: '', note: '' },
  ];
  const res = { 'a.js': { status: 'PASS' }, 'b.js': { status: 'CRASH' } };
  assert.deepStrictEqual(autoSummary(items, res), { filled: 1, crashed: 1, missing: 1, unlinked: 1 });
});
test('autoSummary: ข้อที่ข้ามอยู่ไม่ถูกนับ แม้จะผูกไฟล์ไว้', () => {
  const items = [{ title: 'x', by: 'ข้าม', result: '–', date: '', test: 'a.js', run: '', note: '' }];
  assert.deepStrictEqual(autoSummary(items, { 'a.js': { status: 'PASS' } }), { filled: 0, crashed: 0, missing: 0, unlinked: 0 });
});
