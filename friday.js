// ป้ายสถานะและปุ่มเปิด/ปิด Friday บนหัวแอป -- ของเปลือก ไม่ใช่ของแท็บใดแท็บหนึ่ง
// เพราะต้องเห็นได้จากทุกแท็บ (เหตุผลเดียวกับ #mrunLive และตัวเลือกโมเดล LLM)
//
// ห่อด้วย IIFE ไม่ใช่ ES module เพราะ widget.html ถูกโหลดผ่าน file:// ซึ่ง Chromium
// บล็อก <script type="module"> ด้วย CORS
(function (global) {
  'use strict';

  // อายุของสถานะชั่วคราวฝั่งหน้าจอ -- ฝั่งเซิร์ฟเวอร์มีแค่ off/running เพราะ Popen
  // คืนค่าทันที "กำลังเปิด" จึงเป็นช่องว่างระหว่างกดกับ poll รอบถัดไปเท่านั้น
  const PENDING_MS = { starting: 15000, confirm: 3000, failed: 8000 };

  const HIDDEN = { hidden: true, cls: '', label: '', action: 'none', enabled: false };

  function alive(pending, kind, now) {
    return !!pending && pending.kind === kind && now - pending.at < PENDING_MS[kind];
  }

  // ตรรกะล้วน ไม่แตะ DOM ไม่เรียก Date.now() เอง -- นาฬิกาถูกฉีดเข้ามาเพื่อให้เทส
  // เรื่องหมดอายุทำได้โดยไม่ต้องรอจริง
  function viewOf(runner, pending, now) {
    if (!runner || !runner.ready || !runner.state) return HIDDEN;
    const c = runner.state.companion;
    // เครื่องที่ไม่ได้ตั้งค่าต้องไม่เห็นอะไรใหม่เลย ไม่ใช่เห็นปุ่มที่กดแล้วไม่เกิดอะไร
    if (!c || c.blocked_by === 'not_configured') return HIDDEN;

    const running = c.state === 'running';

    if (alive(pending, 'failed', now)) {
      // เปิดไม่สำเร็จ -> โปรเซสน่าจะยังไม่รัน (running ต้องเป็น false ถึงเตือน)
      // ปิดไม่สำเร็จ -> โปรเซสน่าจะยังรันอยู่ (running ต้องเป็น true ถึงเตือน)
      // ถ้าสถานะจริงสวนทางกับที่คาดหลังความล้มเหลวนั้น แปลว่าความจริงตามทันแล้ว
      // (เช่น บอกว่าปิดไม่สำเร็จ แต่จริง ๆ มันหยุดไปแล้ว) ไม่ต้องเตือนซ้ำ
      const stopFailed = pending.action === 'stop';
      if (running === stopFailed) {
        if (stopFailed) {
          // หลังปิดไม่สำเร็จ โปรเซสยังรันอยู่ เสนอ "ปิด" ซ้ำ ไม่ใช่ "เปิด" ซึ่งผิดทิศทาง
          return { hidden: false, cls: 'failed', label: 'Friday · ปิดไม่สำเร็จ',
                   action: 'stop', enabled: true };
        }
        return { hidden: false, cls: 'failed', label: 'Friday · เปิดไม่สำเร็จ',
                 action: c.can_start ? 'start' : 'none', enabled: !!c.can_start };
      }
    }
    // ต้องเช็ค running ก่อน: ถ้าเซิร์ฟเวอร์ยืนยันแล้วว่ารันอยู่ ป้าย "กำลังเปิด" ต้องหายทันที
    // ไม่ใช่รอจนหมดอายุ
    if (!running && alive(pending, 'starting', now)) {
      return { hidden: false, cls: 'starting', label: 'Friday · กำลังเปิด',
               action: 'none', enabled: false };
    }
    if (running) {
      if (alive(pending, 'confirm', now)) {
        return { hidden: false, cls: 'confirm', label: 'กดอีกครั้งเพื่อปิด',
                 action: 'stop', enabled: true };
      }
      return { hidden: false, cls: 'on', label: 'Friday · ฟังอยู่',
               action: 'confirm', enabled: true };
    }
    if (c.can_start) {
      return { hidden: false, cls: 'off', label: 'Friday · เปิด',
               action: 'start', enabled: true };
    }
    return { hidden: false, cls: 'blocked', label: 'Friday · ถอดเสียงอยู่',
             action: 'none', enabled: false };
  }

  // ---- ตัวที่แตะ DOM ---------------------------------------------------------
  let el = null, runner = null, pending = null, api = null;

  function draw() {
    if (!el) return;
    const v = viewOf(runner, pending, Date.now());
    el.className = v.hidden ? 'fridaypill hidden' : `fridaypill ${v.cls}`;
    el.innerHTML = v.hidden ? '' : `<span class="d"></span>${v.label}`;
    el.title = v.enabled ? '' : 'กดไม่ได้ตอนนี้';
  }

  function onClick() {
    const v = viewOf(runner, pending, Date.now());
    if (v.action === 'start') {
      pending = { kind: 'starting', at: Date.now() };
      draw();
      if (api && api.startFriday) {
        api.startFriday().then((r) => {
          // ล้มเหลวเท่านั้นที่ต้องบอก สำเร็จให้ poll รอบถัดไปเป็นคนยืนยัน
          if (!r || !r.ok) pending = { kind: 'failed', at: Date.now(), action: 'start' };
          else pending = null;
          draw();
        });
      }
    } else if (v.action === 'confirm') {
      pending = { kind: 'confirm', at: Date.now() };
      draw();
    } else if (v.action === 'stop') {
      pending = null;
      draw();
      if (api && api.stopFriday) {
        api.stopFriday().then((r) => {
          // สมมาตรกับฝั่งเปิด: ปิดไม่สำเร็จต้องบอกผู้ใช้ ไม่งั้นกดแล้วเงียบ
          // แยกไม่ออกว่าคลิกไม่ติดหรือปิดไม่ได้จริง ๆ
          if (!r || !r.ok) pending = { kind: 'failed', at: Date.now(), action: 'stop' };
          draw();
        });
      }
    }
  }

  function mount(node) {
    el = node || null;
    api = (global.cowork) || null;
    if (el) el.onclick = onClick;
    draw();
  }

  function onData(payload) {
    runner = payload || null;
    // สถานะชั่วคราวที่เซิร์ฟเวอร์ยืนยันแล้วต้องทิ้ง ไม่งั้นมันจะไปทับความจริง
    if (pending && pending.kind === 'starting'
        && runner && runner.state && runner.state.companion
        && runner.state.companion.state === 'running') pending = null;
    draw();
  }

  // เกาะนาฬิกาของเปลือก ไม่ตั้ง setInterval เอง -- timer ที่ไม่มีใครหยุดทำให้
  // node --test ค้างรอ event loop
  function onTick() { if (pending) draw(); }

  const core = { viewOf, PENDING_MS, mount };

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.fridayCore = core;
  // ลงทะเบียนใต้ tabs เพื่อรับ onTick จากลูป tick() ของเปลือก ซึ่งวนจาก COWORK.tabs
  // ทั้งก้อน ไม่ใช่จากทะเบียน TABS -- แบบเดียวกับ meetingRunner ที่ก็ไม่ได้อยู่ใน TABS
  global.COWORK.tabs.friday = { mount, onData, onTick };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
