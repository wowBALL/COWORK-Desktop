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
