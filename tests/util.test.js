// util.js — ตัวช่วยที่ทั้ง main และ renderer ใช้ร่วมกัน เทสเฉพาะตัวที่ไม่ต้องมี DOM
//
// normalizeRefreshMinutes เป็นด่านเดียวที่กันค่ารอบรีเฟรชเพี้ยนไม่ให้ไปถึง setInterval
// พลาดตรงนี้แล้วผลคือยิง Redmine API รัว (ค่าติดลบ/ทศนิยม) หรือหยุดรีเฟรชไปเงียบ ๆ
// (ค่าที่ parse ไม่ได้) โดยไม่มีอะไรฟ้อง — config.json ผู้ใช้แก้เองได้ จึงเป็น input ภายนอกจริง
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { REFRESH_CHOICES, normalizeRefreshMinutes } = require(path.join(__dirname, '..', 'util.js'));

test('REFRESH_CHOICES: 0 (ปิด) ต้องอยู่ในลิสต์ และเรียงจากน้อยไปมาก', () => {
  assert.deepStrictEqual(REFRESH_CHOICES, [0, 1, 2, 5, 10, 15, 30]);
});

test('normalizeRefreshMinutes: ค่าที่อยู่ในลิสต์ผ่านตรง ๆ', () => {
  for (const v of REFRESH_CHOICES) assert.strictEqual(normalizeRefreshMinutes(v), v);
});

test('normalizeRefreshMinutes: 0 ต้องไม่ตกกลับค่าเริ่มต้น — 0 คือ "ปิด" ที่ผู้ใช้ตั้งเอง', () => {
  assert.strictEqual(normalizeRefreshMinutes(0), 0);
  assert.strictEqual(normalizeRefreshMinutes('0'), 0);
});

test('normalizeRefreshMinutes: สตริงตัวเลขที่ตรงตัวเลือกใช้ได้ (มาจาก <select>.value)', () => {
  assert.strictEqual(normalizeRefreshMinutes('10'), 10);
  assert.strictEqual(normalizeRefreshMinutes('30'), 30);
});

test('normalizeRefreshMinutes: ค่าขยะทุกแบบตกกลับ 5', () => {
  for (const v of [0.1, -5, 3, 999, 'abc', '', null, undefined, NaN, Infinity, {}, []]) {
    assert.strictEqual(normalizeRefreshMinutes(v), 5, 'ค่า: ' + JSON.stringify(v));
  }
});
