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

  // รอบรีเฟรชอัตโนมัติ (นาที) — 0 = ปิด · ตัวเลือกสำเร็จรูป ไม่ใช่ช่องพิมพ์ตัวเลข เพราะพิมพ์
  // 0.1 ได้แปลว่ายิง Redmine API ทุก 6 วินาทีทั้งวัน ซึ่งไม่มีใครตั้งใจและมองไม่เห็นจากในแอป
  //
  // ไฟล์นี้เป็นฝั่ง renderer ก็จริง แต่สองค่านี้ main.js ก็ require ไปใช้ (ตอนโหลด/บันทึก config)
  // เพราะลิสต์ตัวเลือกกับด่านกันค่าเพี้ยนต้องเป็นตัวเดียวกันทั้งสองฝั่ง แยกเมื่อไหร่ก็มีวันที่
  // เมนูให้เลือกค่าที่ main ปฏิเสธ — ตัวอื่นใน util.js แตะ document, สองตัวนี้ไม่แตะ จึง require ได้
  const REFRESH_CHOICES = [0, 1, 2, 5, 10, 15, 30];
  const DEFAULT_REFRESH_MINUTES = 5;
  // config.json ผู้ใช้เปิดแก้เองได้ และ <select>.value เป็นสตริงเสมอ — ทั้งสองทางเป็น input
  // ภายนอกที่ไว้ใจไม่ได้ ค่าที่ไม่ตรงตัวเลือกไหนเลยตกกลับค่าเริ่มต้น ไม่ใช่ปิดการรีเฟรชทิ้ง
  //
  // ต้องกรองชนิดก่อนเรียก Number() ไม่ใช่พึ่ง Number() อย่างเดียว: Number(null), Number(''),
  // Number([]) ได้ 0 ทั้งหมด ซึ่งบังเอิญเป็นตัวเลือกที่ถูกต้อง (= ปิด) — คีย์ที่หายไปจาก config
  // จึงจะกลายเป็น "ผู้ใช้สั่งปิดรีเฟรช" เงียบ ๆ แทนที่จะเป็นค่าเริ่มต้น 5 นาที
  function normalizeRefreshMinutes(v) {
    if (typeof v === 'string' && v.trim() === '') return DEFAULT_REFRESH_MINUTES;
    if (typeof v !== 'number' && typeof v !== 'string') return DEFAULT_REFRESH_MINUTES;
    const n = Number(v);
    return REFRESH_CHOICES.includes(n) ? n : DEFAULT_REFRESH_MINUTES;
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.util = { D, M, esc, hashN, timeAgo, REFRESH_CHOICES, normalizeRefreshMinutes };

  // ให้ node --test เรียกใช้ได้โดยไม่ต้องมี DOM (esc ต้องมี document จึงเทสแยกไม่ได้ ตัวอื่นเทสได้)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { D, M, hashN, timeAgo, REFRESH_CHOICES, DEFAULT_REFRESH_MINUTES, normalizeRefreshMinutes };
  }
})(typeof window !== 'undefined' ? window : globalThis);
