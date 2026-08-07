'use strict';
// ประกอบคำสั่งสำหรับสั่งรันชุดเทสจากในแอป — เป็นด่านความปลอดภัยด้วย
// renderer ส่งมาแค่ (ระบบ, ชื่อไฟล์) ที่เหลือประกอบที่นี่ ไม่เคยเชื่อ path/command ที่ส่งข้ามมา
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { planStep, planRun, repoRootOf } = require('../testrun.js');

const WEB = 'D:\\COWORK\\test-case\\tests';
const MOB = 'D:\\COWORK\\Test-case-mobile\\appium-bluestacks\\Tests';
const SOURCES = [
  { label: 'Zinga web (Playwright)', path: WEB, tests: ['dine-in-tyro.spec.js', 'ซ้ำ.js'] },
  { label: 'Zinga mobile (Appium)', path: MOB, tests: ['zinga-food.js', 'ซ้ำ.js'] },
];

test('repoRootOf: ถอยขึ้นจากโฟลเดอร์ tests หนึ่งชั้น', () => {
  // playwright.config.js กับ run-test.bat อยู่ตรงนั้น ไม่ใช่ในโฟลเดอร์ tests
  assert.strictEqual(repoRootOf(WEB), 'D:\\COWORK\\test-case');
  assert.strictEqual(repoRootOf(MOB), 'D:\\COWORK\\Test-case-mobile\\appium-bluestacks');
  assert.strictEqual(repoRootOf('D:/COWORK/x/Tests/'), 'D:/COWORK/x');
});
test('repoRootOf: path ที่ไม่ได้ลงท้ายด้วย tests ใช้ตามเดิม', () => {
  assert.strictEqual(repoRootOf('D:\\somewhere\\mobile'), 'D:\\somewhere\\mobile');
});

test('planStep: .spec.js เรียก playwright ในเครื่องโปรเจกต์ จาก root ของรีโป', () => {
  // สั่งจากในโฟลเดอร์ tests/ playwright จะหา config ไม่เจอ — บั๊กที่เจอตอนทำเฟส 5
  // และเรียก binary ในเครื่อง ไม่ใช่ npx ซึ่งจะโหลดจากเน็ตถ้าหาไม่เจอ = คนละเวอร์ชันกับทีม
  const s = planStep(SOURCES, 'Zinga web (Playwright)', 'dine-in-tyro.spec.js');
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.cwd, 'D:\\COWORK\\test-case');
  assert.strictEqual(s.cmd, path.join('D:\\COWORK\\test-case', 'node_modules', '.bin', 'playwright'));
  assert.deepStrictEqual(s.args, ['test', 'dine-in-tyro.spec.js']);
  assert.strictEqual(s.kind, 'playwright');
});
test('planStep: ไฟล์อื่นเรียก run-test.bat พร้อมชื่อไฟล์เป็น argument', () => {
  const s = planStep(SOURCES, 'Zinga mobile (Appium)', 'zinga-food.js');
  assert.strictEqual(s.cwd, 'D:\\COWORK\\Test-case-mobile\\appium-bluestacks');
  assert.strictEqual(s.cmd, path.join('D:\\COWORK\\Test-case-mobile\\appium-bluestacks', 'run-test.bat'));
  assert.deepStrictEqual(s.args, ['zinga-food.js']);
  assert.strictEqual(s.kind, 'appium');
});
test('planStep: ครอบ path ด้วยเครื่องหมายคำพูดใน line', () => {
  // node ครอบให้เฉพาะ args ไม่ครอบตัวคำสั่ง โฟลเดอร์ที่มีช่องว่างจะพังทันที
  const s = planStep([{ label: 'x', path: 'D:\\has space\\tests', tests: ['a.spec.js'] }], 'x', 'a.spec.js');
  assert.ok(s.line.startsWith('"'));
  assert.ok(s.line.includes('has space'));
  assert.ok(s.line.endsWith(' test a.spec.js'));
});

test('planStep: ชื่อไฟล์ที่มีอักขระพิเศษถูกปฏิเสธก่อนถึงดิสก์', () => {
  // spawn บน Windows ต้องผ่าน shell เพื่อเรียก .bat/.cmd อักขระพวกนี้จึงมีความหมายกับ cmd.exe
  for (const bad of ['a.js & calc', 'a.js|b', '..\\..\\evil.js', 'a.js"', 'ซ้ำ.js', '']) {
    assert.strictEqual(planStep(SOURCES, 'Zinga web (Playwright)', bad).ok, false, bad);
  }
});
test('planStep: ไฟล์ที่ไม่มีอยู่ในโฟลเดอร์ที่ตั้งค่าไว้ รันไม่ได้', () => {
  // regex อย่างเดียวไม่พอ — ต้องมีไฟล์นั้นอยู่จริงในแหล่งที่ตั้งค่าไว้ด้วย
  assert.strictEqual(planStep(SOURCES, 'Zinga web (Playwright)', 'not-there.js').ok, false);
});
test('planStep: ระบุระบบผิด แต่ไฟล์อยู่แหล่งเดียว = ยังรันได้', () => {
  const s = planStep(SOURCES, 'ระบบที่ถูกลบไปแล้ว', 'zinga-food.js');
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.system, 'Zinga mobile (Appium)');
});
test('planStep: ไม่ระบุระบบ และไฟล์อยู่หลายแหล่ง = ไม่เดา', () => {
  const src = [
    { label: 'a', path: 'D:\\a\\tests', tests: ['same.js'] },
    { label: 'b', path: 'D:\\b\\tests', tests: ['same.js'] },
  ];
  const s = planStep(src, '', 'same.js');
  assert.strictEqual(s.ok, false);
  assert.match(s.error, /หลายระบบ/);
});
test('planStep: ระบุระบบชัดเจน แม้ชื่อไฟล์ซ้ำก็รันตัวที่ถูก', () => {
  const src = [
    { label: 'a', path: 'D:\\a\\tests', tests: ['same.js'] },
    { label: 'b', path: 'D:\\b\\tests', tests: ['same.js'] },
  ];
  assert.strictEqual(planStep(src, 'b', 'same.js').cwd, 'D:\\b');
});

test('planRun: คงลำดับเดิม และขั้นที่ประกอบคำสั่งไม่ได้ยังอยู่ในลิสต์', () => {
  // หายไปเงียบ ๆ = เข้าใจว่ารันครบทั้งที่ขาดไฟล์หนึ่ง
  const steps = planRun(SOURCES, [
    { system: 'Zinga web (Playwright)', test: 'dine-in-tyro.spec.js' },
    { system: 'Zinga mobile (Appium)', test: 'gone.js' },
    { system: 'Zinga mobile (Appium)', test: 'zinga-food.js' },
  ]);
  assert.strictEqual(steps.length, 3);
  assert.deepStrictEqual(steps.map(s => s.ok), [true, false, true]);
});
test('planRun: รับค่าที่ไม่ใช่ array ได้โดยไม่โยน', () => {
  assert.deepStrictEqual(planRun(SOURCES, null), []);
  assert.strictEqual(planRun(null, [{ test: 'a.spec.js' }])[0].ok, false);
});
