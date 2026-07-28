// แถบควบคุมการอัดประชุมของแท็บ Meeting -- ฝั่ง renderer ล้วน ไม่ใช้ Node API
//
// ไฟล์นี้เป็นตัวอย่างของสัญญาโมดูลที่ v1.8.3 จะใช้รื้อ widget.html ทั้งไฟล์:
// เปลือกรู้จักแค่ mount/onData/onShow/onHide ไม่รู้ว่าข้างในทำอะไร
//
// ห่อด้วย IIFE ไม่ใช่ ES module เพราะ widget.html ถูกโหลดผ่าน file:// ซึ่ง
// Chromium บล็อก <script type="module"> ด้วย CORS
(function (global) {
  'use strict';

  // ต้องตรงกับ UI.th.steps ใน D:\COWORK\meeting-notes\web\app.js เป๊ะตัวอักษร --
  // สองที่ที่พูดคนละคำแปลว่าผู้ใช้เห็นสถานะไม่ตรงกันแล้วแต่เปิดจากหน้าไหน
  const STEPS = ['บีบอัดไฟล์เสียง', 'ถอดเสียง', 'แยกผู้พูด', 'สรุป', 'เสร็จ'];
  const SUMMARIZE_STEP = 3;
  const NO_SUMMARY_MODEL = 'transcript-only';

  // ขั้นที่เหตุการณ์นี้พาไปถึง
  const STAGE_OF = {
    encode_started: 0,
    queued: 1,
    transcribe_started: 1,
    diarize_started: 2,
    summarize_started: 3,
    meeting_done: 4,
  };

  function jobStemOf(p) {
    if (!p) return null;
    const base = String(p).split(/[\\/]/).pop();
    return base.replace(/\.[^.]+$/, '') || null;
  }

  function fmtClock(sec) {
    const n = Number(sec);
    const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    const h = String(Math.floor(v / 3600)).padStart(2, '0');
    const m = String(Math.floor(v / 60) % 60).padStart(2, '0');
    const s = String(v % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // ขั้นที่ถึง = ขั้นของเหตุการณ์ "ล่าสุด" ที่รู้จัก ไม่ใช่การนับสะสม --
  // นับสะสมจะให้ตัวเลขผิดทันทีที่ปิดวิดเจ็ตแล้วเปิดใหม่กลางคัน เพราะ
  // activity[] ที่ได้มาเป็นแค่ส่วนท้ายของไฟล์ ไม่ใช่ทั้งหมด
  function progressOf(activity, jobStem) {
    if (!jobStem) return null;
    const events = (activity || []).filter((e) => e && e.job === jobStem);
    if (!events.length) return { stage: 0, failed: false };
    let stage = 0;
    let failed = false;
    for (const e of events) {
      if (e.code === 'job_failed') failed = true;
      if (Object.prototype.hasOwnProperty.call(STAGE_OF, e.code)) stage = STAGE_OF[e.code];
    }
    return { stage, failed };
  }

  // last_result ชี้ไฟล์ .ogg ใน inbox/ ส่วนโฟลเดอร์ผลลัพธ์ถูกเติม -2/-3 ได้ถ้าชื่อชนกัน
  // (ชื่อโฟลเดอร์ไม่มีวินาที) จึงเทียบแบบ prefix + ตัวเลข แล้วเอาเลขสูงสุด
  // เทียบ prefix เปล่า ๆ ไม่ได้ เพราะประชุมคนละตัวที่ชื่อขึ้นต้นเหมือนกันจะติดมาด้วย
  function matchMeetingId(jobStem, meetings) {
    if (!jobStem) return null;
    const hits = (meetings || []).filter((m) => {
      if (!m || typeof m.id !== 'string' || !m.id.startsWith(jobStem)) return false;
      const rest = m.id.slice(jobStem.length);
      return rest === '' || /^-\d+$/.test(rest);
    });
    if (!hits.length) return null;
    return hits.reduce((best, m) => (m.id.length > best.id.length
      || (m.id.length === best.id.length && m.id > best.id) ? m : best)).id;
  }

  const core = {
    STEPS,
    SUMMARIZE_STEP,
    NO_SUMMARY_MODEL,
    STAGE_OF,
    jobStemOf,
    fmtClock,
    progressOf,
    matchMeetingId,
  };

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.meetingRunCore = core;

  // เปิดทาง node --test ให้เทส logic ได้โดยไม่ต้องมี DOM
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
