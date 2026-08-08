const test = require('node:test');
const assert = require('node:assert');
const core = require('../friday.js');

const ready = (companion) => ({ ready: true, state: { recorder: 'idle', companion } });
const OFF = { state: 'off', can_start: true, blocked_by: null };
const BUSY = { state: 'off', can_start: false, blocked_by: 'gpu_busy' };
const NONE = { state: 'off', can_start: false, blocked_by: 'not_configured' };
const ON = { state: 'running', can_start: false, blocked_by: null };

test('ซ่อนไปเลยเมื่อยังไม่รู้จัก service', () => {
  assert.strictEqual(core.viewOf(null, null, 0).hidden, true);
  assert.strictEqual(core.viewOf({ ready: false, state: null }, null, 0).hidden, true);
  assert.strictEqual(core.viewOf({ ready: true, state: null }, null, 0).hidden, true);
});

test('ซ่อนไปเลยเมื่อเครื่องนี้ไม่ได้ตั้งค่า companion', () => {
  assert.strictEqual(core.viewOf(ready(NONE), null, 0).hidden, true);
  assert.strictEqual(core.viewOf(ready(undefined), null, 0).hidden, true);
});

test('ปิดอยู่และเปิดได้', () => {
  const v = core.viewOf(ready(OFF), null, 0);
  assert.deepStrictEqual(
    { hidden: v.hidden, cls: v.cls, action: v.action, enabled: v.enabled },
    { hidden: false, cls: 'off', action: 'start', enabled: true });
  assert.match(v.label, /Friday/);
});

test('การ์ดจอไม่ว่าง กดไม่ได้ และบอกเหตุผล', () => {
  const v = core.viewOf(ready(BUSY), null, 0);
  assert.strictEqual(v.cls, 'blocked');
  assert.strictEqual(v.action, 'none');
  assert.strictEqual(v.enabled, false);
  assert.match(v.label, /ถอดเสียง/);
});

test('ฟังอยู่ กดแล้วเข้าโหมดยืนยัน ไม่ใช่ปิดทันที', () => {
  const v = core.viewOf(ready(ON), null, 0);
  assert.strictEqual(v.cls, 'on');
  assert.strictEqual(v.action, 'confirm');
  assert.strictEqual(v.enabled, true);
});

test('โหมดยืนยันโผล่แล้วหมดอายุเอง', () => {
  const pending = { kind: 'confirm', at: 1000 };
  const during = core.viewOf(ready(ON), pending, 1000 + core.PENDING_MS.confirm - 1);
  assert.strictEqual(during.cls, 'confirm');
  assert.strictEqual(during.action, 'stop');
  assert.match(during.label, /อีกครั้ง/);

  const after = core.viewOf(ready(ON), pending, 1000 + core.PENDING_MS.confirm + 1);
  assert.strictEqual(after.cls, 'on');
  assert.strictEqual(after.action, 'confirm');
});

test('โหมดยืนยันหายทันทีถ้ามันดับไปเองระหว่างนั้น', () => {
  const pending = { kind: 'confirm', at: 1000 };
  assert.strictEqual(core.viewOf(ready(OFF), pending, 1001).cls, 'off');
});

test('กำลังเปิด แสดงจนกว่าเซิร์ฟเวอร์จะยืนยันว่ารันแล้ว', () => {
  const pending = { kind: 'starting', at: 0 };
  assert.strictEqual(core.viewOf(ready(OFF), pending, 100).cls, 'starting');
  assert.strictEqual(core.viewOf(ready(OFF), pending, 100).action, 'none');
  assert.strictEqual(core.viewOf(ready(ON), pending, 100).cls, 'on');
});

test('กำลังเปิด ไม่ค้างตลอดกาลถ้าไม่มีอะไรยืนยัน', () => {
  const pending = { kind: 'starting', at: 0 };
  assert.strictEqual(core.viewOf(ready(OFF), pending, core.PENDING_MS.starting + 1).cls, 'off');
});

test('เปิดไม่สำเร็จ แสดงชั่วคราวแล้วกลับไปกดใหม่ได้', () => {
  const pending = { kind: 'failed', at: 0 };
  const during = core.viewOf(ready(OFF), pending, 10);
  assert.strictEqual(during.cls, 'failed');
  assert.match(during.label, /ไม่สำเร็จ/);
  assert.strictEqual(during.action, 'start');

  assert.strictEqual(core.viewOf(ready(OFF), pending, core.PENDING_MS.failed + 1).cls, 'off');
});

test('mount ไม่โยนเมื่อไม่มี DOM และไม่มี api', () => {
  assert.doesNotThrow(() => core.mount(null));
});
