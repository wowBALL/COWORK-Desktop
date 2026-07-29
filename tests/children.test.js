const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const children = require('../children.js');

// ---- decideQuit ------------------------------------------------------------

test('decideQuit: ทะเบียนว่าง = ปิดได้เลย', () => {
  assert.strictEqual(children.decideQuit([], { updating: false }), 'kill');
  assert.strictEqual(children.decideQuit(null, {}), 'kill');
});

test('decideQuit: ลูกทุกตัวว่าง = ฆ่าทิ้งเงียบ ๆ', () => {
  const states = [{ pid: 1, name: 'a', busy: false }, { pid: 2, name: 'b', busy: false }];
  assert.strictEqual(children.decideQuit(states, { updating: false }), 'kill');
});

test('decideQuit: มีตัวยุ่ง = ต้องถาม', () => {
  const states = [{ pid: 1, name: 'a', busy: false }, { pid: 2, name: 'b', busy: true }];
  assert.strictEqual(children.decideQuit(states, { updating: false }), 'ask');
});

test('decideQuit: ยุ่งแต่กำลังอัปเดต = ห้ามเด้งกล่องกลางทาง', () => {
  const states = [{ pid: 2, name: 'b', busy: true }];
  assert.strictEqual(children.decideQuit(states, { updating: true }), 'quiet');
});

test('decideQuit: ว่างล้วน + กำลังอัปเดต ยังฆ่าได้ตามปกติ', () => {
  const states = [{ pid: 2, name: 'b', busy: false }];
  assert.strictEqual(children.decideQuit(states, { updating: true }), 'kill');
});

// ---- matchOrphan -----------------------------------------------------------

const VENV = 'D:\\COWORK\\meeting-notes\\.venv\\Scripts\\';
const EXES = [VENV + 'pythonw.exe', VENV + 'python.exe'];

test('matchOrphan: จับได้ทั้งที่ตัวพิมพ์ต่างกันและ slash คนละทาง', () => {
  const procs = [
    { ProcessId: 11, ExecutablePath: 'd:/cowork/meeting-notes/.venv/scripts/PYTHONW.EXE',
      CommandLine: 'pythonw.exe -m SRC.SESSION_SERVICE' },
  ];
  assert.deepStrictEqual(children.matchOrphan(procs, { exePaths: EXES, needle: 'src.session_service' }), [11]);
});

test('matchOrphan: python ตัวอื่นในเครื่องต้องไม่โดน', () => {
  const procs = [
    { ProcessId: 12, ExecutablePath: 'C:\\Python312\\python.exe',
      CommandLine: 'python.exe -m src.session_service' },
    { ProcessId: 13, ExecutablePath: VENV + 'python.exe',
      CommandLine: 'python.exe -m src.watcher' },
  ];
  assert.deepStrictEqual(children.matchOrphan(procs, { exePaths: EXES, needle: 'src.session_service' }), []);
});

test('matchOrphan: ข้อมูลพิการต้องไม่ทำให้ระเบิด', () => {
  const procs = [null, {}, { ProcessId: 0 }, { ProcessId: 14, ExecutablePath: null, CommandLine: null }];
  assert.deepStrictEqual(children.matchOrphan(procs, { exePaths: EXES, needle: 'x' }), []);
  assert.deepStrictEqual(children.matchOrphan(null, { exePaths: EXES, needle: 'x' }), []);
});

// ---- registry --------------------------------------------------------------

function fakeChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.unref = () => { c.unrefed = true; };
  return c;
}

test('registry: spawnTracked จดทะเบียนและ unref ให้', () => {
  const child = fakeChild(101);
  const reg = children.createRegistry({ spawnFn: () => child, killFn: async () => true });
  reg.spawnTracked('x.exe', [], {}, { name: 'x' });
  assert.deepStrictEqual(reg.list(), [{ pid: 101, name: 'x' }]);
  assert.strictEqual(child.unrefed, true);
});

test('registry: ลูกที่ตายเองหลุดออกจากทะเบียน', () => {
  const child = fakeChild(102);
  const reg = children.createRegistry({ spawnFn: () => child, killFn: async () => true });
  reg.spawnTracked('x.exe', [], {}, { name: 'x' });
  child.emit('exit', 0, null);
  assert.deepStrictEqual(reg.list(), []);
});

test('registry: spawn ที่ล้มเหลว (ไม่มี pid) ต้องไม่เข้าทะเบียน', () => {
  const reg = children.createRegistry({ spawnFn: () => ({}), killFn: async () => true });
  assert.strictEqual(reg.spawnTracked('x.exe', [], {}, { name: 'x' }), null);
  assert.deepStrictEqual(reg.list(), []);
});

test('registry: adopt เพิ่มตัวเดิมซ้ำไม่ได้', () => {
  const reg = children.createRegistry({ killFn: async () => true });
  assert.strictEqual(reg.adopt(201, { name: 'orphan' }), true);
  assert.strictEqual(reg.adopt(201, { name: 'orphan' }), false);
  assert.deepStrictEqual(reg.list(), [{ pid: 201, name: 'orphan' }]);
});

test('registry: states() อ่าน isBusy ของแต่ละตัว', async () => {
  const reg = children.createRegistry({ killFn: async () => true });
  reg.adopt(1, { name: 'busy one', isBusy: async () => true });
  reg.adopt(2, { name: 'idle one', isBusy: async () => false });
  reg.adopt(3, { name: 'no probe' });
  assert.deepStrictEqual(await reg.states(), [
    { pid: 1, name: 'busy one', busy: true },
    { pid: 2, name: 'idle one', busy: false },
    { pid: 3, name: 'no probe', busy: false },
  ]);
});

test('registry: isBusy ที่พังแปลว่าไม่ยุ่ง ไม่ใช่ยุ่ง', async () => {
  const reg = children.createRegistry({ killFn: async () => true });
  reg.adopt(1, { name: 'dead', isBusy: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepStrictEqual(await reg.states(), [{ pid: 1, name: 'dead', busy: false }]);
});

test('registry: stopAll ฆ่าทุกตัวแล้วล้างทะเบียน', async () => {
  const killed = [];
  const reg = children.createRegistry({ killFn: async (pid) => { killed.push(pid); return true; } });
  reg.adopt(1, { name: 'a' });
  reg.adopt(2, { name: 'b' });
  await reg.stopAll();
  assert.deepStrictEqual(killed, [1, 2]);
  assert.deepStrictEqual(reg.list(), []);
});

test('registry: stopAll(pids) ฆ่าเฉพาะที่ระบุ', async () => {
  const killed = [];
  const reg = children.createRegistry({ killFn: async (pid) => { killed.push(pid); return true; } });
  reg.adopt(1, { name: 'a' });
  reg.adopt(2, { name: 'b' });
  await reg.stopAll([2]);
  assert.deepStrictEqual(killed, [2]);
  assert.deepStrictEqual(reg.list(), [{ pid: 1, name: 'a' }]);
});
