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

function collectTree(document, window) {
  // tag ที่ไม่มีวันเป็นสิ่งที่ผู้ใช้เห็น — ตัดตั้งแต่ต้นทางไม่ให้โค้ด JS/CSS หลุดเข้าไปเป็น text
  // (SKIP เทียบด้วยชื่อ tag ตัวพิมพ์ใหญ่แบบ HTML เท่านั้น — <svg><title>/<style> รายงาน tagName
  // เป็นตัวพิมพ์เล็กเลยไม่โดน SKIP แต่ไม่ใช่ปัญหาเพราะกิ่ง svg ทั้งกิ่งถูกตัดก่อนจะเดินลงไปถึง)
  var SKIP = { SCRIPT: 1, STYLE: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, NOSCRIPT: 1, TEMPLATE: 1, BR: 1 };
  var sx = window.scrollX || 0;
  var sy = window.scrollY || 0;
  var de = document.documentElement;
  // ขอบเขตของทั้งเอกสาร ไม่ใช่แค่ viewport ที่มองเห็นอยู่ตอนนี้ — element ที่แค่ยังไม่ scroll ไปเจอ
  // ต้องนับว่ามองเห็นได้ (เลื่อนไปเจอได้จริง) ต่างจาก element ที่ถูกซ่อนด้วยการเลื่อนพ้นเอกสารถาวร
  // (เช่น left:-9999px) ซึ่งไม่มีวันถูกมองเห็นไม่ว่าจะเลื่อนยังไง
  var docW = Math.max(de.scrollWidth || 0, window.innerWidth || 0);
  var docH = Math.max(de.scrollHeight || 0, window.innerHeight || 0);

  function visible(st, box, el) {
    if (!box || box[2] - box[0] <= 0 || box[3] - box[1] <= 0) return false;
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    // aria-hidden="true" คือหน้าเว็บบอกตรง ๆ ว่า element นี้ไม่ควรถูกมองเห็น (เช่น ไอคอน
    // ตกแต่งที่ซ้ำกับ label ข้าง ๆ) ไม่เช็คไว้จะหลุดเข้าไปเป็น "สิ่งที่อยู่บนจอ" ทั้งที่ผู้ใช้ไม่เห็น
    if (String(el.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return false;
    // นอกขอบเอกสารทั้งกล่อง = ซ่อนด้วยตำแหน่งถาวร ไม่ใช่แค่ยังไม่เลื่อนไปเจอ
    if (box[2] <= 0 || box[3] <= 0 || box[0] >= docW || box[1] >= docH) return false;
    return true;
  }
  // เฉพาะ text node ที่เป็นลูกตรงเท่านั้น — ถ้าใช้ textContent ข้อความของลูกจะถูกลากขึ้นไปซ้ำ
  // ทุกชั้นจนไฟล์บวมหลายเท่า และโมเดลเห็นข้อความเดียวกันสิบรอบจนสับสนว่ามีของซ้ำจริงบนจอ
  function ownText(el) {
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return String(el.value == null ? '' : el.value).trim();
    }
    var out = '';
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 3) out += kids[i].nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
  }
  function descOf(el) {
    return String(el.getAttribute('aria-label') || el.getAttribute('title')
      || el.getAttribute('alt') || el.getAttribute('placeholder') || '').trim();
  }
  function ridOf(el) {
    return String(el.getAttribute('id') || el.getAttribute('name')
      || el.getAttribute('data-testid') || '').trim();
  }
  function clsOf(el) {
    var role = String(el.getAttribute('role') || '').trim().toLowerCase();
    return el.tagName.toLowerCase() + (role ? '[' + role + ']' : '');
  }
  // ไม่เดาจากชื่อคลาส CSS เพราะแต่ละเว็บตั้งชื่อคนละแบบ ใช้เฉพาะสัญญาณที่เบราว์เซอร์รับรอง
  function clickableOf(el, st) {
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'INPUT') return true;
    if (tag === 'A' && el.getAttribute('href')) return true;
    var role = String(el.getAttribute('role') || '').toLowerCase();
    if (role === 'button' || role === 'link' || role === 'tab' || role === 'checkbox' || role === 'menuitem') return true;
    if (el.getAttribute('onclick')) return true;
    return st.cursor === 'pointer';
  }
  function scrollableOf(el, st) {
    return el.scrollHeight > el.clientHeight + 1 && st.overflowY !== 'visible';
  }
  function boxOf(r) {
    return [Math.round(r.left + sx), Math.round(r.top + sy),
      Math.round(r.right + sx), Math.round(r.bottom + sy)];
  }
  // คืน array เสมอ (ไม่ใช่ node เดียว) เพราะ node ที่มองไม่เห็นต้องคืน "ลูกของมัน" ขึ้นไปแทนตัวเอง
  // ตัดทั้งกิ่งจะทำให้เนื้อหาที่อยู่ในกล่องขนาดศูนย์ (pattern ปกติของ dropdown/accordion) หายหมด
  // parentOpacity คือค่า opacity สะสมจากพ่อลงมา (undefined ตอนเรียกครั้งแรกจาก documentElement)
  function walk(el, parentOpacity) {
    if (!el || !el.tagName || SKIP[el.tagName]) return [];
    var st = window.getComputedStyle(el);
    var ownOpacity = parseFloat(st.opacity);
    if (isNaN(ownOpacity)) ownOpacity = 1;
    // opacity ไม่ได้ inherit ตามสเปก CSS (ลูกอ่าน computed style ของตัวเองได้ opacity:1 เสมอถ้าไม่
    // ได้ตั้งเอง) แต่ตอนเรนเดอร์จริงพ่อทึบ 0 ทำให้ทั้งกิ่งมองไม่เห็นเสมอไม่ว่าลูกจะตั้งอะไรไว้
    // ต้องคูณสะสมจากพ่อ ไม่ใช่อ่านแค่ค่าของ element เดียวแบบเดิม — และต่างจากเหตุผลอื่นที่ทำให้
    // มองไม่เห็น (display:none ของตัวเอง, กล่องขนาดศูนย์) ตรงที่ opacity:0 จากพ่อทำให้ "ลูกก็มองไม่
    // เห็นจริง ๆ ด้วย" จึงต้องตัดทั้งกิ่งทิ้งตรงนี้ ไม่ใช่ยกลูกขึ้นไปแทนเหมือน case อื่น
    var effOpacity = (parentOpacity == null ? 1 : parentOpacity) * ownOpacity;
    if (effOpacity === 0) return [];

    // <svg>...</svg> เก็บแค่ตัว element เอง ไม่เดินลงไปใน <path>/<g>/<circle> ข้างในเลย เพราะ
    // เส้นทางพวกนั้นไม่มีข้อความหรือความหมายให้โมเดลอ่าน มีแต่ทำให้ node บวมจากไอคอนเพียว ๆ
    // เทียบ tagName ตัวพิมพ์เล็กเพราะ element ในเนมสเปซ SVG รายงาน tagName ตามที่เขียนในซอร์ส
    // (ไม่ถูก uppercase เหมือน HTML) — SKIP เช็คด้วยตัวพิมพ์ใหญ่แบบ HTML เลยจับสิ่งนี้ไม่ได้
    var isSvg = String(el.tagName).toLowerCase() === 'svg';
    var kids = [];
    if (!isSvg) {
      var ch = el.children || [];
      for (var i = 0; i < ch.length; i++) kids = kids.concat(walk(ch[i], effOpacity));
    }

    var r = el.getBoundingClientRect();
    var box = boxOf(r);
    if (!visible(st, box, el)) return kids;

    if (isSvg) {
      return [{
        cls: clsOf(el), rid: ridOf(el), text: '', desc: descOf(el),
        bounds: box, clickable: false, scrollable: false, children: [],
      }];
    }

    if (el.tagName === 'IFRAME') {
      // same-origin อ่าน contentDocument ได้ตรง ๆ — ลองอ่านจริงก่อนเสมอ แทนที่จะสรุปว่าอ่านไม่ได้
      // เพราะแอปเป้าหมายของฟีเจอร์นี้ (editor/report ฝังในเชลล์) ส่วนใหญ่เป็น same-origin
      // cross-origin จะโยน SecurityError ตอนอ่าน contentDocument ซึ่งเป็นทางเดียวที่แยกสองกรณีนี้ได้
      var frameKids = null;
      try {
        var innerDoc = el.contentDocument;
        if (innerDoc && innerDoc.documentElement) frameKids = walk(innerDoc.documentElement, 1);
      } catch (e) {
        frameKids = null;
      }
      if (frameKids) {
        return [{
          cls: 'iframe', rid: ridOf(el), text: '', desc: descOf(el),
          bounds: box, clickable: false, scrollable: false, children: frameKids,
        }];
      }
      return [{
        cls: 'iframe', rid: ridOf(el), text: '',
        desc: descOf(el) || 'iframe — เนื้อหาข้าม origin อ่านไม่ได้',
        bounds: box, clickable: false, scrollable: false, children: [],
      }];
    }
    return [{
      cls: clsOf(el), rid: ridOf(el), text: ownText(el), desc: descOf(el),
      bounds: box, clickable: clickableOf(el, st), scrollable: scrollableOf(el, st),
      children: kids,
    }];
  }
  return walk(document.documentElement)[0] || null;
}

function countNodes(root) {
  if (!root) return 0;
  var total = 1;
  var kids = root.children || [];
  for (var i = 0; i < kids.length; i++) total += countNodes(kids[i]);
  return total;
}

function dumpPage(document, window) {
  var root = collectTree(document, window);
  if (!root) return { ok: false, error: 'ไม่พบ element ที่มองเห็นได้ในหน้านี้' };
  var de = document.documentElement;
  var meta = {
    width: Math.round(Math.max(de.scrollWidth || 0, window.innerWidth || 0)),
    height: Math.round(Math.max(de.scrollHeight || 0, window.innerHeight || 0)),
    url: String((window.location && window.location.href) || ''),
    title: String(document.title || ''),
  };
  return {
    ok: true, xml: treeToXml(root, meta), title: meta.title, url: meta.url,
    nodes: countNodes(root), width: meta.width, height: meta.height,
  };
}

// ชุดโค้ดที่ส่งไปรันในหน้าเป้าหมายผ่าน webContents.executeJavaScript()
// ต้องรวมทุกฟังก์ชันที่ dumpPage เรียกถึง มิฉะนั้นจะพังเฉพาะตอนรันจริง (ดูเทส vm ในชุดเทส)
function injectableSource() {
  return [xmlEscape, treeToXml, collectTree, countNodes, dumpPage]
    .map(function (f) { return f.toString(); })
    .join('\n\n');
}

module.exports = { xmlEscape, treeToXml, collectTree, countNodes, dumpPage, injectableSource };
