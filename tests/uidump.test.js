const test = require('node:test');
const assert = require('node:assert');

// uidump.js เป็นโค้ดฝั่ง renderer ล้วน อ้าง `window` ตรง ๆ ใน `(function (global) {...})(window)`
// (ไม่มี typeof window!=='undefined' guard แบบไฟล์อื่นในโปรเจกต์ เช่น datefilter.js) และเรียก
// `new DOMParser()` ข้างในด้วย — ทั้งสองอย่างไม่มีใน node เปล่า ๆ ต้องสตับ global ก่อน require
// เหมือนที่ datefilter.test.js สตับ util ก่อน require มาแล้ว
//
// DOMParser ปลอมนี้ไม่ได้ parse XML จริง — คืน documentElement ที่เทสตั้งไว้ล่วงหน้าตรง ๆ ผ่าน
// currentRoot เพราะสิ่งที่สองเทสนี้ต้องการพิสูจน์คือพฤติกรรมของ uidumpHtml หลัง buildTree
// (การ escape และการแทรกด้วย replace) ไม่ใช่ความถูกต้องของการ parse XML เอง
function FakeEl(tagName, attrs, children) {
  this.tagName = tagName;
  this.attributes = Object.keys(attrs || {}).map((k) => ({ name: k, value: attrs[k] }));
  this.children = children || [];
}

let currentRoot = null;
global.window = global.window || globalThis;
global.DOMParser = function DOMParser() {};
global.DOMParser.prototype.parseFromString = function () {
  return { documentElement: currentRoot, querySelector: () => null };
};
require('../uidump.js');
const { uidumpHtml } = global;

test('uidumpHtml: title ที่มี </script> ต้องหนีออก ไม่หลุดออกจาก <script> block ของวิวเวอร์', () => {
  currentRoot = new FakeEl('hierarchy', { width: '100', height: '200' }, [
    new FakeEl('node', { class: 'div', bounds: '[0,0][10,10]' }, []),
  ]);
  // ก่อนเฟส web-page-to-xml opts.label มาจากค่าคงที่ในโค้ดเราเองเสมอ — พังไม่ได้เว้นแต่ผ่าน
  // qiOpenXmlViewer ที่ตอนนี้ส่ง <title> ของหน้าเว็บที่ผู้ใช้ถอดมาตรง ๆ เป็น label
  const malicious = '</script><script>window.pwned=1</script>';
  const html = uidumpHtml('<hierarchy/>', { label: malicious });
  // ถ้าหลุดจริง ลำดับไบต์ดิบนี้จะโผล่ในเอาต์พุต แล้ว window.pwned=1 จะถูกรันจริงตอนโหลด iframe
  assert.ok(!html.includes('</script><script>window.pwned'),
    'พบลำดับไบต์ที่หลุดออกจาก <script> block ได้จริง: ' + html.slice(0, 4000));
  // ต้องยังเห็นเนื้อหา label แบบหนีแล้วฝังอยู่จริง ไม่ใช่ถูกกรองทิ้งเงียบ ๆ
  assert.ok(html.includes('window.pwned=1'), 'label ต้องยังอยู่ในผลลัพธ์ แค่หนีให้ปลอดภัย');
  assert.ok(html.includes('<\\/script>'), 'ต้องเห็น </ ที่ถูกหนีเป็น <\\/ ในซอร์สจริง');
});

test('uidumpHtml: "$\'" / "$&" ในเนื้อหาที่ถอดมาต้องรอดเข้าไปในผลลัพธ์เหมือนเดิม ไม่ถูกตีความเป็น replacement pattern', () => {
  // ข้อความมี $&, $`, $', $1 ครบ — ถ้า .replace('__DATA__', payload) ยังใช้ string replacer เดิม
  // ค่าพวกนี้จะถูก String.replace ตีความเป็นแพตเทิร์นพิเศษแทนที่จะแทรกลงไปตรง ๆ
  const tricky = 'echo $\' hi $& there $` end $1 done';
  currentRoot = new FakeEl('hierarchy', { width: '100', height: '200' }, [
    new FakeEl('node', { class: 'div', text: tricky, bounds: '[0,0][10,10]' }, []),
  ]);
  const html = uidumpHtml('<hierarchy/>', { label: 'failure.xml' });
  assert.ok(html.includes(JSON.stringify(tricky).replace(/<\//g, '<\\/')),
    'payload ต้องมี $\' $& $` $1 ดิบ ๆ อยู่ครบ ไม่ถูกกลืนหรือตัดหายจาก String.replace');
});
