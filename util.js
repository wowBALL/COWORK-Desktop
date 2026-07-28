// ตัวช่วยที่ทุกแท็บใช้ร่วมกัน -- ฝั่ง renderer ล้วน ไม่ใช้ Node API
//
// ต้องโหลดเป็นไฟล์แรกสุด ก่อน uidump.js / meetingrun.js / tab-*.js ทั้งหมด
//
// ห่อด้วย IIFE ไม่ใช่ ES module เพราะ widget.html ถูกโหลดผ่าน file:// ซึ่ง
// Chromium บล็อก <script type="module"> ด้วย CORS
//
// เหตุผลที่ต้องมีไฟล์นี้: ตอน v1.8.2 esc() งอกขึ้นมาสามตัวคนละแบบ (widget.html, uidump.js,
// meetingrun.js) และไม่มีตัวไหน escape " ทั้งที่ถูกใช้ใน attribute สิบสี่จุด -- ปล่อยให้แต่ละไฟล์
// พก helper ส่วนตัวแล้วมันงอกจริง
//
// ตอนนี้ฝั่งแอปเหลือตัวนี้ตัวเดียวแล้ว แต่ยังมี esc อีกตัวใน uidump.js ที่ "ห้ามยุบเข้ามา":
// มันอยู่ในเทมเพลตของ tpl() คือโค้ดที่ถูกฝังไปรันในวิวเวอร์ failure.xml ซึ่งเป็น iframe
// sandbox="allow-scripts" (ไม่มี allow-same-origin) -- คนละ document แตะ window.COWORK
// ของแอปไม่ได้เลย เป็นคนละโปรแกรมกัน ไม่ใช่ก๊อปซ้ำ
(function (global) {
  'use strict';

  const D = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  // textContent→innerHTML แปลง & < > ให้ แต่ไม่แตะ " -- และ esc() ถูกใช้ใน attribute หลายที่
  // (title=, data-g=, value=) พิมพ์ " ในช่องค้นหาบทถอดเสียงแล้ว value ขาดกลางคัน
  // แถมงอก attribute ขยะขึ้นมาจริง ๆ จึงต้อง escape " ต่อท้ายอีกชั้น
  // ไม่ต้องแตะ ' เพราะทุก attribute ในแอปนี้ครอบด้วย " ทั้งหมด
  //
  // ห้ามเขียนใหม่เป็น regex ทั้งก้อน: ทางนี้แปลง U+00A0 เป็น &nbsp; ด้วย regex ไม่แปลง
  // ผลลัพธ์จะต่างโดยที่ไม่มีอะไรฟ้อง
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function hashN(key, n) {
    let h = 0;
    for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % n;
  }

  function timeAgo(iso) {
    if (!iso) return 'ไม่ระบุ';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'เมื่อสักครู่';
    if (min < 60) return `${min} นาทีที่แล้ว`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} ชม.ที่แล้ว`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} วันที่แล้ว`;
    const mon = Math.floor(day / 30);
    if (mon < 12) return `${mon} เดือนที่แล้ว`;
    return `${Math.floor(mon / 12)} ปีที่แล้ว`;
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.util = { D, M, esc, hashN, timeAgo };

  // ให้ node --test เรียกใช้ได้โดยไม่ต้องมี DOM (esc ต้องมี document จึงเทสแยกไม่ได้ ตัวอื่นเทสได้)
  if (typeof module !== 'undefined' && module.exports) module.exports = { D, M, hashN, timeAgo };
})(typeof window !== 'undefined' ? window : globalThis);
