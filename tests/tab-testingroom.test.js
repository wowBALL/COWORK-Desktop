'use strict';
// Testing Room — เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM (แบบเดียวกับ tab-grafana.js)
// พวกนี้คือที่เก็บกฎที่พลาดแล้วเงียบ: ข้อที่ข้ามต้องไม่ค้างเป็นงานที่ยังไม่เทส ·
// ใบเปล่าต้องไม่ขึ้นว่าเสร็จ · กดปุ่มผลซ้ำต้องถอนกลับได้
const test = require('node:test');
const assert = require('node:assert');
const { progressOf, sheetDone, applyAction, emptyItem, doneAtFor } = require('../tab-testingroom.js');

const TODAY = '2026-08-06';
const it = (by, result, date = '') => ({ title: 'x', by, result, cause: '', date, system: '', test: '', run: '', note: '' });

test('progressOf: นับ pass/fail/ค้าง/ข้าม แยกกัน', () => {
  assert.deepStrictEqual(
    progressOf([it('qa', 'pass'), it('auto', 'fail'), it('qa', '–'), it('ข้าม', '–')]),
    { total: 4, skipped: 1, active: 3, pass: 1, fail: 1, scriptFail: 0, unjudgedFail: 1, todo: 1 });
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
  const before = { title: 'x', by: 'auto', result: 'fail', cause: 'แอป', date: '2026-08-01', system: 'test-case', test: 't.spec.js', run: '20260727173450', note: 'n' };
  const after = applyAction(TODAY, before, 'ข้าม');
  // ระบบ/เทส เป็นการตั้งค่า ไม่ใช่ผล จึงต้องรอด — ส่วนสาเหตุเป็นคำตัดสินเรื่อง fail ต้องหายไปกับผล
  assert.deepStrictEqual(after, { title: 'x', by: 'ข้าม', result: '–', cause: '', date: '', system: 'test-case', test: 't.spec.js', run: '', note: 'n' });
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
  assert.deepStrictEqual(emptyItem(),
    { title: '', by: 'qa', result: '–', cause: '', date: '', system: '', test: '', run: '', note: '' });
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

// ---- สาเหตุที่ fail: สคริปเทสพัง หรือระบบพังจริง ----
const { applyCause, runPlan } = require('../tab-testingroom.js');
const fail = (by, cause = '') => ({ title: 'x', by, result: 'fail', cause, date: '2026-08-06', system: '', test: '', run: '', note: '' });

test('applyCause: ติดป้ายให้ข้อที่ fail', () => {
  assert.strictEqual(applyCause(fail('auto'), 'สคริป').cause, 'สคริป');
});
test('applyCause: กดซ้ำปุ่มเดิม = ถอนกลับเป็นยังไม่ได้ตรวจ', () => {
  // "ยังไม่ได้ตรวจ" ต้องกลับไปได้ ไม่ใช่ติดค้างเป็นคำตัดสินที่กดพลาด
  assert.strictEqual(applyCause(fail('auto', 'สคริป'), 'สคริป').cause, '');
});
test('applyCause: กดอีกปุ่ม = เปลี่ยนคำตัดสิน', () => {
  assert.strictEqual(applyCause(fail('auto', 'สคริป'), 'แอป').cause, 'แอป');
});
test('applyCause: ข้อที่ไม่ได้ fail ติดป้ายไม่ได้', () => {
  // สาเหตุบนข้อที่ผ่านแล้วคือข้อมูลลวง และมันไหลไปโผล่ใน Test Results ที่ dev อ่าน
  assert.strictEqual(applyCause(it('qa', 'pass'), 'แอป').cause, '');
});
test('applyCause: ไม่แก้ไอเทมเดิม', () => {
  const before = fail('auto');
  applyCause(before, 'แอป');
  assert.strictEqual(before.cause, '');
});

test('applyAction: เปลี่ยนผลจาก fail เป็นอย่างอื่น สาเหตุต้องหายตาม', () => {
  assert.strictEqual(applyAction(TODAY, fail('auto', 'สคริป'), 'pass').cause, '');
  assert.strictEqual(applyAction(TODAY, fail('auto', 'สคริป'), 'fail').cause, '');   // fail ซ้ำ = ถอนผล
});
test('applyAutoResult: ผลรอบใหม่มาแล้วต้องล้างคำตัดสินของรอบเก่า', () => {
  // ไม่งั้นข้อที่เคยตรวจว่า "สคริปพัง" จะยังติดป้ายนั้น ทั้งที่รอบใหม่อาจ fail ด้วยเหตุอื่น
  const after = applyAutoResult(fail('auto', 'สคริป'), { run: '20260807', status: 'FAIL', startedAt: '2026-08-07T01:00:00Z' });
  assert.strictEqual(after.cause, '');
  assert.strictEqual(after.date, '2026-08-07');
});

test('progressOf: แยก fail ที่เป็นสคริป กับ fail ที่ยังไม่มีใครตรวจ', () => {
  const p = progressOf([fail('auto', 'สคริป'), fail('auto', 'แอป'), fail('auto'), fail('qa')]);
  assert.strictEqual(p.fail, 4);
  assert.strictEqual(p.scriptFail, 1);
  // qa fail ไม่เข้ากอง "รอตรวจ" — ข้อที่คนทดสอบเองแล้วไม่ผ่าน ไม่มีคำถามว่าสคริปพังไหม
  assert.strictEqual(p.unjudgedFail, 1);
});

// ---- ลำดับการรัน ----
const SOURCES = [
  { label: 'test-case', path: 'D:/COWORK/test-case', tests: ['dine-in-tyro.spec.js', 'ซ้ำ.js'] },
  { label: 'Test-case-mobile', path: 'D:/COWORK/Test-case-mobile/appium-bluestacks', tests: ['zinga-food.js', 'ซ้ำ.js'] },
];
const autoIt = (test, system) => ({ title: 't', by: 'auto', result: '–', cause: '', date: '', system, test, run: '', note: '' });

test('runPlan: เรียงตามลำดับข้อในใบ และรายงานข้อที่ข้าม', () => {
  // ชุดที่หายไปเงียบ ๆ ทำให้เข้าใจว่ารันครบ ทั้งที่ยังมีข้อที่ลืมผูกไฟล์
  const plan = runPlan([
    it('qa', '–'),
    autoIt('dine-in-tyro.spec.js', 'test-case'),
    autoIt('', 'test-case'),
    autoIt('zinga-food.js', 'Test-case-mobile'),
  ], SOURCES);
  assert.deepStrictEqual(plan.steps.map(s => s.n), [2, 4]);
  assert.deepStrictEqual(plan.skipped, [1, 3]);
});

test('runPlan: .spec.js ได้คำสั่ง Playwright · ที่เหลือบอกให้ไปกด run-test.bat เอง', () => {
  // run-test.bat เป็นเมนูตัวเลข ไม่รับชื่อไฟล์เป็น argument จึงแต่งคำสั่งให้ก๊อปไม่ได้
  const [pw, mob] = runPlan([autoIt('dine-in-tyro.spec.js', 'test-case'), autoIt('zinga-food.js', 'Test-case-mobile')], SOURCES).steps;
  assert.strictEqual(pw.cmd, 'npx playwright test dine-in-tyro.spec.js');
  assert.strictEqual(pw.cwd, 'D:/COWORK/test-case');
  assert.strictEqual(mob.cmd, '');
  assert.match(mob.manual, /run-test\.bat/);
  assert.strictEqual(mob.cwd, 'D:/COWORK/Test-case-mobile/appium-bluestacks');
});

test('runPlan: ใบเก่าที่ไม่มีระบบ เติมให้เมื่อค้นเจอแหล่งเดียว', () => {
  const [s] = runPlan([autoIt('zinga-food.js', '')], SOURCES).steps;
  assert.strictEqual(s.system, 'Test-case-mobile');
  assert.strictEqual(s.filled, true);
  assert.strictEqual(s.warn, '');
});
test('runPlan: ชื่อไฟล์ซ้ำสองแหล่ง = บอกว่ากำกวม ไม่หยิบอันแรกมาเดา', () => {
  // เดาผิดแล้วจะไปรันเทสคนละตัวกับที่ตั้งใจ โดยที่ผลดูเหมือนถูกต้อง
  const [s] = runPlan([autoIt('ซ้ำ.js', '')], SOURCES).steps;
  assert.strictEqual(s.cmd, '');
  assert.match(s.warn, /หลายระบบ/);
});
test('runPlan: ระบบที่ถูกลบ/เปลี่ยนชื่อไปแล้ว บอกตรง ๆ ไม่เงียบ', () => {
  const [s] = runPlan([autoIt('dine-in-tyro.spec.js', 'ของเก่า')], SOURCES).steps;
  assert.match(s.warn, /ไม่รู้จักระบบ/);
});
test('runPlan: หาไฟล์ไม่เจอในโฟลเดอร์ไหนเลย', () => {
  const [s] = runPlan([autoIt('หายไปแล้ว.js', '')], SOURCES).steps;
  assert.match(s.warn, /ไม่เจอ/);
});
test('runPlan: ไม่มี source เลย (ยังไม่ตั้งค่า) ไม่โยน', () => {
  const [s] = runPlan([autoIt('a.spec.js', '')], []).steps;
  assert.strictEqual(s.cmd, '');
  assert.ok(s.warn);
});

test('runPlan: กด ▶ รัน รายข้อ ต้องโชว์เลขข้อจริงในใบ ไม่ใช่นับใหม่จาก 1', () => {
  // โชว์ "1." ให้ข้อที่ 3 = QA ไล่หาไม่เจอว่าตรงกับข้อไหนในใบ
  const items = [it('qa', '–'), autoIt('a.spec.js', 'test-case'), autoIt('zinga-food.js', 'Test-case-mobile')];
  const plan = runPlan(items, SOURCES, items[2]);
  assert.deepStrictEqual(plan.steps.map(s => s.n), [3]);
  assert.deepStrictEqual(plan.skipped, []);   // รายข้อไม่ต้องรายงานว่าข้ามข้ออื่น
});
