// แท็บ Redmine — เทสชั้นที่วาดจริง (renderPanel / renderTabs / onData / สายไฟใน mount)
//
// tab-redmine.test.js เทส viewModel ซึ่งเป็นฟังก์ชันบริสุทธิ์ ครอบคลุมกฎการนับทั้งหมด
// แต่ครอบไม่ถึง "สิ่งที่ขึ้นจอ" เลย — ข้อความว่าง ๆ, tooltip, การล้าง DOM ตอน payload พัง
// และสายไฟของช่องค้นหา ล้วนพังได้โดยที่ viewModel ยังถูกทุกตัวเลข
//
// ไฟล์นี้จึงยัด fake DOM เล็กที่สุดเท่าที่ tab-redmine.js เรียกใช้จริงเข้าไปแทน document
// แล้วขับแท็บผ่านทางเดียวกับผู้ใช้: onTasks(payload) → พิมพ์ในช่อง → กดแท็บ
//
// พิสูจน์แล้วว่ากัด: รันย้อนบนคอมมิตก่อนแก้ de4e411 พัง 4/8 และ 0ef1056 พัง 1/8
// ทุกข้อที่พังคือบั๊กที่รีวิวจับได้จริง (ข้อความบอกจำนวนที่ซ่อน, tooltip โน้ตโดนทับ,
// ข้อมูลเก่าถูกวาดทับหน้า error, บรรทัดเตือนค้างบนหน้า error)
//
// ราคาที่ต้องจ่าย: ถ้า renderer ไปเรียก DOM API ตัวใหม่ที่ El() ไม่มี เทสจะพังแบบงง ๆ
// วิธีแก้คือเติม method นั้นใน El() ไม่ใช่ลบเทสทิ้ง
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function El(tag) {
  const el = {
    tagName: tag, _html: '', _text: '', className: '', title: '', children: [],
    style: { setProperty() {} }, dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return El('div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    focus() {}, setSelectionRange() {},
  };
  // เลียนของจริง: ตั้ง textContent แล้วอ่าน innerHTML ต้องได้ข้อความที่ escape แล้ว
  // (util.js esc() พึ่งพฤติกรรมนี้ตรง ๆ) ส่วนตั้ง innerHTML แล้วอ่านต้องได้คืนดิบ ๆ
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get() { return this._text; },
    set(v) { this._text = String(v); this._html = null; this.children.length = 0; },
  });
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() {
      if (this._html !== null) return this._html;
      return this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    set(v) { this._html = String(v); this._text = ''; this.children.length = 0; },
  });
  return el;
}
const byId = {};
for (const id of ['tasks', 'tabs', 'projectFilter', 'assigneeFilter', 'riskFilter',
                  'rmSearchHint', 'rmStats', 'rmSearch', 'closedStat', 'notConfiguredBtn']) {
  byId[id] = El('div');
}
byId.rmSearch.value = '';
global.document = {
  createElement: (t) => El(t),
  getElementById: (id) => byId[id] || El('div'),
  querySelectorAll: () => [],
};
global.window = global;
global.COWORK = { shell: { api: null, setUserName() {}, openSettings() {} } };

require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'tab-redmine.js'));
const tab = global.COWORK.tabs.redmine;

let onTasks = null;
global.COWORK.shell.api = { onTasks: (cb) => { onTasks = cb; }, openLink() {}, saveNote() {}, getIssuePreview() {} };
tab.mount();
assert.ok(onTasks, 'mount() ต้องลงทะเบียน onTasks');

const iss = (o) => Object.assign({ project: 'Menutable', assignee: 'Somchai', risk: null,
  closed: false, overdue: false, createdOn: '2026-01-01T00:00:00Z', updatedOn: '2026-01-01T00:00:00Z',
  url: 'http://x/issues/' + o.id }, o);
const PAYLOAD = {
  currentUser: 'somchai',
  stats: { open: 3, highRisk: 1, overdue: 0, closed: 2, closedByYear: [] },
  notes: { '646': { text: 'อันนี้รอ design ก่อน ตู้เย็น ยาว ๆ หน่อยเพื่อเช็กว่าตัดที่ 60 ตัวอักษรแล้วต่อท้ายด้วยจุดสามจุดจริงไหม', updatedAt: '2026-07-16T00:00:00Z' } },
  groups: [
    { status: 'In Progress', issues: [iss({ id: 584, subject: 'Create pre-order', risk: 'High', status: 'In Progress', updatedOn: '2026-07-31T08:00:00Z' })] },
    { status: 'New', issues: [iss({ id: 657, subject: 'Header menu toggle', risk: 'Low', status: 'New', updatedOn: '2026-07-30T10:00:00Z' })] },
    { status: 'Closed', issues: [
      iss({ id: 188, subject: 'เช็คหน้า voucher มันมี error', status: 'Closed', closed: true, updatedOn: '2026-05-02T04:10:00Z' }),
      iss({ id: 646, subject: 'ปรับแสดงรายการแอป', risk: 'Moderate', status: 'Closed', closed: true, updatedOn: '2026-07-15T10:00:00Z' }),
    ]},
  ],
};
const type = (v) => { byId.rmSearch.value = v; byId.rmSearch.oninput(); };
const esc = () => byId.rmSearch.onkeydown({ key: 'Escape', preventDefault() {} });
const tabsNamed = (n) => byId.tabs.children.find(c => c.innerHTML.includes('>' + n + '<'));
const walk = (el, out = []) => { out.push(el); el.children.forEach(c => walk(c, out)); return out; };
const noteBtns = () => walk(byId.tasks).filter(e => String(e.className).includes('noteBtn'));


// ---- 1. ช่องว่าง = ของเดิม: ALL ตัด Closed/Backlog, ไม่มีบรรทัดใต้ช่อง
test('1 ช่องว่าง: ALL=2 ไม่รวม Closed, ไม่มีบรรทัดใต้ช่อง', () => {
  onTasks(PAYLOAD);
  assert.strictEqual(tabsNamed('ALL').innerHTML.includes('>2<'), true, 'ALL ต้องนับ 2 (584, 657) ไม่รวม Closed');
  assert.strictEqual(byId.rmSearchHint.classList.contains('on'), false);
  assert.strictEqual(byId.rmSearchHint.textContent, '');
});

// ---- 2. ค้นบนแท็บ ALL: เจองานที่ปิดแล้ว + บรรทัดใต้ช่องขึ้น
test('2 ค้น 188 บน ALL: เจองานที่ปิดแล้ว + บรรทัดเตือนขึ้นถูกข้อความ', () => {
  type('188');
  assert.ok(byId.tasks.children.some(c => c.innerHTML.includes('#188')), 'ต้องเจอ #188 จากแท็บ ALL');
  assert.strictEqual(byId.rmSearchHint.classList.contains('on'), true);
  assert.strictEqual(byId.rmSearchHint.textContent, 'กำลังค้นจากทุกสถานะ รวมงานที่ปิดแล้ว');
});

// ---- 3. ยืนบนแท็บสถานะแล้วค้น: ข้อความบอกจำนวนที่ซ่อน + บรรทัดใต้ช่องต้องหาย
test('3 In Progress + "188": ขึ้นข้อความบอกว่ามีอีก 1 อยู่สถานะอื่น, บรรทัดเตือนหายถูกต้อง', () => {
  esc();
  tabsNamed('In Progress').onclick();
  type('188');
  assert.match(byId.tasks.innerHTML, /ไม่พบในสถานะนี้ — มีอีก <b>1<\/b> งานที่ตรงกับ "188" อยู่ในสถานะอื่น กดแท็บ ALL เพื่อดู/);
  assert.strictEqual(byId.rmSearchHint.classList.contains('on'), false, 'บรรทัดเตือนต้องขึ้นเฉพาะแท็บ ALL');
});

// ---- 4. ไม่เจอที่ไหนเลย = ข้อความเดิม ไม่ใช่ข้อความใหม่
test('4 ไม่เจอที่ไหนเลย = ข้อความเดิม · Esc ล้างช่องแล้วกลับมาปกติ', () => {
  type('ไม่มีทางเจอคำนี้');
  assert.match(byId.tasks.innerHTML, /ไม่พบงานที่ตรงกับ "ไม่มีทางเจอคำนี้"/);
  assert.ok(!byId.tasks.innerHTML.includes('ไม่พบในสถานะนี้'));
  esc();
  // renderPanel วาดแถวเป็น child ไม่ใช่ innerHTML ก้อนเดียว จึงต้องดูทั้งสองทาง
  const shown = () => byId.tasks.innerHTML + walk(byId.tasks).map(e => e.innerHTML).join('');
  assert.match(shown(), /#584/);
});

// ---- 5. tooltip ปุ่มโน้ต: ต้องต่อท้าย ไม่ใช่แทนที่ตัวอย่างโน้ต
test('5 tooltip โน้ต: ค้นเจอ = "ตรงกับคำค้นในโน้ต · <ตัวอย่าง…>" · ไม่ค้น = "โน้ต: …" แบบเดิม', () => {
  tabsNamed('ALL').onclick();
  type('ตู้เย็น');
  const hit = noteBtns();
  assert.strictEqual(hit.length, 1, 'ต้องเหลือแถวเดียวคือ #646');
  assert.ok(hit[0].title.startsWith('ตรงกับคำค้นในโน้ต · '), 'tooltip: ' + hit[0].title);
  assert.ok(hit[0].title.endsWith('…'), 'ตัวอย่างโน้ตยาวเกิน 60 ต้องยังถูกตัดท้ายด้วย … : ' + hit[0].title);
  assert.ok(hit[0].className.includes('hit') && hit[0].className.includes('has'));
  esc();
  tabsNamed('Closed').onclick();   // #646 ปิดไปแล้ว แท็บ ALL ตอนไม่ค้นจึงไม่แสดง
  const plain = noteBtns().find(b => b.className.includes('has'));
  assert.ok(plain.title.startsWith('โน้ต: '), 'ไม่ได้ค้นอยู่ tooltip ต้องเป็นแบบเดิม: ' + plain.title);
});

// ---- 6. หน้า error + พิมพ์ค้นหา ต้องไม่ถูกข้อมูลเก่าทับ (บั๊กที่รีวิวจับได้)
test('6 หน้า error + พิมพ์ 2 ครั้ง: การ์ด "ตั้งค่าเลย" ยังอยู่ ชิป/แท็บไม่ถูกวาดทับจากข้อมูลเก่า', () => {
  tabsNamed('ALL').onclick();
  type('voucher');
  assert.strictEqual(byId.rmSearchHint.classList.contains('on'), true, 'ตั้งต้น: บรรทัดเตือนต้องติดอยู่ก่อน error มา');
  onTasks({ currentUser: 'somchai', stats: null, error: 'ยังไม่ได้ตั้งค่า Redmine' });
  assert.ok(byId.tasks.innerHTML.includes('ตั้งค่าเลย'));
  assert.strictEqual(byId.rmSearchHint.textContent, '', 'บรรทัดเตือนต้องถูกล้างตอนขึ้นหน้า error');
  assert.strictEqual(byId.rmSearchHint.classList.contains('on'), false);
  type('a'); type('ab');
  assert.ok(byId.tasks.innerHTML.includes('ตั้งค่าเลย'), 'พิมพ์แล้วการ์ดตั้งค่าต้องยังอยู่');
  assert.strictEqual(byId.tabs.innerHTML, '', 'แท็บสถานะต้องไม่ถูกวาดกลับมาจากข้อมูลเก่า');
  assert.strictEqual(byId.projectFilter.innerHTML, '');
});

// ---- 7. payload ว่าง (ไม่มีงานค้าง) ก็ต้องกันแบบเดียวกัน
test('7 payload ว่าง + พิมพ์: "ไม่มีงานค้าง" ยังอยู่ ไม่ถูกวาดทับ', () => {
  onTasks({ currentUser: 'somchai', stats: null, groups: [] });
  assert.ok(byId.tasks.innerHTML.includes('ไม่มีงานค้าง'));
  type('voucher');
  assert.ok(byId.tasks.innerHTML.includes('ไม่มีงานค้าง'), 'พิมพ์แล้วต้องไม่มีอะไรวาดทับ');
});

// ---- 8. กลับมาปกติแล้วคำค้นที่ค้างอยู่ยังทำงาน
test('8 payload กลับมาปกติ: คำค้นค้างในช่องข้ามการรีเฟรช ยังกรองอยู่ และบรรทัดเตือนกลับมาตอนกด ALL', () => {
  onTasks(PAYLOAD);
  const shown = byId.tasks.innerHTML + walk(byId.tasks).map(e => e.innerHTML).join('');
  assert.match(shown, /#188/, 'คำค้น voucher ที่ค้างอยู่ต้องยังกรอง payload ใหม่');
  tabsNamed('ALL').onclick();
  assert.strictEqual(byId.rmSearchHint.classList.contains('on'), true, 'กลับมาแท็บ ALL ทั้งที่ยังค้างคำค้น บรรทัดเตือนต้องกลับมา');
  assert.strictEqual(byId.rmSearch.value, 'voucher', 'คำค้นต้องค้างในช่องข้ามการรีเฟรช');
});

