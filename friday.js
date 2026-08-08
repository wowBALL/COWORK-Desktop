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
    // 'inert' เป็นคลาสเสริม ไม่ใช่หนึ่งในหกคลาสสถานะ (blocked/starting เป็น inert
    // เสมอ แต่ failed เป็น inert เฉพาะตอน enabled:false เช่นเปิดไม่สำเร็จระหว่างการ์ดจอ
    // ไม่ว่าง) -- friday.css ผูก cursor/hover ไว้กับคลาสนี้แทนการแจกแจงทีละสถานะ
    const inert = !v.hidden && !v.enabled ? ' inert' : '';
    el.className = v.hidden ? 'fridaypill hidden' : `fridaypill ${v.cls}${inert}`;
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
          // ล้มเหลวเท่านั้นที่ต้องบอก สำเร็จปล่อย pending 'starting' ไว้ต่อ --
          // มันจะหายเองก็ต่อเมื่อ onData เห็น state:'running' จริง (หรือหมดอายุ 15 วิ)
          // ไม่ใช่ตอน HTTP 201 ตอบกลับมา เพราะ poll ตอน idle ห่างถึง 5 วิ (runnerInterval
          // ใน main.js) การเคลียร์ pending ตรงนี้เคยทำให้ป้ายโชว์ "off" หลอกอยู่ได้นานถึง
          // 5 วินาทีหลังกดเปิดสำเร็จจริง แล้วกดซ้ำได้ 409 already_running
          if (!r || !r.ok) pending = { kind: 'failed', at: Date.now(), action: 'start' };
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

  // injectedApi เป็นพารามิเตอร์ที่สอง (ทางเลือก) เพื่อให้เทสยิง onClick/onData
  // ได้จริงโดยไม่ต้องพึ่ง window.cowork -- เส้นทางเบราว์เซอร์เรียก mount(node)
  // ด้วยอาร์กิวเมนต์เดียวเหมือนเดิมเป๊ะ จึงยังอ่านจาก global.cowork ตามปกติ
  // เคลียร์ pending/runner ทุกครั้งที่ mount เพื่อกันเทสไฟล์เดียวกันเห็นสถานะเก่า
  // ข้ามกัน -- ไม่กระทบพฤติกรรมจริงเพราะ mount() ถูกเรียกครั้งเดียวตอนโหลดหน้า
  // ตอนที่ทั้งสองตัวยังเป็น null อยู่แล้ว
  function mount(node, injectedApi) {
    el = node || null;
    api = injectedApi || (global.cowork) || null;
    runner = null;
    pending = null;
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

  // onClick/onData เดิมไม่ถูก export เลย -- ทำให้ Finding 1 (else pending = null
  // ทำลาย starting) ไม่มีเทสไหนจับได้ทั้งที่ viewOf ถูกเทสละเอียดมาก export ทั้งคู่
  // ไว้ที่นี่เพื่อให้เทสยิง state machine ของการคลิกจริงได้ผ่าน mount(node, fakeApi)
  const core = { viewOf, PENDING_MS, mount, onClick, onData };

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.fridayCore = core;
  // ลงทะเบียนใต้ tabs เพื่อรับ onTick จากลูป tick() ของเปลือก ซึ่งวนจาก COWORK.tabs
  // ทั้งก้อน ไม่ใช่จากทะเบียน TABS -- แบบเดียวกับ meetingRunner ที่ก็ไม่ได้อยู่ใน TABS
  global.COWORK.tabs.friday = { mount, onData, onTick };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
