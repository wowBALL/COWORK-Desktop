// ทุกแท็บต้อง mount() ผ่านได้แม้ไม่มีสะพาน IPC (window.cowork ไม่มี)
//
// ไม่ใช่เรื่องสมมติ: การเปิด widget.html ตรง ๆ ในเบราว์เซอร์เป็นวิธีทดสอบหน้าจอที่ใช้จริง
// (บันทึกไว้ในหน้าโปรเจกต์ของ A_Workspace) และที่นั่น preload ไม่ทำงาน `window.cowork` จึงเป็น
// undefined — โมดูลที่เรียก `shell().api.xxx()` ตรง ๆ ตอน mount จะโยน TypeError กลางลูป
// `TABS.forEach` ของ widget.html ซึ่ง **ไม่มี try/catch** ⇒ แท็บที่เหลือทั้งหมดหลังตัวที่พังจะ
// ไม่ถูก mount และ mountSettings ก็ไม่ถูกเรียก แปลว่าพังหนึ่งตัว = ตายทั้งหน้า
//
// เกิดจริงกับ tab-qatest.js (`shell().api.onTasks(...)` ไม่มี guard) แล้วทำให้ testingroom /
// meeting / grafana / workspace ไม่ขึ้นเลย โดยไม่มีอะไรฟ้องนอกจาก error เดียวใน console
//
// ขอบเขตของเทสนี้คือ mount() เท่านั้น — โค้ดใน onclick/onchange เรียก api ตรง ๆ ได้ตามเดิม
// (เป็นแบบแผนเดิมทั้งรีโป) เพราะกว่าจะยิงต้องมีคนกด ไม่ได้อยู่ในเส้นทาง boot
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

// DOM ปลอมแบบอนุญาตทุกอย่าง: getElementById คืน element ใหม่เสมอไม่ว่าถามหา id ไหน
// เพราะเป้าหมายคือ "mount ไม่โยน" ไม่ใช่การวัดว่าวาดอะไรออกมา
function El(tag) {
  const el = {
    tagName: tag, innerHTML: '', textContent: '', className: '', title: '', value: '',
    children: [], style: { setProperty() {}, removeProperty() {} }, dataset: {}, files: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore(c) { return c; }, remove() {},
    querySelector() { return El('div'); }, querySelectorAll() { return []; },
    closest() { return null; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    setSelectionRange() {}, scrollIntoView() {}, getBoundingClientRect() {
      return { top: 0, left: 0, width: 0, height: 0 };
    },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
  };
  return el;
}
global.document = {
  createElement: (t) => El(t),
  createElementNS: (_ns, t) => El(t),
  getElementById: () => El('div'),
  querySelector: () => El('div'),
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: El('html'),
  body: El('body'),
};
global.window = global;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.requestAnimationFrame = (fn) => fn();

// ไม่มี api เลย = สภาพเดียวกับตอนเปิดหน้าในเบราว์เซอร์ธรรมดา
global.COWORK = {
  shell: {
    api: null,
    setUserName() {}, openSettings() {}, openFile() {}, showTab() {},
    llmModel: () => 'Qwen/Qwen3.6-35B-A3B',
    refreshMinutes: () => 5,
  },
};

// ลำดับเดียวกับ <script src> ใน widget.html — util ต้องมาก่อนเสมอ
for (const f of ['util.js', 'datefilter.js', 'finishtest.js', 'tab-redmine.js', 'tab-workspace.js',
  'tab-qatest.js', 'tab-testingroom.js', 'tab-meeting.js', 'tab-grafana.js']) {
  require(path.join(ROOT, f));
}

// ทะเบียนเดียวกับ TABS ใน widget.html
for (const name of ['redmine', 'qatest', 'testingroom', 'meeting', 'grafana', 'workspace']) {
  test(`${name}: mount() ไม่โยนเมื่อไม่มีสะพาน IPC`, () => {
    const mod = global.COWORK.tabs[name];
    assert.ok(mod, `ไม่มีโมดูล ${name} ในทะเบียน`);
    assert.doesNotThrow(() => { if (mod.mount) mod.mount(); });
  });
}
