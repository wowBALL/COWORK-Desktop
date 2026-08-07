'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseQtest, serializeQtest, qtestFilename, nextQtestName, listQtests, BY, RESULT,
  formatTestResults, mergeTestResults, latestQtestFor,
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
    { n: 1, title: 'login ด้วยบัญชี owner แล้ว sidebar แสดงเมนูครบ', by: 'qa', result: '–', cause: '', date: '', system: '', test: '', run: '', note: '' },
    { n: 2, title: 'dashboard แสดงยอด outlet ไม่เป็น 0', by: 'auto', result: 'pass', cause: '', date: '2026-08-06', system: 'Test-case-mobile', test: 'zinga-wallet-test-food-chanyathaidemo.js', run: '20260727173450', note: 'รันรอบเช้า' },
    { n: 3, title: 'ตรวจ log ฝั่ง server', by: 'ข้าม', result: '–', cause: '', date: '', system: '', test: '', run: '', note: 'ไม่เกี่ยวกับงานนี้' },
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

// ---- คอลัมน์ "วันที่" (เพิ่มทีหลัง) ----

test('ใบเก่าที่ยังไม่มีคอลัมน์วันที่ ต้องอ่านได้ครบทุกแถว', () => {
  // เพิ่มคอลัมน์แล้วนับตำแหน่งตายตัว = แถวเก่าถูกทิ้งทั้งแถวเงียบ ๆ ใบที่ทำไว้แล้วจะกลายเป็นใบเปล่า
  const old = [
    '---', 'qtest: 1', 'issue: 690', '---', '',
    '## Checklist', '',
    '| # | สิ่งที่ต้องทดสอบ | ทำโดย | ผล | run | หมายเหตุ |',
    '|---|---|---|---|---|---|',
    '| 1 | login ให้ผ่าน | qa | pass |  | ดูด้วยตา |',
    '| 2 | ยอดตรง | auto | fail | 20260727173450 |  |', '',
    '## บันทึกเพิ่มเติม', '',
  ].join('\n');
  const back = parseQtest(old);
  assert.strictEqual(back.items.length, 2);
  assert.deepStrictEqual(back.items[0], { n: 1, title: 'login ให้ผ่าน', by: 'qa', result: 'pass', cause: '', date: '', system: '', test: '', run: '', note: 'ดูด้วยตา' });
  assert.deepStrictEqual(back.items[1], { n: 2, title: 'ยอดตรง', by: 'auto', result: 'fail', cause: '', date: '', system: '', test: '', run: '20260727173450', note: '' });
});

test('อ่านคอลัมน์ตามชื่อในแถวหัวตาราง ไม่ใช่ตามตำแหน่ง', () => {
  // แก้ไฟล์ด้วยมือแล้วสลับคอลัมน์ได้ — ยึดหัวตารางแล้วค่าจะไม่ไปเข้าช่องผิด
  const swapped = [
    '---', 'qtest: 1', '---', '', '## Checklist', '',
    '| # | สิ่งที่ต้องทดสอบ | ผล | ทำโดย | หมายเหตุ | วันที่ | ระบบ | เทส | run | สาเหตุ |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '| 1 | ก | fail | auto | หมายเหตุ ก | 2026-08-06 | test-case | t.spec.js | 20260727173450 | สคริป |', '',
    '## บันทึกเพิ่มเติม', '',
  ].join('\n');
  assert.deepStrictEqual(parseQtest(swapped).items[0],
    { n: 1, title: 'ก', by: 'auto', result: 'fail', cause: 'สคริป', date: '2026-08-06', system: 'test-case', test: 't.spec.js', run: '20260727173450', note: 'หมายเหตุ ก' });
});

test('serialize เขียนหัวตารางครบทุกคอลัมน์ตามลำดับที่ตกลงไว้', () => {
  const head = serializeQtest(SHEET).split('\n').find(l => l.startsWith('| #'));
  assert.strictEqual(head, '| # | สิ่งที่ต้องทดสอบ | ทำโดย | ผล | สาเหตุ | วันที่ | ระบบ | เทส | run | หมายเหตุ |');
});

// ---- คอลัมน์ "สาเหตุ" และ "ระบบ" (เพิ่มทีหลังอีกรอบ) ----

test('ใบที่เขียนก่อนมีคอลัมน์สาเหตุ/ระบบ ต้องอ่านได้ครบทุกแถว', () => {
  // บทเรียนเดิมซ้ำรอบสาม — fixture ต้องเป็นสตริงดิบของ schema เก่าจริง ๆ ห้าม generate
  // ด้วย serializeQtest รุ่นปัจจุบัน ไม่งั้นเทสพิสูจน์แค่ว่ารุ่นนี้คุยกับตัวเองรู้เรื่อง
  const old = [
    '---', 'qtest: 1', 'issue: 690', '---', '', '## Checklist', '',
    '| # | สิ่งที่ต้องทดสอบ | ทำโดย | ผล | วันที่ | เทส | run | หมายเหตุ |',
    '|---|---|---|---|---|---|---|---|',
    '| 1 | ยอดตรง | auto | fail | 2026-08-06 | a.spec.js | 20260806101122 | เจ๊งตอนกดจ่าย |', '',
    '## บันทึกเพิ่มเติม', '',
  ].join('\n');
  assert.deepStrictEqual(parseQtest(old).items[0], {
    n: 1, title: 'ยอดตรง', by: 'auto', result: 'fail', cause: '', date: '2026-08-06',
    system: '', test: 'a.spec.js', run: '20260806101122', note: 'เจ๊งตอนกดจ่าย',
  });
});

test('สาเหตุที่ไม่รู้จักถูกดึงกลับเป็นว่าง = ยังไม่ได้ตรวจ', () => {
  // "ยังไม่ได้ตรวจ" ปลอดภัยกว่าเดาว่าเป็นอะไรสักอย่าง เพราะมันไปโผล่ใน Test Results ที่ dev อ่าน
  const text = serializeQtest({ meta: { qtest: 1 }, items: [{ title: 'ก', by: 'auto', result: 'fail', cause: 'สคริป' }], notes: '' })
    .replace('| สคริป |', '| อะไรก็ไม่รู้ |');
  assert.strictEqual(parseQtest(text).items[0].cause, '');
});

// ---- สรุปผลกลับ Redmine ----
// ข้อความก้อนนี้ไปโผล่ใน field ที่ dev อ่านต่อ พลาดแล้วไม่มีอะไรฟ้อง: ข้อที่ยังไม่ติ๊ก
// หายไปเงียบ ๆ · หมายเหตุที่บอกว่าพังยังไงหลุด · ของเดิมใน field ถูกทับ
const FINISH_SHEET = {
  file: '20260806-690-2.md',
  meta: { issue: 690, round: 2, subject: 'sidebar ว่าง' },
  items: [
    { title: 'login แล้ว sidebar ขึ้นครบ', by: 'qa', result: 'pass', date: '2026-08-06', test: '', run: '', note: '' },
    { title: 'ยอด outlet ตรง', by: 'auto', result: 'pass', date: '2026-08-06', test: 'a.spec.js', run: '20260806101122', note: '' },
    { title: 'owner_id ต้องไม่ว่าง', by: 'qa', result: 'fail', date: '2026-08-07', test: '', run: '', note: 'เหลือ 3 outlet' },
    { title: 'ทดสอบบน Safari', by: 'ข้าม', result: '–', date: '', test: '', run: '', note: '' },
  ],
  notes: 'รอบนี้เทสบน dev',
};
const FINISH_TALLY = { total: 4, skipped: 1, active: 3, pass: 2, fail: 1, todo: 0 };

test('formatTestResults: ทุกข้อขึ้นครบ พร้อมป้ายผลและหมายเหตุ', () => {
  const out = formatTestResults(FINISH_SHEET, FINISH_TALLY, 'fail', '2026-08-07');
  assert.match(out, /^ผลทดสอบรอบที่ 2 — สรุป: ไม่ผ่าน \(2026-08-07\)$/m);
  assert.match(out, /^ผ่าน 2 · ไม่ผ่าน 1 · ข้าม 1 \(ทั้งหมด 4 ข้อ\)$/m);
  assert.match(out, /^1\. \[PASS\] login แล้ว sidebar ขึ้นครบ — 2026-08-06$/m);
  assert.match(out, /^2\. \[PASS\] ยอด outlet ตรง — 2026-08-06 · auto · run 20260806101122$/m);
  assert.match(out, /^3\. \[FAIL\] owner_id ต้องไม่ว่าง — 2026-08-07$/m);
  assert.match(out, /^ {3}หมายเหตุ: เหลือ 3 outlet$/m);
  assert.match(out, /^4\. \[ข้าม\] ทดสอบบน Safari$/m);
  assert.ok(out.includes('\nบันทึกเพิ่มเติม:\nรอบนี้เทสบน dev\n'));
  assert.match(out, /\(จากใบเทส 20260806-690-2\.md\)$/);
});

test('formatTestResults: ข้อที่ยังไม่ติ๊กต้องพูดออกมา ไม่ใช่หายไปจากสรุป', () => {
  // "เตือนแต่กดได้" — ใบที่ยังไม่ครบส่งกลับได้ แต่ผู้อ่านต้องเห็นว่าข้อไหนไม่ได้ทดสอบ
  const sheet = { file: 'x.md', meta: { round: 1 }, items: [{ title: 'ยังไม่ได้ทำ', by: 'qa', result: '–' }], notes: '' };
  const out = formatTestResults(sheet, { total: 1, skipped: 0, active: 1, pass: 0, fail: 0, todo: 1 }, 'success', '2026-08-07');
  assert.match(out, /^1\. \[ยังไม่ทดสอบ\] ยังไม่ได้ทำ$/m);
  assert.match(out, /ยังไม่ทดสอบ 1/);
});

test('formatTestResults: ข้อที่ข้ามอ่านเป็น [ข้าม] แม้ผลเก่ายังค้างในไฟล์', () => {
  // ใบที่แก้ด้วยมือมี by=ข้าม กับ result=pass พร้อมกันได้ — ข้ามแปลว่าไม่ได้ทดสอบ ต้องชนะ
  const sheet = { file: 'x.md', meta: { round: 1 }, items: [{ title: 'ก', by: 'ข้าม', result: 'pass', date: '2026-08-01' }], notes: '' };
  const out = formatTestResults(sheet, { total: 1, skipped: 1, active: 0, pass: 0, fail: 0, todo: 0 }, 'fail', '2026-08-07');
  assert.match(out, /\[ข้าม\] ก/);
  assert.ok(!out.includes('[PASS]'));
});

test('mergeTestResults: ต่อท้ายของเดิม ไม่ทับ', () => {
  const merged = mergeTestResults('ผลรอบที่ 1 เดิม\n', 'ผลรอบที่ 2');
  assert.strictEqual(merged, 'ผลรอบที่ 1 เดิม\n\n---\n\nผลรอบที่ 2');
});
test('mergeTestResults: field ว่างไม่ได้เส้นคั่นนำหน้า', () => {
  assert.strictEqual(mergeTestResults('', 'ผลรอบที่ 1'), 'ผลรอบที่ 1');
  assert.strictEqual(mergeTestResults('   \n ', 'ผลรอบที่ 1'), 'ผลรอบที่ 1');
});

test('latestQtestFor: เลือกรอบล่าสุดของ issue นั้น ไม่ใช่ชื่อไฟล์ล่าสุด', () => {
  // ชื่อไฟล์ "…-690-2.md" กับ "…-690.md" ต่างกันที่ - กับ . ซึ่ง localeCompare
  // ชั่งน้ำหนักตามกฎภาษา ไม่ใช่ตามลำดับ codepoint — เรียงตาม round จึงเชื่อถือได้กว่า
  const sheets = [
    { file: '20260806-690.md', meta: { issue: 690, round: 1 } },
    { file: '20260806-690-2.md', meta: { issue: 690, round: 2 } },
    { file: '20260807-691.md', meta: { issue: 691, round: 1 } },
  ];
  assert.strictEqual(latestQtestFor(sheets, 690).meta.round, 2);
  assert.strictEqual(latestQtestFor(sheets, '690').meta.round, 2);   // renderer ส่งมาเป็นสตริงได้
  assert.strictEqual(latestQtestFor(sheets, 999), null);
  assert.strictEqual(latestQtestFor([], 690), null);
});
