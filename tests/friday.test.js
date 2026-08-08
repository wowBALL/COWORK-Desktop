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
  const pending = { kind: 'failed', at: 0, action: 'start' };
  const during = core.viewOf(ready(OFF), pending, 10);
  assert.strictEqual(during.cls, 'failed');
  assert.match(during.label, /ไม่สำเร็จ/);
  assert.strictEqual(during.action, 'start');

  assert.strictEqual(core.viewOf(ready(OFF), pending, core.PENDING_MS.failed + 1).cls, 'off');
});

test('เปิดไม่สำเร็จ หายทันทีถ้าเซิร์ฟเวอร์ยืนยันว่ารันอยู่แล้ว', () => {
  // เหมือนเทส 'starting' หายทันทีเมื่อรันจริง (ข้อ 62) แต่ครอบ branch 'failed'
  // ที่มี guard !running เดียวกัน ยังไม่เคยมีเทสตรง ๆ มาก่อน
  const pending = { kind: 'failed', at: 0, action: 'start' };
  assert.strictEqual(core.viewOf(ready(ON), pending, 10).cls, 'on');
});

test('ปิดไม่สำเร็จ แสดงป้ายเตือนและเสนอปิดใหม่ ไม่ใช่เปิด', () => {
  const pending = { kind: 'failed', at: 0, action: 'stop' };
  const v = core.viewOf(ready(ON), pending, 10);
  assert.strictEqual(v.cls, 'failed');
  assert.match(v.label, /ปิดไม่สำเร็จ/);
  assert.strictEqual(v.action, 'stop');
  assert.strictEqual(v.enabled, true);
});

test('ปิดไม่สำเร็จ หายไปถ้าจริง ๆ มันหยุดไปแล้ว', () => {
  const pending = { kind: 'failed', at: 0, action: 'stop' };
  assert.strictEqual(core.viewOf(ready(OFF), pending, 10).cls, 'off');
});

test('mount ไม่โยนเมื่อไม่มี DOM และไม่มี api', () => {
  assert.doesNotThrow(() => core.mount(null));
});

// ---- state machine ของ onClick/onData (DOM half) --------------------------
// mount(node, fakeApi) รับ api ปลอมพารามิเตอร์ที่สองเพื่อยิงเทสได้โดยไม่ต้องพึ่ง
// window.cowork -- node ปลอมเป็น object ธรรมดา draw() แค่ set property ไม่แตะ
// DOM API จริงเลย จึงพอ

const fakeNode = () => ({ className: '', innerHTML: '', title: '', onclick: null });

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// รอ microtask queue ระบายจนกว่า .then() ที่ onClick ผูกไว้จะได้รันจริง
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test('เปิดสำเร็จ ป้ายค้างที่ starting จนกว่า onData จะยืนยันว่า running (Finding 1)', async () => {
  const node = fakeNode();
  const d = deferred();
  const api = { startFriday: () => d.promise, stopFriday: () => Promise.resolve({ ok: true }) };
  core.mount(node, api);
  core.onData(ready(OFF));

  node.onclick(); // กดเปิด
  assert.match(node.className, /starting/, 'กดแล้วต้องขึ้น starting ทันทีก่อนรอ HTTP');

  d.resolve({ ok: true }); // เซิร์ฟเวอร์ตอบ 201 -- ต้อง "ไม่" เคลียร์ pending ตรงนี้
  await flush();
  assert.match(node.className, /starting/,
    'HTTP 201 อย่างเดียวต้องไม่ทำให้ป้ายกลับไป off -- ต้องรอ payload ที่ state:running จริง');

  core.onData(ready(ON)); // poll รอบถัดไปยืนยันว่ารันแล้ว
  assert.match(node.className, /(^| )fridaypill on( |$)/, 'พอ payload ยืนยัน running ป้ายต้องเปลี่ยนเป็น on');
});

test('เปิดไม่สำเร็จ ขึ้นป้ายแดงฝั่งเปิด', async () => {
  const node = fakeNode();
  const api = { startFriday: () => Promise.resolve({ ok: false, error: 'gpu_busy' }) };
  core.mount(node, api);
  core.onData(ready(OFF));

  node.onclick();
  await flush();
  assert.match(node.className, /failed/);
  assert.match(node.innerHTML, /ไม่สำเร็จ/);
});

test('คลิกครั้งแรกตอนฟังอยู่ เข้าโหมดยืนยัน ไม่เรียก stopFriday', () => {
  const node = fakeNode();
  let stopCalls = 0;
  const api = { stopFriday: () => { stopCalls += 1; return Promise.resolve({ ok: true }); } };
  core.mount(node, api);
  core.onData(ready(ON));

  node.onclick();
  assert.match(node.className, /confirm/);
  assert.strictEqual(stopCalls, 0);
});

test('คลิกซ้ำในหน้าต่างยืนยัน เรียก stopFriday ครั้งเดียว', () => {
  const node = fakeNode();
  let stopCalls = 0;
  const api = { stopFriday: () => { stopCalls += 1; return Promise.resolve({ ok: true }); } };
  core.mount(node, api);
  core.onData(ready(ON));

  node.onclick(); // arm confirm
  node.onclick(); // ยิงจริง
  assert.strictEqual(stopCalls, 1);
});

test('ปิดไม่สำเร็จ ขึ้นป้ายแดงฝั่งปิด เสนอปิดซ้ำ', async () => {
  const node = fakeNode();
  const api = { stopFriday: () => Promise.resolve({ ok: false, error: 'unreachable' }) };
  core.mount(node, api);
  core.onData(ready(ON));

  node.onclick(); // arm confirm
  node.onclick(); // ยิงจริง -> ล้มเหลว
  await flush();
  assert.match(node.className, /failed/);
  assert.match(node.innerHTML, /ปิดไม่สำเร็จ/);
});

test('onData รายงาน running ล้าง pending starting ที่มีชีวิตอยู่', () => {
  // viewOf เองมีเกราะ !running กันไม่ให้โชว์ 'starting' ตอนที่รันอยู่แล้วอยู่แล้ว
  // (ดูคอมเมนต์ในตัว viewOf) เกราะนั้นบังบั๊กจริงที่ onData ต้องแก้: ถ้า pending
  // 'starting' ไม่ถูกเคลียร์ทิ้งตอนเห็น running มันจะ "ฟื้น" ขึ้นมาอีกครั้งถ้ารอบ
  // poll ถัดไปเห็น off (เช่นโปรเซสตายทันทีหลังเปิดสำเร็จ) ทั้งที่ไม่มีใครกดอะไรใหม่เลย
  const node = fakeNode();
  const d = deferred(); // ตั้งใจไม่ resolve -- ทดสอบ path ของ onData ล้วนๆ ไม่พึ่ง .then()
  const api = { startFriday: () => d.promise };
  core.mount(node, api);
  core.onData(ready(OFF));

  node.onclick();
  assert.match(node.className, /starting/, 'pending starting ต้องยังมีชีวิตอยู่ระหว่างรอ HTTP');

  core.onData(ready(ON)); // เซิร์ฟเวอร์ยืนยัน running ก่อนที่ promise ของ startFriday จะตอบด้วยซ้ำ
  assert.match(node.className, /(^| )fridaypill on( |$)/, 'พอเห็น running ป้ายต้องเปลี่ยนเป็น on');

  core.onData(ready(OFF)); // โปรเซสตายทันทีหลังจากนั้น -- poll รอบถัดไปเห็น off
  assert.match(node.className, /(^| )fridaypill off( |$)/,
    'pending starting เก่าต้องถูกเคลียร์ไปแล้วตอนเห็น running -- ไม่งั้นมันจะฟื้นกลับมาโชว์ starting หลอกตรงนี้');
});
