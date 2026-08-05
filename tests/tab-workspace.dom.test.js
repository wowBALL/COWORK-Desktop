const test = require('node:test');
const assert = require('node:assert/strict');
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
    addEventListener() {}, focus() {}, setSelectionRange() {},
  };
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get() { return this._text; },
    set(v) { this._text = String(v); this._html = null; this.children.length = 0; },
  });
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { if (this._html !== null) return this._html; return this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    set(v) { this._html = String(v); this._text = ''; this.children.length = 0; },
  });
  return el;
}
const byId = {};
for (const id of ['wsSegments', 'wsError', 'wsStats', 'wsRulesBox', 'wsTasks', 'wsFeed', 'wsToday',
                   'wsProjectsView', 'wsProjectDetail', 'wsProjectDetailBody', 'wsProjectBack',
                   'wsSearch', 'wsStatus', 'wsProjects', 'wsKnowledgeView', 'wsKnowSearch',
                   'wsKnowType', 'wsKnowTag', 'wsKnow', 'wsRefresh']) {
  byId[id] = El('div');
}
byId.wsSearch.value = ''; byId.wsKnowSearch.value = '';
global.document = { createElement: (t) => El(t), getElementById: (id) => byId[id] || El('div'), querySelectorAll: () => [] };
global.window = global;
global.COWORK = { util: { esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), hashN: () => 0 }, shell: () => ({ openFile: () => {} }) };

require(path.join(ROOT, 'tab-workspace.js'));
const tab = global.COWORK.tabs.workspace;
tab.mount();

const walk = (el, out = []) => { out.push(el); el.children.forEach(c => walk(c, out)); return out; };
const segLabel = (n) => walk(byId.wsSegments).find(e => e.className && e.className.includes('chip') && e._text === n);

test('ช่องค้นหาความรู้ไม่พังถ้ายังไม่มี onData มาถึงเลย', () => {
  assert.doesNotThrow(() => { byId.wsKnowSearch.oninput(); });
});

const EMPTY = {
  projects: [], daily: [], lessons: [], refs: [], rules: [], playbooks: [],
  stats: { projects: 0, active: 0, pause: 0, done: 0, dropped: 0, tasks: 0, lessons: 0, refs: 0, rules: 0, playbooks: 0 },
  error: null,
};

test('แท็บ Workspace มี segmented control 3 มุมมอง และเริ่มที่ วันนี้', () => {
  tab.onData(EMPTY);
  assert.strictEqual(byId.wsToday.classList.contains('hidden'), false);
  assert.strictEqual(byId.wsProjectsView.classList.contains('hidden'), true);
  assert.strictEqual(byId.wsKnowledgeView.classList.contains('hidden'), true);
  assert.ok(segLabel('วันนี้')); assert.ok(segLabel('โปรเจกต์')); assert.ok(segLabel('ความรู้'));
});

test('คลิก segment โปรเจกต์ สลับมุมมอง', () => {
  tab.onData(EMPTY);
  segLabel('โปรเจกต์').onclick();
  assert.strictEqual(byId.wsToday.classList.contains('hidden'), true);
  assert.strictEqual(byId.wsProjectsView.classList.contains('hidden'), false);
});

test('payload error ไม่เขียนทับ #wsToday (parent ของ wsStats/wsRulesBox/wsTasks/wsFeed) — เขียนลง #wsError แทน', () => {
  tab.onData(EMPTY);
  segLabel('วันนี้').onclick(); // สถานะ wsView อาจค้างจากเทสต์ก่อนหน้าในไฟล์เดียวกัน — บังคับกลับมาที่ 'today' ให้แน่ใจ
  byId.wsToday.textContent = 'MARKER-ต้องไม่ถูกเขียนทับ';
  tab.onData({ error: 'ไม่พบโฟลเดอร์ A_Workspace: D:\\ไม่มีจริง' });
  assert.strictEqual(byId.wsToday.textContent, 'MARKER-ต้องไม่ถูกเขียนทับ');
  assert.strictEqual(byId.wsError.classList.contains('hidden'), false);
  assert.match(byId.wsError.innerHTML, /ตั้งค่าเลย|ไม่ทราบสาเหตุ|D:\\ไม่มีจริง/);
  assert.strictEqual(byId.wsToday.classList.contains('hidden'), true);
  // payload สำเร็จรอบถัดไปต้องไม่พัง (ก่อนแก้ไข ตัว render จะพังเพราะ #wsStats ถูกเขียนทับหายไปแล้ว)
  tab.onData(EMPTY);
  assert.strictEqual(byId.wsError.classList.contains('hidden'), true);
  assert.strictEqual(byId.wsToday.classList.contains('hidden'), false);
});

function sampleData(){
  return {
    projects: [
      { name: 'COWORK Desktop', visibility: 'Public', status: 'active', path: 'D:/COWORK/COWORK Desktop', updated: '2026-08-05', desc: 'วิดเจ็ต', tasks: ['เขียนเทสต์เพิ่ม'], file: 'projects/COWORK-Desktop.md' },
      { name: 'old-thing', visibility: 'None', status: 'dropped', path: 'D:/COWORK/old', updated: '2026-01-01', desc: '', tasks: [], file: 'projects/old-thing.md' },
    ],
    daily: [], playbooks: [],
    lessons: [{ name: 'ล็อกไฟล์บน Windows', date: '2026-08-05', severity: 'near-miss', projects: ['[[COWORK Desktop]]'], tags: ['lesson','when/windows'], file: 'lessons/x.md', meta: '' }],
    refs: [],
    rules: [],
    stats: { projects: 2, active: 1, pause: 0, done: 0, dropped: 1, tasks: 1, lessons: 1, refs: 0, rules: 0, playbooks: 0 },
    error: null,
  };
}
const cardsShown = () => walk(byId.wsProjects).filter(e => String(e.className).includes('card'));

test('มุมมองโปรเจกต์แสดงการ์ดครบตามข้อมูล และคลิกเปิดแผงรายละเอียด', () => {
  tab.onData(sampleData());
  segLabel('โปรเจกต์').onclick();
  const cards=cardsShown();
  assert.strictEqual(cards.length, 2);
  cards[0].onclick();
  assert.strictEqual(byId.wsProjectDetail.classList.contains('hidden'), false);
  assert.strictEqual(byId.wsProjectsView.classList.contains('hidden'), true);
});

test('แผงรายละเอียดโปรเจกต์แสดงบทเรียนที่ลิงก์มาถึงโปรเจกต์นั้น', () => {
  tab.onData(sampleData());
  segLabel('โปรเจกต์').onclick();
  cardsShown()[0].onclick();
  // wsProjectDetailBody เองไม่เคยตั้ง .innerHTML ตรงๆ (สร้างลูกด้วย createElement) จึงต้อง
  // walk .children แล้วรวม .innerHTML ของแต่ละลูก แบบเดียวกับ shown() ใน tab-redmine.dom.test.js
  const shown = walk(byId.wsProjectDetailBody).map(e => e.innerHTML).join('');
  assert.match(shown, /ล็อกไฟล์บน Windows/);
});

test('ปุ่มกลับปิดแผงรายละเอียด กลับไปรายการ', () => {
  tab.onData(sampleData());
  segLabel('โปรเจกต์').onclick();
  cardsShown()[0].onclick();
  byId.wsProjectBack.onclick();
  assert.strictEqual(byId.wsProjectDetail.classList.contains('hidden'), true);
  assert.strictEqual(byId.wsProjectsView.classList.contains('hidden'), false);
});

const lcardsShown = () => walk(byId.wsKnow).filter(e => String(e.className).includes('lcard'));
const tagChipsShown = () => walk(byId.wsKnowTag).filter(e => String(e.className).includes('chip'));

test('มุมมองความรู้แสดงบทเรียน+อ้างอิง+กติกา และกรองด้วยชนิด', () => {
  tab.onData(sampleData());
  segLabel('ความรู้').onclick();
  const items=lcardsShown();
  assert.strictEqual(items.length, 1); // sampleData has 1 lesson, 0 refs, 0 rules, 0 playbooks
  assert.match(walk(items[0]).map(e=>e.innerHTML).join(''), /ล็อกไฟล์บน Windows/);
});

test('มุมมองความรู้กรองด้วย tag when/*', () => {
  const data=sampleData();
  data.rules=[{ name:'push ต้องขอทุกครั้ง', file:'rules/x.md', tags:['rule','when/push-publish'], meta:'' }];
  tab.onData(data);
  segLabel('ความรู้').onclick();
  assert.strictEqual(lcardsShown().length, 2);
  const tagChip=tagChipsShown().find(c=>c._text.includes('when/windows'));
  tagChip.onclick();
  const remaining=lcardsShown();
  assert.strictEqual(remaining.length, 1);
  assert.match(walk(remaining[0]).map(e=>e.innerHTML).join(''), /ล็อกไฟล์บน Windows/);
});

test('เลือกแท็ก when/* ไว้ แล้วข้อมูลรอบใหม่ไม่มีแท็กนั้นอีก — selection ต้องถูกล้างอัตโนมัติ ไม่ค้างเป็นตัวกรองที่เคลียร์ไม่ได้', () => {
  const data=sampleData();
  tab.onData(data);
  segLabel('ความรู้').onclick();
  // chip toggle เปิด/ปิด — เทสต์ก่อนหน้าในไฟล์นี้อาจเหลือ when/windows ถูกเลือกค้างอยู่แล้ว
  // (module state ของ wsKnowTagSel ไม่รีเซ็ตข้ามเทสต์) ต้องเช็ค precondition ก่อน ไม่ใช่กดเฉยๆ
  // เพราะถ้ามันเลือกอยู่แล้ว การกดซ้ำจะ "ถอด" ออก ทำให้ assertion ผ่านได้แม้โค้ด prune พังจริง
  let tagChip=tagChipsShown().find(c=>c._text.includes('when/windows'));
  if(!String(tagChip.className).includes('active')) tagChip.onclick();
  tagChip=tagChipsShown().find(c=>c._text.includes('when/windows'));
  assert.ok(String(tagChip.className).includes('active'), 'precondition: when/windows ต้องถูกเลือกอยู่ก่อนเช็คว่ามันถูกล้างทีหลัง');
  assert.strictEqual(lcardsShown().length, 1);

  const data2=sampleData();
  data2.lessons=[]; // when/windows ไม่มีในข้อมูลรอบใหม่แล้ว
  data2.rules=[{ name:'push ต้องขอทุกครั้ง', file:'rules/x.md', tags:['rule','when/push-publish'], meta:'' }];
  tab.onData(data2);
  segLabel('ความรู้').onclick();
  // ถ้า wsKnowTagSel ยังค้าง 'when/windows' อยู่ รายการนี้จะกรองเหลือ 0 ตลอดไปโดยไม่มี chip ให้กด "ทั้งหมด"
  const remaining=lcardsShown();
  assert.strictEqual(remaining.length, 1);
  assert.match(walk(remaining[0]).map(e=>e.innerHTML).join(''), /push ต้องขอทุกครั้ง/);
});

test('แผงรายละเอียดโปรเจกต์อัปเดตตามข้อมูลรอบใหม่ และปิดกลับไปรายการถ้าโปรเจกต์นั้นหายไป', () => {
  const data=sampleData();
  tab.onData(data);
  segLabel('โปรเจกต์').onclick();
  cardsShown()[0].onclick();
  assert.strictEqual(byId.wsProjectDetail.classList.contains('hidden'), false);

  const data2=sampleData();
  data2.projects[0].desc='คำอธิบายใหม่หลังรีเฟรช';
  tab.onData(data2);
  const shownAfterUpdate=walk(byId.wsProjectDetailBody).map(e=>e.innerHTML).join('');
  assert.match(shownAfterUpdate, /คำอธิบายใหม่หลังรีเฟรช/);
  assert.strictEqual(byId.wsProjectDetail.classList.contains('hidden'), false);

  const data3=sampleData();
  data3.projects=data3.projects.filter(p=>p.name!=='COWORK Desktop');
  tab.onData(data3);
  assert.strictEqual(byId.wsProjectDetail.classList.contains('hidden'), true);
  assert.strictEqual(byId.wsProjectsView.classList.contains('hidden'), false);
});
