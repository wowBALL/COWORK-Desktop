const test = require('node:test');
const assert = require('node:assert');
require('../util.js');
// tab-qatest.js destructure global.COWORK.dateFilter ตอนโหลด — require datefilter.js ก่อน
// (แบบเดียวกับ tests/tab-meeting.test.js)
require('../datefilter.js');
const { buildReviewLines } = require('../tab-qatest.js');

test('buildReviewLines: แปล priority/assignee/tracker กลับเป็นชื่อคนอ่านได้ ไม่ใช่ id ดิบ', () => {
  const lines = buildReviewLines(
    {
      projectName: 'Wallet', trackerName: 'Bug', subject: 'กดไม่ติด', priorityName: 'High',
      assigneeId: 7, riskLevel: 'High', customFieldValues: { '8': 'rollback text' },
      uploads: [{ filename: 'shot.png' }],
    },
    { members: [{ id: 7, name: 'kom' }], customFields: [{ id: 8, name: 'Rollback Plan' }] },
  );
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]));
  assert.strictEqual(byLabel['โปรเจกต์'], 'Wallet');
  assert.strictEqual(byLabel['Priority'], 'High');
  assert.strictEqual(byLabel['ผู้รับผิดชอบ'], 'kom');
  assert.strictEqual(byLabel['Rollback Plan'], 'rollback text');
  assert.ok(byLabel['ไฟล์แนบ'].includes('shot.png'));
});

test('buildReviewLines: ไม่มี assignee แสดง "(ไม่ระบุ)" ไม่ใช่ id ว่างเปล่า', () => {
  const lines = buildReviewLines(
    { projectName: 'Wallet', trackerName: 'Bug', subject: 's', priorityName: 'Normal', customFieldValues: {} },
    { members: [], customFields: [] },
  );
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]));
  assert.strictEqual(byLabel['ผู้รับผิดชอบ'], '(ไม่ระบุ)');
});

// ===== รูปที่ส่งให้ LLM ดู + ข้อมูลที่ยังขาด (spec 2026-08-05) =====
const {
  qiDraftBtnLabel, qiThumbsHtml, qiDraftGapsHtml, qiPastedName, qiIsImageDataUrlText,
} = require('../tab-qatest.js');

// util.js esc() escape ด้วย textContent→innerHTML ของจริง จึงต้องมี document ให้มันเรียก
// (แนวเดียวกับ fake DOM ใน tab-redmine.dom.test.js) — เลียนพฤติกรรมจริงให้ครบ รวมทั้ง
// การแปลง U+00A0 เป็น &nbsp; ที่ regex ธรรมดาไม่ทำ ไม่งั้นเทสจะพิสูจน์คนละอย่างกับของจริง
global.document = {
  createElement() {
    let text = '';
    return {
      set textContent(v) { text = String(v == null ? '' : v); },
      get innerHTML() {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
      },
    };
  },
};

test('qiDraftBtnLabel: ไม่มีรูปไม่โชว์วงเล็บ มีรูปบอกจำนวน', () => {
  assert.strictEqual(qiDraftBtnLabel(0), '🪄 ให้ LLM ช่วยร่าง');
  assert.ok(qiDraftBtnLabel(2).includes('(2 รูป)'));
});

test('qiThumbsHtml: ใบที่ยังอ่านไฟล์ไม่เสร็จไม่มีแท็ก <img> แต่ยังมีปุ่มเอาออก', () => {
  const html = qiThumbsHtml([{ filename: 'a.png', dataUrl: '', pending: true }]);
  assert.ok(!html.includes('<img'), 'ยังไม่มี dataUrl ต้องไม่วาด <img src=""> ที่ขึ้นไอคอนรูปแตก');
  assert.ok(html.includes('qi-thumb-busy'));
  assert.ok(html.includes('qi-thumb-drop'));
});

test('qiThumbsHtml: data-i เรียงตาม index จริง (ปุ่มเอาออกใช้เลขนี้ splice)', () => {
  const html = qiThumbsHtml([
    { filename: 'a.png', dataUrl: 'data:image/png;base64,AAA' },
    { filename: 'b.png', dataUrl: 'data:image/png;base64,BBB' },
  ]);
  assert.ok(html.includes('data-i="0"') && html.includes('data-i="1"'));
});

test('qiThumbsHtml: ปุ่มเอาออกต้องบอกว่าไฟล์แนบยังอยู่ ไม่ใช่ลบไฟล์แนบ', () => {
  const html = qiThumbsHtml([{ filename: 'a.png', dataUrl: 'data:image/png;base64,AAA' }]);
  assert.ok(html.includes('ไฟล์แนบใน issue ยังอยู่'),
    'อัปขึ้น Redmine ไปแล้วถอนไม่ได้ ป้ายต้องไม่ทำให้เข้าใจว่ากดแล้วไฟล์แนบหาย');
});

test('qiThumbsHtml: ชื่อไฟล์ถูก escape ไม่หลุดออกจาก attribute', () => {
  const html = qiThumbsHtml([{ filename: 'a" onerror="x.png', dataUrl: '' }]);
  assert.ok(!html.includes('onerror="x'), 'ชื่อไฟล์ต้องไม่ปิด attribute แล้วแทรก handler ได้');
});

test('qiDraftGapsHtml: ไม่มีอะไรขาด = ว่างเปล่า (ปลายทางใช้ค่านี้ตัดสินว่าจะซ่อนกรอบ)', () => {
  assert.strictEqual(qiDraftGapsHtml([]), '');
  assert.strictEqual(qiDraftGapsHtml(null), '');
  assert.strictEqual(qiDraftGapsHtml(undefined), '');
});

test('qiDraftGapsHtml: วาดเป็นรายการและ escape เนื้อหาที่โมเดลส่งมา', () => {
  const html = qiDraftGapsHtml(['ยังไม่บอก route', '<script>x</script>']);
  assert.ok(html.includes('<li>ยังไม่บอก route</li>'));
  assert.ok(!html.includes('<script>'), 'ข้อความจากโมเดลต้องไม่ถูกรันเป็น HTML');
});

test('qiPastedName: jpeg ตั้งนามสกุลเป็น jpg และไม่ชนกันเองเมื่อวางหลายใบ', () => {
  assert.ok(qiPastedName({ type: 'image/jpeg' }).endsWith('.jpg'));
  assert.ok(qiPastedName({ type: 'image/png' }).endsWith('.png'));
  assert.notStrictEqual(qiPastedName({ type: 'image/png' }), qiPastedName({ type: 'image/png' }));
});

test('qiPastedName: type ที่อ่านไม่ได้ยังได้ชื่อไฟล์ที่ใช้ได้ ไม่ใช่ ".undefined"', () => {
  assert.ok(qiPastedName({ type: '' }).endsWith('.png'));
});

// ===== วางข้อความ "ที่อยู่ของรูป" (data:image/...) ลงช่องโน้ต ไม่ใช่ไฟล์รูปจริง =====
// เกิดจริง: คัดลอกจากที่อื่นแล้ว clipboard เก็บเป็นข้อความ ไม่ใช่ไฟล์ — clipboardData.items
// ไม่เห็นเป็น kind:'file' เลย ปล่อยผ่านจะได้ base64 ยาวหลายพันตัวอักษรลงในโน้ตที่ส่งเป็น prompt
test('qiIsImageDataUrlText: จับ data:image/...;base64 ได้ ไม่ว่าจะเป็น png/svg/jpeg', () => {
  assert.ok(qiIsImageDataUrlText('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(qiIsImageDataUrlText('data:image/svg+xml;base64,PHN2Zw=='));
  assert.ok(qiIsImageDataUrlText('  data:image/jpeg;base64,/9j/'), 'ต้องทนช่องว่างนำหน้าจากการวาง');
});

test('qiIsImageDataUrlText: ข้อความปกติหรือ data URL ที่ไม่ใช่รูปต้องผ่าน ไม่ถูกกัน', () => {
  assert.ok(!qiIsImageDataUrlText('ปุ่ม checkout กดไม่ติด android 13'));
  assert.ok(!qiIsImageDataUrlText('data:text/plain;base64,aGVsbG8='));
  assert.ok(!qiIsImageDataUrlText(''));
  assert.ok(!qiIsImageDataUrlText(null));
  assert.ok(!qiIsImageDataUrlText(undefined));
});
