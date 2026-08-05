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
for (const id of ['wsSegments', 'wsStats', 'wsRulesBox', 'wsTasks', 'wsFeed', 'wsToday',
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
