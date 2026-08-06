'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseQtest, serializeQtest, qtestFilename, nextQtestName, listQtests, BY, RESULT,
} = require('../testingroom');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qtest-'));
}

const SHEET = {
  meta: {
    qtest: 1, issue: 690, round: 1,
    subject: '[menutable-cms] login แล้ว sidebar ว่างทั้งแถบ',
    project: 'Menutable', tracker: 'Bug',
    receivedAt: '2026-08-06', status: 'open', model: 'litellm/gemma4',
  },
  items: [
    { n: 1, title: 'login ด้วยบัญชี owner แล้ว sidebar แสดงเมนูครบ', by: 'qa', result: '–', run: '', note: '' },
    { n: 2, title: 'dashboard แสดงยอด outlet ไม่เป็น 0', by: 'auto', result: 'pass', run: '20260727173450', note: 'รันรอบเช้า' },
    { n: 3, title: 'ตรวจ log ฝั่ง server', by: 'ข้าม', result: '–', run: '', note: 'ไม่เกี่ยวกับงานนี้' },
  ],
  notes: '',
};

test('serialize แล้ว parse กลับได้ของเดิมเป๊ะ', () => {
  assert.deepStrictEqual(parseQtest(serializeQtest(SHEET)), SHEET);
});

test('frontmatter key ที่โมดูลไม่รู้จักต้องรอดข้าม round trip', () => {
  // กันบั๊กคลาส whole-file-rewrite-drops-the-key-you-omit — UI เซฟทับทุกครั้งที่ติ๊กผล
  // ถ้า key แปลกหน้าหายไปเงียบ ๆ จะไม่มีใครเห็นจนกว่าจะสายเกินไป
  const sheet = { ...SHEET, meta: { ...SHEET.meta, sprint: 'S42', autoApproved: true } };
  const back = parseQtest(serializeQtest(sheet));
  assert.strictEqual(back.meta.sprint, 'S42');
  assert.strictEqual(back.meta.autoApproved, true);
  assert.deepStrictEqual(back, sheet);
});

test('หัวข้อที่มี | ในตัวเอง ไม่ทำให้คอลัมน์เพี้ยน', () => {
  const sheet = { ...SHEET, items: [{ n: 1, title: 'กด A | B แล้วต้องไม่ค้าง', by: 'qa', result: '–', run: '', note: '' }] };
  const back = parseQtest(serializeQtest(sheet));
  assert.strictEqual(back.items[0].title, 'กด A | B แล้วต้องไม่ค้าง');
  assert.strictEqual(back.items.length, 1);
});

test('parse ทน CRLF', () => {
  const back = parseQtest(serializeQtest(SHEET).replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(back, SHEET);
});

test('บันทึกเพิ่มเติมหลายบรรทัดรอดข้าม round trip', () => {
  const sheet = { ...SHEET, notes: 'บรรทัดแรก\n\nบรรทัดสาม' };
  assert.strictEqual(parseQtest(serializeQtest(sheet)).notes, 'บรรทัดแรก\n\nบรรทัดสาม');
});

test('serialize เขียนเลขลำดับใหม่ตามตำแหน่งจริง ไม่เชื่อ n ที่ส่งมา', () => {
  // ลำดับคือ "ลำดับการเทสของใบนี้" — พอ UI ลบข้อกลางทิ้ง เลขต้องไล่ใหม่ ไม่ใช่เหลือ 1,3
  const sheet = { ...SHEET, items: [{ ...SHEET.items[0], n: 7 }, { ...SHEET.items[1], n: 9 }] };
  const back = parseQtest(serializeQtest(sheet));
  assert.deepStrictEqual(back.items.map(i => i.n), [1, 2]);
});

test('parse ไฟล์ที่ไม่มี frontmatter คืน null แทนที่จะโยน', () => {
  assert.strictEqual(parseQtest('# ไม่ใช่ใบเทส\n\nเนื้อความ'), null);
  assert.strictEqual(parseQtest(''), null);
});

test('ค่า by/result ที่ไม่รู้จักถูกดึงกลับเข้าค่าที่ยอมรับได้', () => {
  const text = serializeQtest(SHEET).replace('| qa |', '| ????? |').replace('| pass |', '| ????? |');
  const back = parseQtest(text);
  assert.ok(BY.includes(back.items[0].by));
  assert.ok(RESULT.includes(back.items[1].result));
});

test('qtestFilename ใช้ yyyymmdd-เลข issue', () => {
  assert.strictEqual(qtestFilename('2026-08-06', 690), '20260806-690.md');
});

test('nextQtestName เติมท้ายเมื่อส่งเทสซ้ำวันเดียวกัน', () => {
  const dir = tmpdir();
  assert.deepStrictEqual(nextQtestName(dir, '2026-08-06', 690), { name: '20260806-690.md', round: 1 });
  fs.writeFileSync(path.join(dir, '20260806-690.md'), serializeQtest(SHEET));
  assert.deepStrictEqual(nextQtestName(dir, '2026-08-06', 690), { name: '20260806-690-2.md', round: 2 });
  fs.writeFileSync(path.join(dir, '20260806-690-2.md'), serializeQtest(SHEET));
  assert.deepStrictEqual(nextQtestName(dir, '2026-08-06', 690), { name: '20260806-690-3.md', round: 3 });
});

test('round นับรวมใบของ issue เดียวกันที่ส่งไว้คนละวัน', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, '20260801-690.md'), serializeQtest(SHEET));
  assert.deepStrictEqual(nextQtestName(dir, '2026-08-06', 690), { name: '20260806-690.md', round: 2 });
});

test('round ไม่นับ issue อื่นที่ขึ้นต้นด้วยเลขเดียวกัน', () => {
  // 6901 ไม่ใช่รอบที่สองของ 690 — prefix match ล้วน ๆ จะนับผิด
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, '20260801-6901.md'), serializeQtest(SHEET));
  assert.deepStrictEqual(nextQtestName(dir, '2026-08-06', 690), { name: '20260806-690.md', round: 1 });
});

test('listQtests คืนใบใหม่สุดก่อน และข้ามไฟล์ที่ parse ไม่ได้', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, '20260801-690.md'), serializeQtest(SHEET));
  fs.writeFileSync(path.join(dir, '20260806-690.md'), serializeQtest({ ...SHEET, meta: { ...SHEET.meta, round: 2 } }));
  fs.writeFileSync(path.join(dir, 'README.md'), 'ไม่ใช่ใบเทส');
  const list = listQtests(dir);
  assert.deepStrictEqual(list.map(s => s.file), ['20260806-690.md', '20260801-690.md']);
  assert.strictEqual(list[0].meta.round, 2);
});

test('listQtests กับโฟลเดอร์ที่ยังไม่มี คืน [] ไม่โยน', () => {
  assert.deepStrictEqual(listQtests(path.join(tmpdir(), 'ยังไม่สร้าง')), []);
});
