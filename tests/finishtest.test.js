'use strict';
// แผงสรุปผลเทสกลับ Redmine — เฉพาะฟังก์ชันบริสุทธิ์
//
// สองข้อที่พลาดแล้วเสียหายจริงและไม่มีอะไรฟ้อง:
//   · fail ต้องไม่มีวันพาไป Resolved (งานพังถูกปิดเป็นเสร็จ)
//   · คำเตือนต้องขึ้นครบ แต่ต้องไม่ปิดปุ่ม — "เตือนแต่กดได้" (ตัดสินใจ 2026-08-07)
const test = require('node:test');
const assert = require('node:assert');
const { OUTCOMES, outcomeMeta, warningsFor, buildIssueUpdate } = require('../finishtest.js');

const done = { total: 4, skipped: 1, active: 3, pass: 3, fail: 0, todo: 0 };

test('fail ไปสถานะ In Progress · success ไป Resolved เท่านั้น', () => {
  assert.strictEqual(OUTCOMES.fail.target, 'In Progress');
  assert.strictEqual(OUTCOMES.success.target, 'Resolved');
  assert.deepStrictEqual(Object.keys(OUTCOMES).sort(), ['fail', 'success']);
});

test('outcomeMeta คืน null สำหรับค่าที่ไม่รู้จัก ไม่ตกไปเป็น fail หรือ success', () => {
  // ถ้า fallback เป็นตัวใดตัวหนึ่ง ค่าที่พิมพ์ผิดจะย้ายสถานะงานจริงโดยไม่มีใครตั้งใจ
  assert.strictEqual(outcomeMeta('resolved'), null);
  assert.strictEqual(outcomeMeta(''), null);
  assert.strictEqual(outcomeMeta(undefined), null);
});

test('ใบที่เทสครบและผ่านหมด ไม่มีคำเตือน', () => {
  assert.deepStrictEqual(warningsFor({ ok: true, outcome: 'success', status: 'Test', tally: done }), []);
});

test('เตือนเมื่อยังมีข้อที่ยังไม่ติ๊กผล', () => {
  const w = warningsFor({ outcome: 'fail', status: 'Test', tally: { ...done, todo: 3 } });
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /3 ข้อ/);
});

test('เตือนเมื่อสรุปว่าผ่านทั้งที่ในใบมีข้อ fail', () => {
  const w = warningsFor({ outcome: 'success', status: 'Test', tally: { ...done, fail: 2 } });
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /2 ข้อ/);
});

test('สรุปว่าไม่ผ่านทั้งที่มีข้อ fail ไม่ใช่เรื่องแปลก ไม่ต้องเตือน', () => {
  assert.deepStrictEqual(warningsFor({ outcome: 'fail', status: 'Test', tally: { ...done, fail: 2 } }), []);
});

test('เตือนเมื่องานไม่ได้อยู่สถานะ Test แล้ว', () => {
  const w = warningsFor({ outcome: 'fail', status: 'Resolved', tally: done });
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /Resolved/);
});

test('คำเตือนหลายข้อพร้อมกันขึ้นครบ ไม่ใช่ตัวแรกตัวเดียว', () => {
  const w = warningsFor({ outcome: 'success', status: 'In Progress', tally: { ...done, todo: 1, fail: 1 } });
  assert.strictEqual(w.length, 3);
});

test('preview ที่ยังไม่มี tally ไม่ทำให้พัง', () => {
  assert.deepStrictEqual(warningsFor({}), []);
  assert.deepStrictEqual(warningsFor(null), []);
});

test('fail ที่ตรวจแล้วว่าสคริปเทสเองพัง ไม่ขวางการสรุปว่าผ่าน', () => {
  // ระบบไม่ได้มีบั๊ก การเตือนตรงนี้จะกลายเป็นคำเตือนที่ขึ้นทุกใบจนคนเลิกอ่าน
  assert.deepStrictEqual(
    warningsFor({ outcome: 'success', status: 'Test', tally: { ...done, fail: 2, scriptFail: 2 } }), []);
});
test('fail ที่เหลือหลังหักกองสคริปออกแล้ว ยังต้องเตือน', () => {
  const w = warningsFor({ outcome: 'success', status: 'Test', tally: { ...done, fail: 3, scriptFail: 2 } });
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /1 ข้อ/);
});
test('auto fail ที่ยังไม่มีใครตรวจ ต้องเตือนทั้งขาผ่านและขาไม่ผ่าน', () => {
  // ส่งกลับ Redmine ตอนนี้ = เดาแทน QA ว่าสคริปพังหรือระบบพัง ซึ่งผิดได้ทั้งสองทาง
  for (const outcome of ['success', 'fail']) {
    const w = warningsFor({ outcome, status: 'Test', tally: { ...done, fail: 1, unjudgedFail: 1 } });
    assert.ok(w.some(x => /ยังไม่ได้ตรวจ/.test(x)), outcome);
  }
});

// ---- buildIssueUpdate: ก้อน issue ที่ถูก PUT ขึ้น Redmine ----
//
// ทุกอย่างไปในคำขอเดียวโดยตั้งใจ (ย้ายสถานะ + Test Results + โน้ต + ไฟล์แนบ) ล้มก็ล้มทั้งก้อน
// สิ่งที่ต้องกันคือคีย์ที่ "ส่งไปทั้งที่ว่าง" — Redmine ตีความ notes:'' เป็นการเพิ่มโน้ตเปล่า
// และ uploads:[] เป็นคำสั่งที่ไม่มีความหมาย ทั้งคู่ทำให้ไทม์ไลน์ของงานรกโดยไม่ได้ข้อมูลอะไรเพิ่ม
const UP = [{ token: 'abc123', filename: 'clipboard-1.png', content_type: 'image/png' }];

test('buildIssueUpdate: ไม่มีโน้ต ไม่มีรูป = ก้อนเดิมเป๊ะ ไม่มีคีย์งอกมา', () => {
  assert.deepStrictEqual(
    buildIssueUpdate({ statusId: 3, fieldId: 12, value: 'ผลรอบ 1' }),
    { status_id: 3, custom_fields: [{ id: 12, value: 'ผลรอบ 1' }] });
});

test('buildIssueUpdate: tracker ที่ไม่มี field Test Results ก็ยังย้ายสถานะได้', () => {
  assert.deepStrictEqual(buildIssueUpdate({ statusId: 3 }), { status_id: 3 });
});

test('buildIssueUpdate: มีโน้ตแล้วส่งเป็น notes · ตัดช่องว่างหัวท้ายก่อน', () => {
  const out = buildIssueUpdate({ statusId: 3, notes: '  รูปเต็มกรอบแล้ว\n' });
  assert.strictEqual(out.notes, 'รูปเต็มกรอบแล้ว');
});

test('buildIssueUpdate: โน้ตที่มีแต่ช่องว่าง = ไม่ส่งคีย์ notes เลย', () => {
  for (const n of ['', '   ', '\n\t ', null, undefined]) {
    assert.ok(!('notes' in buildIssueUpdate({ statusId: 3, notes: n })), JSON.stringify(n));
  }
});

test('buildIssueUpdate: ไม่มีรูป = ไม่ส่งคีย์ uploads เลย', () => {
  for (const u of [[], null, undefined]) {
    assert.ok(!('uploads' in buildIssueUpdate({ statusId: 3, uploads: u })), JSON.stringify(u));
  }
});

test('buildIssueUpdate: รูปไปเป็น uploads เอาเฉพาะสามคีย์ที่ Redmine ใช้', () => {
  // รูปย่อ (dataUrl) อยู่ในตัวแปรเดียวกันฝั่งหน้าจอ ถ้าหลุดไปด้วยจะยิง base64 หลายร้อย KB
  // ขึ้น Redmine ทุกครั้งที่กดยืนยัน โดยที่เซิร์ฟเวอร์ไม่ได้ใช้มันเลย
  const out = buildIssueUpdate({ statusId: 3, uploads: [{ ...UP[0], dataUrl: 'data:image/png;base64,AAAA' }] });
  assert.deepStrictEqual(out.uploads, UP);
});

test('buildIssueUpdate: ครบทุกอย่างพร้อมกันในก้อนเดียว', () => {
  const out = buildIssueUpdate({ statusId: 3, fieldId: 12, value: 'ผล', notes: 'ดูรูป', uploads: UP });
  assert.deepStrictEqual(out, {
    status_id: 3,
    custom_fields: [{ id: 12, value: 'ผล' }],
    notes: 'ดูรูป',
    uploads: UP,
  });
});

test('buildIssueUpdate: value เป็น null/undefined ยังส่ง custom field เป็นสตริงว่าง ไม่ใช่ null', () => {
  // Redmine ตอบ 422 ถ้าค่า custom field เป็น null — พฤติกรรมเดิมของ finish-test ที่ต้องคงไว้
  assert.deepStrictEqual(buildIssueUpdate({ statusId: 3, fieldId: 12 }).custom_fields, [{ id: 12, value: '' }]);
});
