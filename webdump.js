'use strict';

// แปลง DOM ของหน้าเว็บที่เปิดอยู่ เป็น UI hierarchy XML "ทรงเดียวกับ Appium/uiautomator dump"
// เหตุผลที่ต้องเป็นทรงนั้นเป๊ะ ๆ ไม่ใช่ทรงที่อ่านง่ายกว่า: uidump.js (วิวเวอร์ TREE ในแท็บ QA)
// อ่าน class/resource-id/text/content-desc/bounds/clickable อยู่แล้ว และมี isWrapper() ที่ตัด
// กล่องเปล่าทิ้งซึ่งผ่านการใช้งานจริงมาแล้ว — ยึดทรงเดิม = ได้วิวเวอร์กับตัวตัด wrapper ฟรี
// และเฟส 2 (adb uiautomator dump) จะไหลเข้าท่อเดียวกันโดยไม่ต้องแยกโค้ด
// ดู docs/superpowers/specs/2026-08-08-web-page-to-xml-design.md
//
// >>> ข้อบังคับของฟังก์ชันในชุด INJECTED (ดู injectableSource) <<<
// ฟังก์ชันพวกนี้ถูกแปลงเป็นสตริงด้วย Function.prototype.toString() แล้วส่งไปรันในหน้าเป้าหมาย
// closure ไม่ติดไปด้วย จึง "ห้ามอ้างถึงตัวแปรหรือ constant นอกตัวเอง" เด็ดขาด
// อ้างฟังก์ชันพี่น้องที่อยู่ในชุดเดียวกันได้ (เพราะถูกส่งไปด้วยกัน) — เทส vm ในชุดเทสจับข้อนี้

// XML 1.0 ไม่ยอมรับ control character เกือบทั้งหมด ข้อความในหน้าเว็บจริงมีปนได้ (เช่น \u0000
// จากการ paste) ถ้าปล่อยไป DOMParser ฝั่งวิวเวอร์จะพังทั้งไฟล์ ไม่ใช่แค่ node เดียว
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function treeToXml(root, meta) {
  function attr(name, value) {
    return value ? ' ' + name + '="' + xmlEscape(value) + '"' : '';
  }
  function render(node, indent) {
    var b = node.bounds || [0, 0, 0, 0];
    var open = indent + '<node'
      + attr('class', node.cls)
      + attr('resource-id', node.rid)
      + attr('text', node.text)
      + attr('content-desc', node.desc)
      + ' bounds="[' + b[0] + ',' + b[1] + '][' + b[2] + ',' + b[3] + ']"'
      + (node.clickable ? ' clickable="true"' : '')
      + (node.scrollable ? ' scrollable="true"' : '');
    var kids = node.children || [];
    if (!kids.length) return open + '/>';
    var inner = [];
    for (var i = 0; i < kids.length; i++) inner.push(render(kids[i], indent + '  '));
    return open + '>\n' + inner.join('\n') + '\n' + indent + '</node>';
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<hierarchy width="' + meta.width + '" height="' + meta.height + '"'
    + attr('url', meta.url) + attr('title', meta.title) + '>\n'
    + render(root, '  ') + '\n</hierarchy>\n';
}

module.exports = { xmlEscape, treeToXml };
