const test = require('node:test');
const assert = require('node:assert');
const {M} = require('../util.js');

// datefilter.js หยิบ util จาก global.COWORK ก่อน แล้วค่อยถอยไป require('./util.js')
// ตั้ง global ไว้ก่อน require จึงฉีด esc เข้าไปได้โดยไม่ต้องแก้โปรดักชัน — จำเป็นเพราะ
// util.js ไม่ export esc ออกมาใต้ node (ตัวจริงต้องใช้ document)
//
// สตับเป็น identity ได้เพราะค่าที่ dateFilterHtml ส่งเข้า esc มีแต่ชิ้นส่วนวันที่
// (YYYY / YYYY-MM / YYYY-MM-DD) ซึ่ง escape แล้วได้ค่าเดิม — มีเทสท้ายไฟล์ค้ำเงื่อนไขนี้ไว้
// ถ้าวันหนึ่งมีคนส่งข้อความจากผู้ใช้ผ่าน esc ในฟังก์ชันนี้ เทสตัวนั้นจะแดงทันที
const escSeen = [];
globalThis.COWORK = {util: {M, esc: v => { escSeen.push(v); return String(v); }}};
const {dateMatch, dateFilterHtml, wireDateFilter} = require('../datefilter.js');

const NONE = () => ({y: null, m: null, d: null});

// ผู้เรียกจริงส่ง object เข้ามาพร้อม getDate — ห่อสตริงให้เหมือนของจริง
// Meeting ส่ง m=>m.date (ว่างได้ถ้าชื่อโฟลเดอร์ไม่เข้าแพตเทิร์น) · QA ส่ง qaDateOf (null ได้)
const listOf = dates => dates.map(d => ({date: d}));
const html = (dates, sel) => dateFilterHtml(listOf(dates), x => x.date, sel);

// ===== ตัวอ่าน HTML ที่ dateFilterHtml คืนมา =====
// อ่านจากผลลัพธ์จริงแทนที่จะเดาโครงสร้าง — ถ้าชื่อคลาสหรือ attribute เปลี่ยน เทสจะรู้
function rowsOf(h) {
  return h.split('<div class="chips" data-df="').slice(1).map(seg => ({
    key: seg.slice(0, 1),
    chips: [...seg.matchAll(/<div class="(chip[^"]*)" data-v="([^"]*)">([^<]*)<span class="n">(\d+)</g)]
      .map(m => ({active: m[1].includes('active'), v: m[2], label: m[3], n: +m[4]})),
  }));
}
const keysOf = h => rowsOf(h).map(r => r.key);
const rowNamed = (h, k) => rowsOf(h).find(r => r.key === k);

// ===== dateMatch =====

test('dateMatch: ไม่ได้กรอง = ผ่านทุกอย่าง รวมรายการที่ไม่มีวันที่', () => {
  assert.strictEqual(dateMatch(NONE(), null), true);
  assert.strictEqual(dateMatch(NONE(), ''), true);
  assert.strictEqual(dateMatch(NONE(), '2026-07-28'), true);
});

test('dateMatch: พอกรองแล้ว รายการที่ไม่มีวันที่ตกทุกกรณี', () => {
  assert.strictEqual(dateMatch({y: '2026', m: null, d: null}, null), false);
  assert.strictEqual(dateMatch({y: null, m: '2026-07', d: null}, ''), false);
});

test('dateMatch: แต่ละชั้นเทียบ prefix ของตัวเอง', () => {
  const d = '2026-07-28';
  assert.strictEqual(dateMatch({y: '2026', m: null, d: null}, d), true);
  assert.strictEqual(dateMatch({y: '2025', m: null, d: null}, d), false);
  assert.strictEqual(dateMatch({y: null, m: '2026-07', d: null}, d), true);
  assert.strictEqual(dateMatch({y: null, m: '2026-06', d: null}, d), false);
  assert.strictEqual(dateMatch({y: null, m: null, d: '2026-07-28'}, d), true);
  assert.strictEqual(dateMatch({y: null, m: null, d: '2026-07-27'}, d), false);
});

test('dateMatch: หลายชั้นต่อกันด้วย AND', () => {
  assert.strictEqual(dateMatch({y: '2026', m: '2026-07', d: null}, '2026-07-28'), true);
  // ชั้นที่ขัดกันเองต้องตัดทิ้ง ไม่ใช่ให้ชั้นใดชั้นหนึ่งชนะ
  assert.strictEqual(dateMatch({y: '2026', m: '2026-06', d: null}, '2026-07-28'), false);
});

// ===== dateFilterHtml: แถวไหนโผล่ =====

test('ชั้นที่มีค่าเดียวถูกข้ามไป — ข้อมูลปีเดียวเดือนเดียวเห็นแต่แถววัน', () => {
  const h = html(['2026-07-28', '2026-07-27', '2026-07-27'], NONE());
  assert.deepStrictEqual(keysOf(h), ['d']);
});

test('ชั้นล่างยังไม่โผล่จนกว่าชั้นบนจะถูกจำกัด — สองเดือนเห็นแต่แถวเดือน', () => {
  // ถ้าปล่อยแถววันโผล่ตรงนี้ เลข 28 จะกำกวมระหว่าง 28 มิ.ย. กับ 28 ก.ค.
  const h = html(['2026-07-28', '2026-06-28'], NONE());
  assert.deepStrictEqual(keysOf(h), ['m']);
});

test('เลือกเดือนแล้วแถววันจึงโผล่', () => {
  const h = html(['2026-07-28', '2026-07-27', '2026-06-15'], {y: null, m: '2026-07', d: null});
  assert.deepStrictEqual(keysOf(h), ['m', 'd']);
});

test('ชั้นกลางที่ยุบเหลือค่าเดียวหลังถูกจำกัดก็ถูกข้ามด้วย', () => {
  // เลือกปี 2026 แล้วเหลือเดือนเดียว → ข้ามแถวเดือน กระโดดไปแถววันเลย
  const h = html(['2026-07-28', '2026-07-27', '2025-06-15'], {y: '2026', m: null, d: null});
  assert.deepStrictEqual(keysOf(h), ['y', 'd']);
});

// ===== dateFilterHtml: ป้ายชิป =====

test('ป้ายวันติดชื่อเดือนมาด้วยเมื่อแถวเดือนไม่ได้โชว์', () => {
  const h = html(['2026-07-28', '2026-07-27'], NONE());
  assert.deepStrictEqual(rowNamed(h, 'd').chips.map(c => c.label),
    ['ทั้งเดือน', '28 ก.ค.', '27 ก.ค.']);
});

test('ป้ายวันเป็นเลขเปล่าเมื่อแถวเดือนโชว์อยู่แล้ว', () => {
  const h = html(['2026-07-28', '2026-07-27', '2026-06-15'], {y: null, m: '2026-07', d: null});
  assert.deepStrictEqual(rowNamed(h, 'd').chips.map(c => c.label), ['ทั้งเดือน', '28', '27']);
  assert.deepStrictEqual(rowNamed(h, 'm').chips.map(c => c.label), ['ทั้งปี', 'ก.ค.', 'มิ.ย.']);
});

test('ชิปเรียงจากใหม่ไปเก่า', () => {
  const h = html(['2024-01-01', '2026-01-01', '2025-01-01'], NONE());
  assert.deepStrictEqual(rowNamed(h, 'y').chips.map(c => c.v), ['', '2026', '2025', '2024']);
});

// ===== dateFilterHtml: ล้างค่าที่ค้าง =====

test('ล้างค่าที่หายไปจากข้อมูล แม้ข้อมูลใหม่จะเหลือค่าเดียว', () => {
  // เคสที่เคยพัง: ค้าง 2025 แต่ข้อมูลใหม่มีแต่ 2026 — แถวปีถูกข้ามเพราะมีค่าเดียว
  // ถ้าไม่ล้างตรงนี้ ตัวกรองจะกลายเป็นล่องหน กรองจนเหลือ 0 รายการโดยไม่มีชิปให้กดออก
  const sel = {y: '2025', m: null, d: null};
  const h = html(['2026-07-28', '2026-07-27'], sel);
  assert.deepStrictEqual(sel, NONE());
  assert.deepStrictEqual(keysOf(h), ['d']);
});

test('ล้างค่าของแถวที่ไม่ได้โชว์ทั้งที่ยังมีหลายค่าให้เลือก', () => {
  // ค้างวันไว้ตอนที่ยังมีสองปีและยังไม่ได้เลือกปี — แถววันโชว์ไม่ได้ ค่าจึงต้องถูกล้าง
  const sel = {y: null, m: null, d: '2026-07-28'};
  const h = html(['2026-07-28', '2025-07-28'], sel);
  assert.deepStrictEqual(sel, NONE());
  assert.deepStrictEqual(keysOf(h), ['y']);
});

test('ล้างชั้นบนแล้วชั้นล่างถูกล้างตามไปด้วย', () => {
  const sel = {y: '2024', m: '2024-05', d: '2024-05-09'};
  html(['2026-07-28', '2026-06-15'], sel);
  assert.deepStrictEqual(sel, NONE());
});

test('ล้างชั้นบนแล้วชั้นล่างถูกล้างตาม แม้ค่าชั้นล่างจะยังเลือกได้อยู่', () => {
  // ค้าง d=2026-07-28 ซึ่ง "ยังมีอยู่จริง" ในข้อมูลใหม่ และแถววันก็โชว์อยู่ — ไม่มีเงื่อนไขไหน
  // ล้างมันได้ด้วยตัวเอง ต้องอาศัยการลามจากชั้นปีที่ค้าง 2025 ไว้แล้วหายไปเท่านั้น
  // เหตุผลที่ต้องล้าง: วันนั้นถูกเลือกในบริบทของปีที่ไม่มีแล้ว ปล่อยติดไว้คือกรองต่อโดยผู้ใช้ไม่ได้สั่ง
  const sel = {y: '2025', m: null, d: '2026-07-28'};
  const h = html(['2026-07-28', '2026-07-27'], sel);
  assert.deepStrictEqual(sel, NONE());
  assert.deepStrictEqual(rowNamed(h, 'd').chips.filter(c => c.active).map(c => c.v), ['']);
});

test('ลิสต์ว่าง: ล้างทุกชั้นและไม่คืนแถวอะไรเลย', () => {
  const sel = {y: '2026', m: null, d: null};
  const h = html([], sel);
  assert.deepStrictEqual(sel, NONE());
  assert.strictEqual(h, '');
});

test('ค่าที่ยังเลือกได้อยู่ต้องไม่ถูกล้าง', () => {
  const sel = {y: '2026', m: null, d: null};
  html(['2026-07-28', '2025-06-15'], sel);
  assert.deepStrictEqual(sel, {y: '2026', m: null, d: null});
});

// ===== dateFilterHtml: เลขบนชิป =====

test('ชิป "ทั้งหมด" นับ pool ที่รับเข้ามา ชิปแต่ละค่านับเฉพาะส่วนของตัวเอง', () => {
  const h = html(['2026-07-28', '2026-07-27', '2026-07-27', '2026-06-15'], NONE());
  assert.deepStrictEqual(rowNamed(h, 'm').chips.map(c => [c.v, c.n]),
    [['', 4], ['2026-07', 3], ['2026-06', 1]]);
});

test('เลขชิงชั้นล่างนับหลังหักตัวเลือกของชั้นบนแล้ว', () => {
  const h = html(['2026-07-28', '2026-07-27', '2025-06-15'], {y: '2026', m: null, d: null});
  // ชิป "ทุกปี" ยังนับทั้ง 3 เพราะกดแล้วคือเลิกกรอง — แต่แถววันข้างล่างเหลือ 2
  assert.deepStrictEqual(rowNamed(h, 'y').chips.map(c => [c.v, c.n]),
    [['', 3], ['2026', 2], ['2025', 1]]);
  assert.strictEqual(rowNamed(h, 'd').chips[0].n, 2);
});

test('รายการที่ไม่มีวันที่ไม่ถูกนับในชิปเลย', () => {
  const h = html(['2026-07-28', '', null, undefined, '2026-06-15'], NONE());
  assert.strictEqual(rowNamed(h, 'm').chips[0].n, 2);
});

test('ชิปที่ติดไฟคือชิปที่ถูกเลือก ถ้ายังไม่เลือกไฟอยู่ที่ชิป "ทั้งหมด"', () => {
  const none = rowNamed(html(['2026-07-28', '2026-06-15'], NONE()), 'm');
  assert.deepStrictEqual(none.chips.filter(c => c.active).map(c => c.v), ['']);
  const picked = rowNamed(html(['2026-07-28', '2026-06-15'], {y: null, m: '2026-06', d: null}), 'm');
  assert.deepStrictEqual(picked.chips.filter(c => c.active).map(c => c.v), ['2026-06']);
});

// ===== wireDateFilter =====

// element ปลอมที่ "ประกอบจากผลลัพธ์จริงของ dateFilterHtml" ไม่ใช่จากโครงสร้างที่นึกเอง
// ผูกเฉพาะสี่อย่างที่ wireDateFilter ใช้: querySelectorAll ของแถว/ชิป · dataset.df · dataset.v · onclick
function fakeEl(h) {
  const rows = rowsOf(h).map(r => ({
    dataset: {df: r.key},
    _chips: r.chips.map(c => ({dataset: {v: c.v}, onclick: null})),
    querySelectorAll(sel) { assert.strictEqual(sel, '.chip'); return this._chips; },
  }));
  assert.ok(rows.length, 'HTML ที่ใช้ทดสอบต้องมีอย่างน้อยหนึ่งแถว ไม่งั้นเทสผ่านแบบว่างเปล่า');
  return {
    rows,
    querySelectorAll(sel) { assert.strictEqual(sel, '.chips[data-df]'); return rows; },
    click(k, v) {
      const row = rows.find(r => r.dataset.df === k);
      const chip = row._chips.find(c => c.dataset.v === v);
      assert.ok(chip, `ไม่มีชิป ${k}=${JSON.stringify(v)} ในผลลัพธ์จริง`);
      chip.onclick();
    },
  };
}

test('wireDateFilter: กดชิปที่มีค่า = ตั้งค่าให้ชั้นนั้น แล้วเรียก onChange', () => {
  const sel = NONE();
  const el = fakeEl(html(['2026-07-28', '2026-06-15'], sel));
  let calls = 0;
  wireDateFilter(el, sel, () => calls++);
  el.click('m', '2026-06');
  assert.deepStrictEqual(sel, {y: null, m: '2026-06', d: null});
  assert.strictEqual(calls, 1);
});

test('wireDateFilter: กดชิป "ทั้งหมด" = ล้างชั้นนั้น', () => {
  const sel = {y: null, m: '2026-06', d: null};
  const el = fakeEl(html(['2026-07-28', '2026-06-15'], sel));
  wireDateFilter(el, sel, () => {});
  el.click('m', '');
  assert.deepStrictEqual(sel, NONE());
});

test('wireDateFilter: เลือกชั้นบนใหม่ล้างชั้นล่างเสมอ', () => {
  const sel = {y: '2026', m: null, d: '2026-07-28'};
  const el = fakeEl(html(['2026-07-28', '2026-07-27', '2025-06-15'], sel));
  wireDateFilter(el, sel, () => {});
  el.click('y', '2025');
  // ไม่ใช่แค่ y เปลี่ยน — d ที่ค้างจาก 2026 ต้องหายไปด้วย ไม่งั้นกรองจนเหลือศูนย์
  assert.deepStrictEqual(sel, {y: '2025', m: null, d: null});
});

// ===== ค้ำสมมติฐานของสตับ esc =====

test('ทุกค่าที่ผ่าน esc เป็นชิ้นส่วนวันที่ล้วน สตับ identity จึงใช้แทนตัวจริงได้', () => {
  assert.ok(escSeen.length > 20, `เทสข้างบนต้องเรียก esc มาแล้วจริง (ได้ ${escSeen.length})`);
  const bad = escSeen.filter(v => !/^\d{4}(-\d{2}){0,2}$/.test(v));
  assert.deepStrictEqual(bad, [], 'มีค่าที่ไม่ใช่วันที่ถูกส่งผ่าน esc — สตับใช้แทนตัวจริงไม่ได้แล้ว');
});
