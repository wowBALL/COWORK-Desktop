const test = require('node:test');
const assert = require('node:assert');
const { xmlEscape, treeToXml } = require('../webdump.js');

const META = { width: 1280, height: 800, url: 'https://x.test/a?b=1&c=2', title: 'หน้า "ทดสอบ"' };

// ตัวช่วยสร้าง node ให้เทสอ่านง่าย — ระบุเฉพาะฟิลด์ที่เคสนั้นสนใจ
function n(over) {
  return Object.assign({
    cls: 'div', rid: '', text: '', desc: '',
    bounds: [0, 0, 10, 10], clickable: false, scrollable: false, children: [],
  }, over);
}

test('xmlEscape: หนีอักขระที่ทำให้ XML พังครบทั้งสี่ตัว', () => {
  assert.strictEqual(xmlEscape('a & b < c > d "e"'),
    'a &amp; b &lt; c &gt; d &quot;e&quot;');
});

test('xmlEscape: ตัด control character ที่ XML 1.0 ไม่ยอมรับทิ้ง (ไม่งั้น DOMParser พังทั้งไฟล์)', () => {
  assert.strictEqual(xmlEscape('a\u0000b\u0008c\u001Fd'), 'abcd');
  assert.strictEqual(xmlEscape('คง\tแท็บ\nกับ\rขึ้นบรรทัด'), 'คง\tแท็บ\nกับ\rขึ้นบรรทัด');
});

test('treeToXml: ข้อความในหน้าเว็บที่มีอักขระพิเศษต้องถูกหนีในผลลัพธ์', () => {
  const xml = treeToXml(n({ cls: 'span', text: 'ราคา < 100 & ส่วนลด "พิเศษ"' }), META);
  assert.ok(xml.includes('text="ราคา &lt; 100 &amp; ส่วนลด &quot;พิเศษ&quot;"'), xml);
});

test('treeToXml: attribute ที่ว่างต้องไม่ปรากฏเลย ไม่ใช่โผล่มาเป็นค่าว่าง', () => {
  const xml = treeToXml(n({ cls: 'div' }), META);
  assert.ok(!xml.includes('text='), 'text ว่างต้องไม่มี attribute');
  assert.ok(!xml.includes('content-desc='), 'content-desc ว่างต้องไม่มี attribute');
  assert.ok(!xml.includes('resource-id='), 'resource-id ว่างต้องไม่มี attribute');
  assert.ok(!xml.includes('clickable='), 'clickable=false ต้องไม่มี attribute');
  assert.ok(!xml.includes('scrollable='), 'scrollable=false ต้องไม่มี attribute');
});

test('treeToXml: bounds ออกมาเป็น [x1,y1][x2,y2] และให้เลขสี่ตัวตามที่ uidump.parseBounds ต้องการ', () => {
  const xml = treeToXml(n({ bounds: [12, 34, 56, 78] }), META);
  assert.ok(xml.includes('bounds="[12,34][56,78]"'), xml);
  const m = /bounds="([^"]+)"/.exec(xml)[1].match(/-?\d+/g);
  assert.strictEqual(m.length, 4, 'parseBounds ต้องได้เลขสี่ตัวพอดี ไม่งั้นวิวเวอร์ทิ้ง node นี้');
});

test('treeToXml: โครงต้องซ้อนกันตามต้นไม้ที่ป้อน ไม่ใช่แบนออกมาเรียงกัน', () => {
  const xml = treeToXml(
    n({ cls: 'div', rid: 'dialog', children: [
      n({ cls: 'div[tablist]', children: [n({ cls: 'button[tab]', text: 'Zones', clickable: true })] }),
    ] }),
    META,
  );
  // ปิดแท็กลูกก่อนปิดแท็กพ่อเสมอ — ถ้าแบน จะเจอ /> ของ tablist ก่อนที่ tab จะโผล่
  const iTab = xml.indexOf('Zones');
  const iCloseOuter = xml.lastIndexOf('</node>');
  assert.ok(iTab > 0 && iTab < iCloseOuter, 'ลูกต้องอยู่ข้างในพ่อ ไม่ใช่ต่อท้าย');
  assert.ok(xml.includes('<node class="div[tablist]"'), xml);
  assert.ok(/<node class="button\[tab\]"[^>]*clickable="true"\/>/.test(xml), xml);
});

test('treeToXml: หัวไฟล์เป็น <hierarchy> ที่มี width/height/url/title ตามที่ uidump.screenSize อ่าน', () => {
  const xml = treeToXml(n({}), META);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), xml.slice(0, 60));
  assert.ok(xml.includes('<hierarchy width="1280" height="800"'), xml);
  assert.ok(xml.includes('url="https://x.test/a?b=1&amp;c=2"'), 'url ต้องถูกหนีด้วย');
  assert.ok(xml.includes('title="หน้า &quot;ทดสอบ&quot;"'), 'title ต้องถูกหนีด้วย');
  assert.ok(xml.trimEnd().endsWith('</hierarchy>'), xml.slice(-40));
});

const vm = require('node:vm');
const { collectTree, countNodes, dumpPage, injectableSource } = require('../webdump.js');

// ---- DOM ปลอมขั้นต่ำ: มีเฉพาะสิ่งที่ collectTree เรียกใช้จริง ----
// ไม่ใช้ jsdom เพราะโปรเจกต์นี้ไม่มี dependency ภายนอกในเทสเลย และของปลอมเล็ก ๆ ทำให้เห็นชัด
// ว่าโค้ดพึ่ง API อะไรบ้าง (ถ้าวันหลังมีคนเพิ่มการเรียก API ใหม่ เทสจะพังทันที ซึ่งเป็นผลดี)
function el(tag, opts) {
  opts = opts || {};
  const attrs = opts.attrs || {};
  const r = opts.rect || { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
  const kids = opts.children || [];
  return {
    tagName: tag.toUpperCase(),
    children: kids,
    childNodes: (opts.text == null ? [] : [{ nodeType: 3, nodeValue: opts.text }]).concat(kids),
    value: opts.value,
    scrollHeight: opts.scrollHeight == null ? 20 : opts.scrollHeight,
    clientHeight: opts.clientHeight == null ? 20 : opts.clientHeight,
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    getBoundingClientRect: () => r,
    __style: opts.style || {},
  };
}

function fakeDoc(body, title) {
  const html = el('html', { rect: { left: 0, top: 0, right: 1280, bottom: 900, width: 1280, height: 900 },
    children: [el('head'), body] });
  html.scrollWidth = 1280; html.scrollHeight = 900;
  return { documentElement: html, title: title == null ? 'ชื่อหน้า' : title };
}

function fakeWin(over) {
  return Object.assign({
    scrollX: 0, scrollY: 0, innerWidth: 1280, innerHeight: 800,
    location: { href: 'https://x.test/p' },
    getComputedStyle: (e) => Object.assign(
      { display: 'block', visibility: 'visible', opacity: '1', cursor: 'auto', overflowY: 'visible' },
      e.__style),
  }, over || {});
}

test('collectTree: เก็บ text ของตัวเองเท่านั้น ไม่ลากข้อความลูกขึ้นมาซ้ำ', () => {
  const child = el('span', { text: 'ข้างใน' });
  const body = el('body', { text: 'ข้างนอก', children: [child] });
  const root = collectTree(fakeDoc(body), fakeWin());
  const bodyNode = root.children[0];
  assert.strictEqual(bodyNode.text, 'ข้างนอก', 'ถ้าใช้ textContent จะได้ "ข้างนอกข้างใน" แล้วไฟล์บวมทุกชั้น');
  assert.strictEqual(bodyNode.children[0].text, 'ข้างใน');
});

test('collectTree: input/select/textarea เอาค่าที่กรอกอยู่มาเป็น text', () => {
  const input = el('input', { value: '90', attrs: { id: 'seatBeforeStart', 'aria-label': 'Seat Before Start' } });
  const root = collectTree(fakeDoc(el('body', { children: [input] })), fakeWin());
  const node = root.children[0].children[0];
  assert.strictEqual(node.text, '90');
  assert.strictEqual(node.rid, 'seatBeforeStart');
  assert.strictEqual(node.desc, 'Seat Before Start');
});

test('collectTree: node ที่มองไม่เห็นต้องยกลูกขึ้นไปต่อกับพ่อ ไม่ใช่ตัดทั้งกิ่งทิ้ง', () => {
  const deep = el('button', { text: 'Save', attrs: { id: 'save-btn' } });
  const hidden = el('div', { style: { display: 'none' }, children: [deep] });
  const root = collectTree(fakeDoc(el('body', { children: [hidden] })), fakeWin());
  const bodyNode = root.children[0];
  assert.strictEqual(bodyNode.children.length, 1, 'ลูกของกล่องที่มองไม่เห็นต้องยังอยู่');
  assert.strictEqual(bodyNode.children[0].text, 'Save');
});

test('collectTree: กล่องที่ไม่มีพื้นที่ถือว่ามองไม่เห็น (แต่ลูกยังถูกยกขึ้นมา)', () => {
  const inner = el('span', { text: 'ยังเห็น' });
  const zero = el('div', { rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, children: [inner] });
  const root = collectTree(fakeDoc(el('body', { children: [zero] })), fakeWin());
  assert.strictEqual(root.children[0].children[0].text, 'ยังเห็น');
});

test('collectTree: ข้าม script/style/head ไม่ให้โค้ดหลุดเข้า XML', () => {
  const body = el('body', { children: [
    el('script', { text: 'window.x=1' }),
    el('style', { text: 'body{color:red}' }),
    el('p', { text: 'เนื้อหาจริง' }),
  ] });
  const root = collectTree(fakeDoc(body), fakeWin());
  const texts = root.children[0].children.map(c => c.text);
  assert.deepStrictEqual(texts, ['เนื้อหาจริง']);
});

test('collectTree: bounds บวก scroll offset เป็นพิกัดของทั้งหน้า ไม่ใช่ของ viewport', () => {
  const box = el('div', { rect: { left: 10, top: 20, right: 110, bottom: 60, width: 100, height: 40 } });
  const root = collectTree(fakeDoc(el('body', { children: [box] })), fakeWin({ scrollX: 5, scrollY: 200 }));
  assert.deepStrictEqual(root.children[0].children[0].bounds, [15, 220, 115, 260]);
});

test('collectTree: clickable มาจาก tag/role/cursor ไม่ใช่เดาจากชื่อคลาส CSS', () => {
  const body = el('body', { children: [
    el('button', { text: 'B' }),
    el('a', { text: 'ลิงก์', attrs: { href: '/x' } }),
    el('a', { text: 'ไม่ใช่ลิงก์' }),
    el('div', { text: 'role', attrs: { role: 'tab' } }),
    el('div', { text: 'pointer', style: { cursor: 'pointer' } }),
    el('div', { text: 'เฉย ๆ' }),
  ] });
  const kids = collectTree(fakeDoc(body), fakeWin()).children[0].children;
  assert.deepStrictEqual(kids.map(k => k.clickable), [true, true, false, true, true, false]);
});

test('collectTree: scrollable ต้องดูทั้งความสูงที่ล้นและ overflow ไม่ใช่ดูอย่างใดอย่างหนึ่ง', () => {
  const body = el('body', { children: [
    // ล้นจริงและ overflow ไม่ใช่ visible = เลื่อนได้
    el('div', { text: 'เลื่อนได้', scrollHeight: 900, clientHeight: 300, style: { overflowY: 'auto' } }),
    // ล้นแต่ overflow:visible = เนื้อหาไหลออกนอกกล่อง ไม่ได้เลื่อน
    el('div', { text: 'ไม่ได้เลื่อน', scrollHeight: 900, clientHeight: 300, style: { overflowY: 'visible' } }),
    // overflow:auto แต่เนื้อหาไม่ล้น = ไม่มีแถบเลื่อนจริง
    el('div', { text: 'พอดี', scrollHeight: 300, clientHeight: 300, style: { overflowY: 'auto' } }),
  ] });
  const kids = collectTree(fakeDoc(body), fakeWin()).children[0].children;
  assert.deepStrictEqual(kids.map(k => k.scrollable), [true, false, false]);
});

test('collectTree: role ต่อท้ายชื่อ tag ใน class เพื่อให้โมเดลรู้บทบาทของ div เปล่า ๆ', () => {
  const body = el('body', { children: [el('div', { attrs: { role: 'tablist' } })] });
  const root = collectTree(fakeDoc(body), fakeWin());
  assert.strictEqual(root.children[0].children[0].cls, 'div[tablist]');
});

test('collectTree: iframe ข้าม origin ต้องเขียนบอกว่าอ่านไม่ได้ ไม่ใช่หายเงียบ', () => {
  const body = el('body', { children: [el('iframe', { attrs: { id: 'pay' } })] });
  const node = collectTree(fakeDoc(body), fakeWin()).children[0].children[0];
  assert.strictEqual(node.cls, 'iframe');
  assert.ok(node.desc.includes('อ่านไม่ได้'), 'ถ้าหายเงียบ โมเดลจะสรุปว่าหน้านี้ไม่มีส่วนนั้น');
});

test('dumpPage: คืน xml + meta ครบ และนับ node ได้', () => {
  const body = el('body', { children: [el('button', { text: 'Save' })] });
  const out = dumpPage(fakeDoc(body, 'Booking'), fakeWin());
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.title, 'Booking');
  assert.strictEqual(out.url, 'https://x.test/p');
  assert.strictEqual(out.nodes, 3, 'html + body + button');
  assert.ok(out.xml.includes('text="Save"'), out.xml);
});

test('countNodes: นับทั้งต้นไม้ ไม่ใช่แค่ชั้นบน', () => {
  assert.strictEqual(countNodes(n({ children: [n({}), n({ children: [n({})] })] })), 4);
});

// เทสสำคัญที่สุดของไฟล์นี้: ชุดโค้ดที่จะถูกฉีดต้องรันได้ในบริบทที่ไม่มีอะไรเลยนอกจาก document/window
// ถ้ามีใครเผลอให้ฟังก์ชันในชุดอ้าง constant ระดับโมดูล เทสอื่นจะยังเขียวหมด แต่ของจริงจะพัง
// ตอนกดปุ่มถอด — เทสนี้คือด่านเดียวที่จับได้
test('injectableSource: รันเองได้ในบริบทว่าง ไม่พึ่งอะไรนอกชุด', () => {
  const body = el('body', { children: [
    el('button', { text: 'ถอดได้' }),
    el('iframe', { attrs: { id: 'pay' } }),
  ] });
  const ctx = { document: fakeDoc(body, 'T'), window: fakeWin() };
  const out = vm.runInNewContext(injectableSource() + '\n;dumpPage(document, window)', ctx);
  assert.strictEqual(out.ok, true);
  assert.ok(out.xml.includes('<hierarchy'), out.xml);
  assert.ok(out.xml.includes('text="ถอดได้"'), out.xml);
  // ตรวจสอบว่าสาขา iframe ทำงานในบริบท vm จริง ๆ โดยเห็น description ที่มี "อ่านไม่ได้"
  assert.ok(out.xml.includes('iframe'), 'fixture ต้องมี iframe element');
  assert.ok(out.xml.includes('อ่านไม่ได้'), 'iframe description ต้องมี "อ่านไม่ได้" เพื่อให้โมเดลไม่งูเงึก');
});

test('dumpPage: คืนข้อผิดพลาดเมื่อเนื้อหามองไม่เห็นทั้งหน้า', () => {
  // สร้างหน้าที่ไม่มี element มองเห็นได้ => walk(root) คืน [] => collectTree คืน null => dumpPage คืน error
  const invisibleHtml = el('html', {
    rect: { left: 0, top: 0, right: 1280, bottom: 900, width: 1280, height: 900 },
    style: { display: 'none' },
    children: [el('head'), el('body', { text: 'หนีไม่ได้', style: { display: 'none' } })]
  });
  invisibleHtml.scrollWidth = 1280;
  invisibleHtml.scrollHeight = 900;
  const doc = { documentElement: invisibleHtml, title: 'Hidden' };
  const out = dumpPage(doc, fakeWin());
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.error, 'ไม่พบ element ที่มองเห็นได้ในหน้านี้');
});
