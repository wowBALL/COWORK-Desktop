// mdRender (tab-meeting.js) — เฉพาะพาร์สเซอร์ตาราง markdown ที่เพิ่งเติม (ตาราง "Action items"
// ใน summary.md เดิมหลุดไปโดนกฎ paragraph กลายเป็นข้อความ pipe ดิบ ๆ บนจอ)
//
// mdRender เรียก esc() ซึ่งพึ่ง document.createElement จริง — ยัด fake DOM แบบเดียวกับ
// tests/tab-redmine.dom.test.js เข้าไปแทน (textContent set → innerHTML escape ให้)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function El() {
  const el = { _text: '', _html: null };
  Object.defineProperty(el, 'textContent', {
    set(v) { el._text = String(v); el._html = null; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() {
      if (el._html !== null) return el._html;
      return el._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  });
  return el;
}
global.document = { createElement: () => El() };
global.window = global;

require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'datefilter.js'));
const { mdRender } = require(path.join(ROOT, 'tab-meeting.js'));

test('mdRender: ตาราง markdown (หัว + คั่น + แถว) ออกเป็น <table> จริง ไม่ใช่ <p> pipe ดิบ', () => {
  const src = [
    '| งาน | ผู้รับผิดชอบ | กำหนด | ความชัดเจน |',
    '|---|---|---|---|',
    '| ทดสอบ Integration | Wachirakorn (สอง) | - | คาดเดา |',
  ].join('\n');
  const html = mdRender(src);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<p>\|/);
  assert.match(html, /<th>งาน<\/th>/);
  assert.match(html, /<th>ผู้รับผิดชอบ<\/th>/);
  assert.match(html, /<td>ทดสอบ Integration<\/td>/);
});

test('mdRender: คอลัมน์ "ความชัดเจน" ขึ้น badge สีตามค่า คาดเดา/ชัดเจน', () => {
  const src = [
    '| งาน | ความชัดเจน |',
    '|---|---|',
    '| A | คาดเดา |',
    '| B | ชัดเจน |',
  ].join('\n');
  const html = mdRender(src);
  assert.match(html, /<span class="md-badge amber">คาดเดา<\/span>/);
  assert.match(html, /<span class="md-badge accent">ชัดเจน<\/span>/);
});

test('mdRender: ช่องว่างหรือ "-" ในตารางแสดงเป็นขีดจาง ไม่ใช่ช่องว่างเปล่า', () => {
  const src = ['| งาน | กำหนด |', '|---|---|', '| A | - |'].join('\n');
  const html = mdRender(src);
  assert.match(html, /<span class="md-dash">–<\/span>/);
});

test('mdRender: แถวตารางที่คอลัมน์ไม่ครบตามหัว ไม่ทำให้พัง (ช่องที่ขาดว่างเปล่า)', () => {
  const src = ['| งาน | ผู้รับผิดชอบ | กำหนด |', '|---|---|---|', '| A | B |'].join('\n');
  assert.doesNotThrow(() => mdRender(src));
  const html = mdRender(src);
  assert.strictEqual((html.match(/<td>/g) || []).length, 3);
});

test('mdRender: บรรทัดที่มี | แต่ไม่มีแถวคั่นตามหลัง ไม่ถูกตีความเป็นตาราง (ยังเป็น <p>)', () => {
  const html = mdRender('เวลา 10:00 | 11:00 ประชุมสองรอบ');
  assert.doesNotMatch(html, /<table>/);
  assert.match(html, /<p>/);
});

test('mdRender: heading/bullet เดิมยังทำงานปกติ ไม่พังจากการเติม parser ตาราง', () => {
  const html = mdRender('## หัวข้อ\n- ข้อแรก\n  - ข้อย่อย');
  assert.match(html, /<h2 id="mth1">หัวข้อ<\/h2>/);
  assert.match(html, /<li>ข้อแรก<\/li>/);
  assert.match(html, /<li class="sub">ข้อย่อย<\/li>/);
});
