'use strict';
// qatest.js — ตัวอ่านโฟลเดอร์ผลรัน ยังไม่เคยมีเทสคุมมาก่อน
// สองกฎที่พลาดแล้วเงียบ: run ที่ถูกฆ่ากลางคันต้องเป็น CRASH ไม่ใช่ PASS/FAIL ·
// ชื่อเทสต้องอ่านออกทั้งแบบที่มี colon และไม่มี (6 ใน 10 ไฟล์ฝั่งมือถือเขียนแบบไม่มี)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLog, readQaResults } = require('../qatest');

const L = (...lines) => lines.map(l => `[2026-07-27 17:34:50] ${l}`).join('\n');

test('parseLog: RESULT PASS/FAIL อ่านจากบรรทัดสุดท้าย', () => {
  assert.strictEqual(parseLog(L('เริ่ม', 'RESULT: PASS (exit code 0)')).status, 'PASS');
  assert.strictEqual(parseLog(L('เริ่ม', 'RESULT: FAIL (exit code 1)')).status, 'FAIL');
});
test('parseLog: ไม่มีบรรทัด RESULT = CRASH ไม่ใช่ FAIL', () => {
  // run ที่ถูกฆ่ากลางคันไม่เคยเขียน RESULT — ถ้าเหมารวมเป็น FAIL จะดูเหมือนเทสเจอบั๊ก
  assert.strictEqual(parseLog(L('เริ่ม', '✅ กดปุ่มแล้ว')).status, 'CRASH');
});
test('parseLog: เก็บเวลาเริ่ม/จบจาก timestamp หัวบรรทัด', () => {
  const r = parseLog('[2026-07-27 17:34:50] เริ่ม\n[2026-07-27 17:35:36] RESULT: PASS (exit code 0)');
  assert.strictEqual(r.startedAt, '2026-07-27 17:34:50');
  assert.strictEqual(r.endedAt, '2026-07-27 17:35:36');
});

test('parseLog: อ่านชื่อเทสแบบมี colon', () => {
  assert.strictEqual(parseLog(L('🚀 เริ่มทดสอบ: สั่งอาหาร dine-in ผ่านแอป Zinga')).name,
    'สั่งอาหาร dine-in ผ่านแอป Zinga');
});
test('parseLog: อ่านชื่อเทสแบบไม่มี colon ได้ด้วย', () => {
  // 6 ใน 10 ไฟล์ฝั่งมือถือเขียนแบบนี้ — เดิมได้ name เป็น null แล้วขึ้น "(ไม่ระบุชื่อเทส)"
  assert.strictEqual(parseLog(L('🚀 เริ่มทดสอบ dine-in order (Till) บน BlueStacks ผ่าน Appium')).name,
    'dine-in order (Till) บน BlueStacks ผ่าน Appium');
});
test('parseLog: ไม่มีบรรทัดชื่อเลย = null', () => {
  assert.strictEqual(parseLog(L('RESULT: PASS (exit code 0)')).name, null);
});

test('parseLog: เก็บ testId จากบรรทัด TEST:', () => {
  const r = parseLog(L('TEST: dine-in-order-Till.js', '🚀 เริ่มทดสอบ: อะไรสักอย่าง', 'RESULT: PASS (exit code 0)'));
  assert.strictEqual(r.testId, 'dine-in-order-Till.js');
});
test('parseLog: ล็อกเก่าที่ยังไม่มี TEST: ต้องได้ testId เป็น null ไม่ใช่พัง', () => {
  assert.strictEqual(parseLog(L('🚀 เริ่มทดสอบ: อะไรสักอย่าง', 'RESULT: PASS (exit code 0)')).testId, null);
});
test('parseLog: TEST: ไม่ถูกจับเป็นชื่อเทส และชื่อเทสไม่ถูกจับเป็น testId', () => {
  const r = parseLog(L('TEST: a.js', '🚀 เริ่มทดสอบ: ชื่อจริง', 'RESULT: PASS (exit code 0)'));
  assert.strictEqual(r.name, 'ชื่อจริง');
  assert.strictEqual(r.testId, 'a.js');
});

test('readQaResults: อ่านหลาย source เรียงใหม่สุดก่อน และติด testId มาด้วย', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-b-'));
  const put = (root, id, body) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'test-log.txt'), body);
  };
  put(a, '20260727120000', L('TEST: mobile.js', 'RESULT: PASS (exit code 0)'));
  put(b, '20260727130000', L('TEST: web.spec.js', 'RESULT: FAIL (exit code 1)'));
  const out = readQaResults([{ label: 'mobile', path: a }, { label: 'web', path: b }]);
  assert.deepStrictEqual(out.runs.map(r => [r.id, r.testId, r.status, r.sourceLabel]), [
    ['20260727130000', 'web.spec.js', 'FAIL', 'web'],
    ['20260727120000', 'mobile.js', 'PASS', 'mobile'],
  ]);
});
test('readQaResults: source ที่โฟลเดอร์หายไป ต้องไม่ทำให้ source อื่นว่างตาม', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-a-'));
  fs.mkdirSync(path.join(a, '20260727120000'));
  fs.writeFileSync(path.join(a, '20260727120000', 'test-log.txt'), L('RESULT: PASS (exit code 0)'));
  const out = readQaResults([{ label: 'หาย', path: path.join(a, 'ไม่มีจริง') }, { label: 'ok', path: a }]);
  assert.strictEqual(out.runs.length, 1);
});
test('readQaResults: ไม่ได้ตั้งค่า source = คืน error ไม่ใช่โยน', () => {
  assert.match(readQaResults([]).error, /ไม่พบโฟลเดอร์ QA test/);
});
