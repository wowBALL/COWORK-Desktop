const test = require('node:test');
const assert = require('node:assert');

// tab-redmine.js destructure global.COWORK.util ตอนโหลด — require util.js ก่อน
// (แบบเดียวกับ tests/tab-meeting.test.js)
require('../util.js');
const {
  parseTerms, issueHay, matchTerms, termsHitNote, sortForSearch,
} = require('../tab-redmine.js');

// ===== parseTerms =====
test('parseTerms: ว่าง / ช่องว่างล้วน = ไม่มีคำค้น', () => {
  assert.deepStrictEqual(parseTerms(''), []);
  assert.deepStrictEqual(parseTerms('   '), []);
  assert.deepStrictEqual(parseTerms(null), []);
  assert.deepStrictEqual(parseTerms(undefined), []);
});

test('parseTerms: ตัดหลายคำ ลดเป็นตัวพิมพ์เล็ก ยุบช่องว่างซ้ำ', () => {
  assert.deepStrictEqual(parseTerms('  Menutable   VOUCHER '), ['menutable', 'voucher']);
});

test('parseTerms: คำไทยไม่ถูกตัดกลางคำ', () => {
  assert.deepStrictEqual(parseTerms('เช็คหน้า voucher'), ['เช็คหน้า', 'voucher']);
});

// ===== issueHay =====
const ISSUE_188 = {
  id: 188, subject: 'เช็คหน้า voucher มันมี error ถ้าไม่มีข้อมูล',
  project: 'Menutable', assignee: 'Thawalit', risk: null, closed: true,
  status: 'Closed', updatedOn: '2026-05-02T04:10:00Z',
};

test('issueHay: รวม #id / subject / project / assignee / โน้ต เป็นตัวพิมพ์เล็ก', () => {
  const hay = issueHay(ISSUE_188, 'ถามพี่เอกเรื่องนี้ก่อน');
  assert.ok(hay.includes('#188'));
  assert.ok(hay.includes('voucher'));
  assert.ok(hay.includes('menutable'));   // project ถูกลดเป็นตัวพิมพ์เล็ก
  assert.ok(hay.includes('thawalit'));
  assert.ok(hay.includes('พี่เอก'));
});

test('issueHay: field ที่หายไปไม่ทำให้ได้คำว่า undefined/null ปนใน haystack', () => {
  const hay = issueHay({ id: 9 }, '');
  assert.ok(!hay.includes('undefined'));
  assert.ok(!hay.includes('null'));
});

// ===== matchTerms =====
test('matchTerms: ไม่มีคำค้น = ผ่านทุกอัน', () => {
  assert.strictEqual(matchTerms(issueHay(ISSUE_188, ''), []), true);
});

test('matchTerms: หลายคำต้องตรงทุกคำ (AND)', () => {
  const hay = issueHay(ISSUE_188, '');
  assert.strictEqual(matchTerms(hay, ['menutable', 'voucher']), true);
  assert.strictEqual(matchTerms(hay, ['menutable', 'stripe']), false);
});

test('matchTerms: "550" กับ "#550" หาเจอ issue เดียวกัน', () => {
  const hay = issueHay({ id: 550, subject: 'Invoice total', project: 'Menutable', assignee: 'Thawalit' }, '');
  assert.strictEqual(matchTerms(hay, parseTerms('550')), true);
  assert.strictEqual(matchTerms(hay, parseTerms('#550')), true);
});

test('matchTerms: ไม่สนตัวพิมพ์เล็กใหญ่ของคำค้น', () => {
  assert.strictEqual(matchTerms(issueHay(ISSUE_188, ''), parseTerms('VOUCHER')), true);
});

// ===== termsHitNote =====
test('termsHitNote: จริงเมื่อคำใดคำหนึ่งอยู่ในโน้ต', () => {
  assert.strictEqual(termsHitNote('ถามพี่เอกก่อน', parseTerms('พี่เอก')), true);
  assert.strictEqual(termsHitNote('ถามพี่เอกก่อน', parseTerms('voucher')), false);
});

test('termsHitNote: ไม่มีโน้ต หรือไม่มีคำค้น = เท็จเสมอ', () => {
  assert.strictEqual(termsHitNote('', parseTerms('voucher')), false);
  assert.strictEqual(termsHitNote('มีโน้ต', []), false);
});

// ===== sortForSearch =====
const A_OPEN_OLD   = { id: 1, closed: false, updatedOn: '2026-01-01T00:00:00Z' };
const B_OPEN_NEW   = { id: 2, closed: false, updatedOn: '2026-07-31T00:00:00Z' };
const C_CLOSED_NEW = { id: 3, closed: true,  updatedOn: '2026-07-31T09:00:00Z' };
const D_CLOSED_OLD = { id: 4, closed: true,  updatedOn: '2025-12-01T00:00:00Z' };

test('sortForSearch: งานที่ยังเปิดขึ้นก่อนงานที่ปิดแล้วเสมอ แม้ปิดล่าสุดกว่า', () => {
  const out = sortForSearch([C_CLOSED_NEW, A_OPEN_OLD, D_CLOSED_OLD, B_OPEN_NEW]);
  assert.deepStrictEqual(out.map(i => i.id), [2, 1, 3, 4]);
});

test('sortForSearch: ไม่แก้ array เดิม', () => {
  const input = [C_CLOSED_NEW, A_OPEN_OLD];
  sortForSearch(input);
  assert.deepStrictEqual(input.map(i => i.id), [3, 1]);
});

test('sortForSearch: updatedOn ว่าง/หายไป ตกไปท้ายกลุ่มของตัวเอง ไม่ทำให้ลำดับพัง', () => {
  const noStamp = { id: 5, closed: false, updatedOn: '' };
  const out = sortForSearch([noStamp, A_OPEN_OLD, B_OPEN_NEW, C_CLOSED_NEW]);
  assert.deepStrictEqual(out.map(i => i.id), [2, 1, 5, 3]);
});
