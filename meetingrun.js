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

  // โฟลเดอร์ผลลัพธ์มาจาก params.path ของ meeting_done ไม่ใช่การเดาจากชื่อไฟล์
  //
  // เคยเขียนเป็นการเทียบชื่อ แล้วพังทุกเคส เพราะชื่อไฟล์ใน inbox/ กับชื่อโฟลเดอร์
  // คนละรูปแบบกันคนละทาง (วัดจาก state/activity.jsonl ของจริง 2026-07-28):
  //   ตั้งชื่อห้อง   ไฟล์ "ทดสอบประชุม 1-13-49-53"  →  โฟลเดอร์ "2026-07-28_13-49-ทดสอบประชุม 1"
  //   ไม่ตั้งชื่อ     ไฟล์ "2026-07-28_13-48-56"      →  โฟลเดอร์ "2026-07-28_13-48"
  // ชื่อห้องย้ายข้างและวินาทีหายไป ไม่มีเคสไหนขึ้นต้นเหมือนกัน
  //
  // watcher เป็นคนตั้งชื่อโฟลเดอร์และเป็นคนบอกมาเองว่าตั้งว่าอะไร -- ใช้คำตอบของมัน
  // แทนที่จะสร้างกฎการตั้งชื่อชุดที่สองขึ้นมาแข่ง แล้วรอวันที่มันไม่ตรงกัน
  function finishedMeetingId(activity, jobStem) {
    if (!jobStem) return null;
    const done = (activity || []).filter(
      (e) => e && e.job === jobStem && e.code === 'meeting_done' && e.params && e.params.path
    );
    if (!done.length) return null;
    const last = done[done.length - 1];
    const name = String(last.params.path).split(/[\\/]/).filter(Boolean).pop();
    return name || null;
  }

  // ---- ตัวโมดูล (ต้องมี DOM) ------------------------------------------------
  const MODELS = [
    ['Qwen/Qwen3.6-35B-A3B', 'Qwen 3.6', 'ข้อมูลไม่ออกนอกบริษัท · เร็วที่สุด'],
    ['GLM-5.2', 'GLM 5.2', 'ข้อมูลไม่ออกนอกบริษัท · ช้ากว่า'],
    ['claude-opus-5', 'Opus 5', 'แม่นสุด · $5/$25 ต่อ MTok'],
    ['claude-sonnet-5', 'Sonnet 5', 'ประหยัด · $3/$15 ต่อ MTok'],
    [NO_SUMMARY_MODEL, 'ถอดเสียงอย่างเดียว', 'ไม่สรุป · ไม่เสียเงิน'],
  ];

  // ประเภทประชุม -- กฎเดียวกับ STEPS: ต้องตรงกับ UI.th.profiles ใน
  // D:\COWORK\meeting-notes\web\app.js เป๊ะตัวอักษร และ id ต้องตรงกับชื่อไฟล์ใน
  // prompts/profiles/ กับ prompts.KNOWN_PROFILES ของฝั่งนั้น
  // (ที่นี่ไม่ validate id เหมือนกับที่ฝั่ง service ไม่ validate -- ค่าที่ไม่รู้จักฝั่งสรุป
  // จะเตือนแล้วใช้ dev ต่อ การปฏิเสธตรงนี้จะทำให้กดเปิดห้องไม่ได้เพราะค่าที่แก้ทีหลังได้)
  const PROFILES = [
    ['dev', 'dev ล้วน', 'ศัพท์เทคนิคตรงๆ'],
    ['cross', 'Business + dev', 'แยก "ทำได้" ออกจาก "จะทำ" · ขยายศัพท์ให้คนนอกทีม'],
  ];
  // dev เป็นค่าเริ่มต้นด้วยเหตุผลเดียวกับที่ web/app.js บันทึกไว้: เป็น 3 ใน 4 ครั้งของ
  // สัปดาห์ และการเผลอเลือก cross ในประชุม dev ล้วนทำให้โมเดล qualify คำพูดปกติ
  // เกินจำเป็นจนสรุปอ่านแล้วอ้อมค้อม
  const DEFAULT_PROFILE = 'dev';

  // ตัวถอดเสียง -- กฎเดียวกับ PROFILES: ต้องตรงกับ UI.th.engines ใน
  // D:\COWORK\meeting-notes\web\app.js เป๊ะตัวอักษร และ id ต้องตรงกับ config.KNOWN_ASR_ENGINES
  const ENGINES = [
    ['whisper', 'large-v3 (ค่าเริ่มต้น)', 'แม่นสุด · มี hotwords ช่วยจับศัพท์เฉพาะทาง'],
    ['typhoon', 'Typhoon (ทดลอง)', 'เร็วกว่า 3-10 เท่า บน CPU · ไม่มี hotwords พลาดศัพท์เฉพาะทางง่ายกว่า'],
  ];
  // ต้องตรงกับ config.DEFAULT_ASR_ENGINE -- widget กับหน้าเว็บต้องเริ่มที่ตัวถอดเสียงเดียวกัน
  // ไม่งั้นคนที่กด "เปิดห้อง" ทันทีจะได้คนละตัวถอดเสียงกับที่ตั้งใจ
  const DEFAULT_ENGINE = 'whisper';

  let root = null;
  let api = null;           // window.cowork
  let state = null;         // state ล่าสุดจาก service (null = ไม่ตอบ)
  let model = 'Qwen/Qwen3.6-35B-A3B';
  let profile = DEFAULT_PROFILE;
  let engine = DEFAULT_ENGINE;
  let roomDraft = '';
  let modelsOpen = false;
  let stopping = false;     // กันกดปิดซ้ำระหว่างรอ service ตอบ
  let signature = null;     // วาดใหม่เฉพาะตอนสถานะเปลี่ยนจริง
  // เครื่องนี้เคยอ่าน /api/state ได้จริงไหม (รอบนี้ หรือรอบก่อนที่จดไว้ใน config) --
  // ประตูชั้นแรกของแถบทั้งอัน ไม่ผ่านคือไม่วาดอะไรเลย เครื่องที่ไม่เคยมีตัวอัดต้องเห็น
  // แท็บ Meeting เหมือน v1.8.1 เป๊ะ ต่อให้มีแอปอื่นถือพอร์ต 8765 อยู่ก็ตาม
  let seenService = false;
  let ready = false;        // service ตอบอยู่ไหม -- แยกจาก state ซึ่งมาจาก /api/state ที่ช้าได้

  // esc ตัวเดียวของแอปอยู่ที่ util.js -- ตรงนี้เคยมีก๊อปส่วนตัวที่ไม่ escape " ซึ่งเป็นบั๊กจริง:
  // พิมพ์ " ในชื่อห้องแล้ว value="${esc(roomDraft)}" ขาดกลางคัน เหลือข้อความแค่ถึงตัว " แรก
  // แล้วส่วนที่เหลืองอกเป็น attribute ขยะติดมากับ <input>
  //
  // ต่างกันแค่ " เท่านั้น -- null/undefined/ตัวเลข/บูลีน ทั้งสองตัวให้ผลเท่ากันหมด
  // (textContent = undefined ได้ "" ไม่ใช่ "undefined" จึงไม่ต้องมี String(s) คร่อมอีกชั้น)
  //
  // ใต้ node (tests/meetingrun.test.js) util ไม่ export esc เพราะตัวจริงต้องใช้ document
  // ตรงนี้เลยได้ undefined -- ไม่กระทบ เพราะเทสเรียกแต่ core ที่ไม่แตะ DOM
  const {esc} = (global.COWORK && global.COWORK.util) ||
    (typeof require !== 'undefined' ? require('./util.js') : {});

  function modelTitle(id) {
    const hit = MODELS.find((m) => m[0] === id);
    return hit ? hit[1] : (id || '');
  }

  function profileTitle(id) {
    const hit = PROFILES.find((p) => p[0] === id);
    return hit ? hit[1] : (id || '');
  }

  function engineTitle(id) {
    const hit = ENGINES.find((e) => e[0] === id);
    return hit ? hit[1] : (id || '');
  }

  // ถอดเสียงอย่างเดียวไม่ถามประเภท (กฎเดียวกับ web/app.js) -- profile เลือกแค่ว่าจะใช้
  // กฎสรุปชุดไหน โหมดนี้ไม่มีขั้นสรุปให้ใช้กฎกับมันเลย ถามไปก็เป็นคำถามที่คำตอบ
  // ไม่เปลี่ยนอะไร
  //
  // ซ่อนได้ที่เดียวคือโมเดลนี้ ซึ่งพิสูจน์ได้ว่าไม่มีขั้นสรุป -- ค่าที่ไม่รู้จักยังต้องถาม
  // เพราะฝั่งสรุปจะเตือนแล้วสรุปต่อ ถ้าซ่อนตรงนี้ผู้ใช้เสียสิทธิ์เลือกทั้งที่ยังได้สรุป
  //
  // แยกออกมาเป็น pure function ด้วยเหตุผลเดียวกับ viewOf: กฎการซ่อนเป็นสิ่งที่ต้องเทส
  // แต่ตัวที่ประกอบ HTML แตะ DOM
  function showsProfile(m) {
    return m !== NO_SUMMARY_MODEL;
  }

  function warnHtml() {
    if (!state || !state.warnings || !state.warnings.length) return '';
    return state.warnings
      .map((w) => `<div class="mrunwarn">⚠<span>${esc(w.text || w.code)}</span></div>`)
      .join('');
  }

  // จุดสถานะ watcher ดับไม่ปิดปุ่ม: การอัดไม่พึ่ง GPU เลย ไฟล์รอในคิวได้
  // บล็อกตรงนี้เท่ากับทำให้พลาดประชุมด้วยเหตุผลที่รอทีหลังได้
  function workerHtml() {
    if (!state || state.worker_ready !== false) return '';
    return '<div class="mrunwarn">⚠<span>ตัวประมวลผลไม่พร้อม — ยังอัดได้ตามปกติ '
      + 'ไฟล์จะเข้าคิวรอไว้ แล้วประมวลผลเมื่อตัวประมวลผลกลับมา</span></div>';
  }

  function optHtml(rows, chosen, attr) {
    return rows.map(([id, t, d]) => `
      <div class="mrunopt ${chosen === id ? 'on' : ''}" ${attr}="${esc(id)}">
        <span class="tick">✓</span>
        <span><span class="t">${esc(t)}</span><br><span class="d">${esc(d)}</span></span>
      </div>`).join('');
  }

  function modelsHtml() {
    if (!modelsOpen) return '';
    // ลำดับเดียวกับหน้าเว็บ: โมเดลก่อน ประเภททีหลัง แล้วตัวถอดเสียง
    const profiles = showsProfile(model)
      ? `<div class="mrunlabel">ประเภทประชุม</div>${optHtml(PROFILES, profile, 'data-profile')}`
      : '';
    // ตัวถอดเสียงไม่ผูกกับ showsProfile -- ถอดเสียงอย่างเดียวก็ยังต้องเลือกตัวถอดเสียง
    // (เหมือนหน้าเว็บ) เพราะขั้นนี้เกิดก่อนขั้นสรุปเสมอ
    const engines = `<div class="mrunlabel">ตัวถอดเสียง</div>${optHtml(ENGINES, engine, 'data-engine')}`;
    return `<div class="mrunx">${optHtml(MODELS, model, 'data-model')}${profiles}${engines}</div>`;
  }

  // ป้ายปุ่ม ⋯ ต้องบอกทุกอย่างที่แผงนั้นตั้งได้ -- ไม่งั้นตัวเลือกประเภทประชุมจะอยู่
  // หลังปุ่มที่สัญญาแค่เรื่องโมเดล และไม่มีใครรู้ว่าต้องกดที่นี่
  function moreTitle() {
    if (!showsProfile(model)) return `เลือกโมเดลสรุปและตัวถอดเสียง (${modelTitle(model)} · ${engineTitle(engine)})`;
    return `เลือกโมเดลสรุป ประเภทประชุม และตัวถอดเสียง `
      + `(${modelTitle(model)} · ${profileTitle(profile)} · ${engineTitle(engine)})`;
  }

  function viewIdle() {
    return `<div class="mrun" data-s="idle">
        <span class="sd"></span>
        <span class="stag">STANDBY</span>
        <input class="sin" id="mrunRoom" type="text" placeholder="ชื่อห้อง (ไม่ใส่ก็ได้)"
               value="${esc(roomDraft)}" autocomplete="off">
        <button class="sbtn" data-act="open">เปิดห้อง</button>
        <button class="smore" data-act="models" title="${esc(moreTitle())}">⋯</button>
      </div>${modelsHtml()}${workerHtml()}${warnHtml()}`;
  }

  // ไม่มีคำตอบจาก service บนเครื่องที่เคยใช้ได้ = บอกว่ากำลังรออะไรอยู่
  // เงียบไปเฉย ๆ แย่กว่า เพราะผู้ใช้ไม่รู้ว่าต้องไปเปิดอะไร
  function viewWaiting() {
    return `<div class="mrun" data-s="waiting">
        <span class="sd"></span>
        <span class="stag">OFF AIR</span>
        <span class="stxt"><em>· เปิด start-ui.bat ที่ meeting-notes ถ้ายังไม่ขึ้น</em></span>
      </div>`;
  }

  // GET / ตอบแล้ว (service มีจริง) แต่ /api/state ยังไม่มา -- ยังไม่รู้ว่ามีห้องที่กำลัง
  // บันทึกอยู่หรือเปล่า จึงยังไม่โชว์ปุ่มเปิดห้อง: กดตอนนี้อาจไปเปิดทับห้องที่กำลังอัด
  // แล้วได้ 409 กลับมา รอ 1-2 วินาทีเพื่อพูดความจริงถูกกว่า
  function viewConnecting() {
    return `<div class="mrun" data-s="connecting">
        <span class="sd"></span>
        <span class="stxt">รอความพร้อม ก่อน On Air…</span>
      </div>`;
  }

  // ON AIR = เสียงกำลังเข้าจริงเท่านั้น (ตัดสินใจแล้วโดยเจ้าของงาน)
  //
  // 'stopping' ถูกตั้งตั้งแต่วินาทีที่สั่งปิดห้อง แล้วค้างอยู่จนไฟล์ถูก drain และ encode
  // เสร็จ -- เป็นสิบวินาทีถึงเป็นนาทีในประชุมยาว และไม่มีเสียงเข้าเลยในช่วงนั้น ป้าย
  // ON AIR กับไฟแดงกะพริบตอนนั้นจึงหมายถึงคนละเรื่องกับที่มันสัญญาไว้
  //
  // ค่าที่ไม่รู้จักไม่นับเป็นออกอากาศโดยตั้งใจ: ไฟแดงต้องมาจากหลักฐานเดียวคือ
  // recorder === 'recording' ไม่ใช่จากการเดา
  //
  // ทุกที่ที่ต้องรู้ว่า "ออกอากาศอยู่จริงไหม" อ่านจากตัวนี้ตัวเดียว -- ป้ายบนแถบ
  // (airTagOf) · สีจุดบนแถบ (data-air) · คลาสของ pill บนแถบหัวข้อ (drawBar)
  // สามที่ที่เทียบ 'recording' เองคือสามที่ที่รอวันพูดไม่ตรงกัน
  function isOnAir(recorder) {
    return recorder === 'recording';
  }

  function airTagOf(recorder) {
    return isOnAir(recorder) ? 'ON AIR' : 'กำลังปิด';
  }

  function viewRecording() {
    const closing = state.recorder === 'stopping' || stopping;
    // data-s ยังเป็น recording ทั้งสองช่วง (นาฬิกาและปุ่มปิดห้องอยู่ที่ view นี้ทั้งคู่)
    // ตัวแยกสีคือ data-air
    return `<div class="mrun" data-s="recording" data-air="${isOnAir(state.recorder) ? 'on' : 'closing'}">
        <span class="sd"></span>
        <span class="stag">${airTagOf(state.recorder)}</span>
        <span class="sclock" id="mrunClock">${fmtClock(state.elapsed_seconds)}</span>
        <span class="stxt">${esc(state.room || 'ประชุมไม่ได้ตั้งชื่อ')}
          <em>· ${esc(modelTitle(state.model))}</em></span>
        <button class="sbtn stop" data-act="stop" ${closing ? 'disabled' : ''}>
          ${closing ? 'กำลังปิด…' : 'ปิดห้อง'}</button>
      </div>${warnHtml()}`;
  }

  let followingJob = null;   // stem ของงานที่กำลังตาม
  let dismissedJob = null;   // งานที่ผู้ใช้กด ✕ ปิดไปแล้ว
  let detailOpen = false;

  function stepsHtml(stage, failed) {
    const skip = state && state.model === NO_SUMMARY_MODEL;
    return STEPS.map((label, i) => {
      // transcript-only ไม่มีขั้นสรุปเลย ไม่ใช่ค้างเป็น ○ ตลอดกาล
      if (skip && i === SUMMARIZE_STEP) return '';
      if (failed && i === stage) {
        return `<div class="mrunstep err"><span class="ic">✕</span><span>${esc(label)}</span></div>`;
      }
      const cls = i < stage ? 'done' : i === stage ? 'now' : 'wait';
      const ic = i < stage ? '✓' : i === stage ? '<span class="mrunspin">◠</span>' : '○';
      return `<div class="mrunstep ${cls}"><span class="ic">${ic}</span><span>${esc(label)}</span></div>`;
    }).join('');
  }

  function logHtml() {
    const rows = ((state && state.activity) || []).slice(-60).map((e) => {
      const time = String(e.ts || '').slice(11, 19);
      return `<div class="${esc(e.level || 'info')}">${esc(time)}  ${esc(e.text || e.code)}</div>`;
    }).join('');
    return `<details class="mrunlog"><summary>▸ จอแสดงผลการทำงาน</summary><pre>${rows}</pre></details>`;
  }

  function stepCount() {
    return state && state.model === NO_SUMMARY_MODEL ? STEPS.length - 1 : STEPS.length;
  }

  // อัดเสร็จแล้วแต่ watcher ไม่ได้รัน -- ไฟล์นอนอยู่ใน inbox/ ไม่มีใครมาหยิบ
  // ปั่นสปินเนอร์ที่ขั้น "บีบอัดไฟล์เสียง" ตลอดกาลคือการโกหก งานนั้นเสร็จไปแล้ว
  // และไม่มีอะไรกำลังเดินอยู่เลย
  function viewQueued() {
    return `<div class="mrun" data-s="queued">
        <span class="sd"></span>
        <span class="stxt">⏸ รอตัวประมวลผล <em>· ไฟล์เข้าคิวไว้แล้ว จะประมวลผลเมื่อตัวประมวลผลกลับมา</em></span>
        <button class="smore" data-act="detail">${detailOpen ? '⌃' : '⌄'}</button>
      </div>
      ${detailOpen ? `<div class="mrunx"><div class="mrunjob">${esc(followingJob || '')}</div>
        ${stepsHtml(0, false)}${logHtml()}</div>` : ''}`;
  }

  function viewProcessing(progress) {
    const total = stepCount();
    const shown = Math.min(progress.stage + 1, total);
    return `<div class="mrun" data-s="processing">
        <span class="sd"></span>
        <span class="stxt"><span class="mrunspin">◠</span> ${esc(STEPS[progress.stage] || '')}
          <em>· ขั้นที่ ${shown} จาก ${total}</em></span>
        <button class="smore" data-act="detail">${detailOpen ? '⌃' : '⌄'}</button>
      </div>
      <div class="mrunbar"><i style="width:${Math.round((shown / total) * 100)}%"></i></div>
      ${detailOpen ? `<div class="mrunx"><div class="mrunjob">${esc(followingJob || '')}</div>
        ${stepsHtml(progress.stage, false)}${logHtml()}</div>` : ''}
      ${warnHtml()}`;
  }

  function viewDone() {
    return `<div class="mrun" data-s="done">
        <span class="sd"></span>
        <span class="stxt">✓ บันทึกเรียบร้อย <em>· ${esc(followingJob || '')}</em></span>
        <button class="sbtn" data-act="read">อ่านสรุป</button>
        <button class="smore" data-act="dismiss" title="ปิด">✕</button>
      </div>`;
  }

  function viewFailed(progress) {
    return `<div class="mrun" data-s="failed">
        <span class="sd"></span>
        <span class="stxt">✕ ประมวลผลไม่สำเร็จที่ขั้น "${esc(STEPS[progress.stage] || '')}"</span>
        <button class="smore" data-act="detail">${detailOpen ? '⌃' : '⌄'}</button>
      </div>
      ${detailOpen ? `<div class="mrunx">
        <div class="mrunwarn bad">⚠<span>เสียงและไฟล์ถอดเสียงยังอยู่ครบใน <code>failed/</code> —
          ประชุมไม่ได้หาย สั่งประมวลผลใหม่ได้จากฝั่ง meeting-notes</span></div>
        <div class="mrunjob">${esc(followingJob || '')}</div>
        ${stepsHtml(progress.stage, true)}${logHtml()}</div>` : ''}`;
  }

  // การเลือก view แยกออกมาเป็น pure function เพื่อให้ node --test เทสบันไดได้
  // โดยไม่ต้องมี DOM -- draw() ยังเป็นคนคำนวณ progress/following แล้วส่งเข้ามา
  // ลำดับสำคัญ: failed ชนะทุกขั้น แล้วจึง done, queued, processing
  function viewOf(opts) {
    const o = opts || {};
    const state = o.state;
    // ไม่มี state: seenService เป็นประตูชั้นแรก ไม่ใช่ ready
    //
    // เครื่องที่ไม่เคยเห็น service เลยต้องเงียบสนิทเสมอ ต่อให้ ready เป็น true --
    // ความพร้อมพิสูจน์ได้แค่ว่า *มีอะไร* ตอบ HTTP บนพอร์ตนั้น แอปอื่นที่ถือพอร์ต 8765
    // อยู่ก็ตอบได้ ถ้าปล่อยให้ ready ปลุกแถบขึ้นมาได้เอง 8 เครื่องที่ติดตั้งไปซึ่งไม่มี
    // ตัวอัดจะได้ "รอความพร้อม ก่อน On Air…" ค้างไปตลอดกาล ซึ่งค้านสัญญาของสเปกที่ว่า
    // แท็บ Meeting บนเครื่องพวกนั้นต้องเหมือน v1.8.1 เป๊ะ
    //
    // พอผ่านประตูแรกแล้ว ready จึงเป็นตัวแยก: ตอบอยู่แต่ยังอ่านสถานะไม่ได้ = connecting
    // ไม่ใช่ waiting (ซึ่งบอกให้ไปเปิด start-ui.bat ทั้งที่มันเปิดอยู่แล้ว)
    if (!state) {
      if (!o.seenService) return 'absent';
      return o.ready ? 'connecting' : 'waiting';
    }
    if (state.recorder === 'recording' || state.recorder === 'stopping') return 'recording';
    if (!o.following) return 'idle';
    // ไม่มีค่า default ให้ progress โดยตั้งใจ: draw() คำนวณ following *จาก* progress
    // (following = !!(progress && …)) ดังนั้น following จริง = progress ไม่เป็น null เสมอ
    // ค่า default จะไม่แก้เคสไหนที่ไปถึงได้ แต่จะกลืนการผิดสัญญาในอนาคตให้กลายเป็น
    // 'processing' เงียบ ๆ แทนที่จะโยนให้เห็น ซึ่งค้านกับเหตุผลที่แยกฟังก์ชันนี้ออกมา
    const progress = o.progress;
    if (progress.failed) return 'failed';
    if (progress.stage >= 4) return 'done';
    // stage 0 = ยังไม่มีเหตุการณ์จาก watcher เลย ถ้า watcher ไม่ได้รันด้วย
    // แปลว่ามันไม่ได้ "กำลังทำ" อะไร แต่กำลัง "รอ"
    if (progress.stage === 0 && state.worker_ready === false) return 'queued';
    return 'processing';
  }

  function draw() {
    // ขั้น "บีบอัดไฟล์เสียง" ไม่ได้มาจาก activity[] -- ตอน encode ยังไม่มี
    // last_result ให้ตาม จึงอ่านจาก recorder === 'stopping' แทน ซึ่งกินช่วงนั้นพอดี
    const recording = state && (state.recorder === 'recording' || state.recorder === 'stopping');
    const progress = !state || recording ? null : progressOf(state.activity, followingJob);
    const following = !!(progress && followingJob !== dismissedJob);
    const view = viewOf({ ready, state, seenService, progress, following });

    // profile ต้องอยู่ในลายเซ็นคู่กับ model: ถ้าไม่มี การกดเลือกประเภทจะเปลี่ยนตัวแปรจริง
    // แต่เครื่องหมายถูกไม่ขยับ ผู้ใช้เห็นว่ากดไม่ติดแล้วกดซ้ำ หรือเริ่มอัดด้วยประเภทที่
    // ไม่ได้ตั้งใจ (บั๊กจริงที่ web/app.js บันทึกไว้)
    const sig = [view, ready, seenService, state && state.room, state && state.model, model, profile, engine, modelsOpen, stopping,
      detailOpen, followingJob, state && state.worker_ready,
      progress ? `${progress.stage}:${progress.failed}` : '',
      state ? (state.warnings || []).map((w) => w.code).join(',') : ''].join('|');
    if (sig !== signature) {
      // service ไม่ตอบ = ไม่วาดอะไรเลย ไม่ใช่ปุ่มเทาที่กดแล้วพัง
      root.innerHTML = view === 'absent' ? ''
        : view === 'connecting' ? viewConnecting()
        : view === 'waiting' ? viewWaiting()
        : view === 'recording' ? viewRecording()
        : view === 'queued' ? viewQueued()
        : view === 'processing' ? viewProcessing(progress)
        : view === 'done' ? viewDone()
        : view === 'failed' ? viewFailed(progress)
        : viewIdle();
      signature = sig;
    }
    // นาฬิกาเดินทุกวินาทีโดยไม่ต้องวาดใหม่ทั้งก้อน -- การแทน innerHTML ทุกวินาที
    // จะดีดเคอร์เซอร์ออกจากช่องชื่อห้องระหว่างที่ผู้ใช้พิมพ์อยู่
    const clock = root.querySelector('#mrunClock');
    if (clock && state) clock.textContent = fmtClock(state.elapsed_seconds);
    drawBar(view, progress);
  }

  function confirmStop() {
    const scrim = document.getElementById('mrunScrim');
    if (scrim) scrim.classList.remove('hidden');
  }

  async function openRoom() {
    const input = root.querySelector('#mrunRoom');
    roomDraft = input ? input.value.trim() : '';
    if (!api || !api.startMeeting) return;
    // ส่ง profile ไปเสมอแม้ตอน transcript-only (เหมือนหน้าเว็บ) -- service เก็บค่าไว้เฉย ๆ
    // โดยไม่มีใครใช้ ดีกว่ามีกฎที่สองตรงนี้ที่ต้องคอยซิงก์กับฝั่งนั้น
    const res = await api.startMeeting(model, roomDraft, profile, engine);
    // 409 = มีห้องเปิดอยู่แล้ว ปล่อยให้ poll รอบถัดไปบอกความจริง ไม่เดาแทน
    if (res && res.ok) { roomDraft = ''; modelsOpen = false; }
    if (api.getRunnerState) onData(await api.getRunnerState());
  }

  async function stopRoom() {
    stopping = true;
    draw();
    if (api && api.stopMeeting) await api.stopMeeting();
    if (api && api.getRunnerState) onData(await api.getRunnerState());
  }

  // ต้องเจาะจง [data-model] / [data-profile] ไม่ใช่ .mrunopt เฉย ๆ: การ์ดสองชุดใช้คลาส
  // เดียวกัน ถ้าจับด้วยคลาส การกดเลือกประเภทจะตั้ง model = undefined ไปด้วย
  // (บั๊กจริงที่ web/app.js บันทึกไว้ ไม่ใช่ความกังวลลอย ๆ)
  //
  // แผงไม่ปิดตัวเองหลังเลือกอีกแล้ว -- มีสองอย่างให้ตั้งในแผงเดียว ปิดทันทีเท่ากับบังคับ
  // ให้กด ⋯ ใหม่เพื่อเลือกอย่างที่สอง ปิดด้วยการกด ⋯ ซ้ำ หรือตอนเปิดห้องสำเร็จ
  function onClick(e) {
    const opt = e.target.closest('[data-model]');
    if (opt) {
      model = opt.dataset.model;
      if (api && api.saveRunnerConfig) api.saveRunnerConfig({ model });
      draw();
      return;
    }
    const prof = e.target.closest('[data-profile]');
    if (prof) {
      profile = prof.dataset.profile;
      if (api && api.saveRunnerConfig) api.saveRunnerConfig({ profile });
      draw();
      return;
    }
    const eng = e.target.closest('[data-engine]');
    if (eng) {
      engine = eng.dataset.engine;
      if (api && api.saveRunnerConfig) api.saveRunnerConfig({ engine });
      draw();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'models') { modelsOpen = !modelsOpen; draw(); }
    if (act.dataset.act === 'open') openRoom();
    if (act.dataset.act === 'stop') confirmStop();
    if (act.dataset.act === 'detail') { detailOpen = !detailOpen; draw(); }
    if (act.dataset.act === 'dismiss') { dismissedJob = followingJob; detailOpen = false; draw(); }
    // ส่ง id ของโฟลเดอร์ออกไปเลย ไม่ใช่ชื่องาน -- การแปลงเป็นหน้าที่ของโมดูลนี้
    // ที่ถือ activity อยู่ ไม่ใช่ของ widget.html ที่ต้องมาเดาต่อ
    if (act.dataset.act === 'read' && onRead) {
      onRead(finishedMeetingId(state && state.activity, followingJob));
    }
  }

  function onInput(e) {
    if (e.target && e.target.id === 'mrunRoom') roomDraft = e.target.value;
  }

  let barEl = null;
  let onJump = null;
  let onRead = null;

  function mountRead(handler) { onRead = handler; }

  // ปุ่มปิดห้องไม่อยู่บนแถบบนโดยตั้งใจ -- ปุ่มที่ทำงานย้อนไม่ได้ต้องอยู่ที่เดียว
  // และมีบริบทรอบตัว กดที่นี่แค่พากลับไปแท็บ Meeting
  function drawBar(view, progress) {
    if (!barEl) return;
    let cls = null;
    let html = '';
    if (view === 'recording') {
      // pill แดงกะพริบต้องหมายถึงสิ่งเดียวกับป้าย ON AIR บนแถบ ไม่ใช่ "view เป็น
      // recording" ซึ่งกินช่วง encode หลังปิดห้องด้วย -- ช่วงนั้นใช้ wait (amber
      // ไม่กะพริบ) ซึ่งมีอยู่แล้วสำหรับ queued จึงไม่ต้องเพิ่มสีหรือคลาสใหม่
      // นาฬิกายังเดินอยู่ทั้งสองช่วง คนที่ลืมปิดห้องยังต้องเห็นเวลา
      cls = isOnAir(state.recorder) ? 'rec' : 'wait';
      html = `<span class="d"></span>${fmtClock(state.elapsed_seconds)}`;
    } else if (view === 'processing') {
      const total = stepCount();
      cls = 'proc';
      html = `<span class="d"></span>${esc(STEPS[progress.stage] || '')} `
        + `${Math.min(progress.stage + 1, total)}/${total}`;
    } else if (view === 'queued') {
      cls = 'wait';
      html = '<span class="d"></span>รอตัวประมวลผล';
    } else if (view === 'done') {
      cls = 'done';
      html = '<span class="d"></span>เสร็จแล้ว';
    } else if (view === 'failed') {
      cls = 'rec';
      html = '<span class="d"></span>ล้มเหลว';
    }
    barEl.className = cls ? `mrunlive ${cls}` : 'mrunlive hidden';
    barEl.innerHTML = html;
  }

  function mountBar(el, jump) {
    barEl = el;
    onJump = jump;
    barEl.onclick = () => { if (onJump) onJump(); };
  }

  function mount(el) {
    root = el;
    api = global.cowork || null;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    if (api && api.getRunnerConfig) {
      api.getRunnerConfig().then((cfg) => {
        if (!cfg) return;
        if (cfg.model) model = cfg.model;
        if (cfg.profile) profile = cfg.profile;
        if (cfg.engine) engine = cfg.engine;
        if (cfg.seen) seenService = true;
        draw();
      });
    }
    const yes = document.getElementById('mrunYes');
    const no = document.getElementById('mrunNo');
    if (yes) {
      yes.onclick = () => {
        document.getElementById('mrunScrim').classList.add('hidden');
        stopRoom();
      };
    }
    if (no) no.onclick = () => document.getElementById('mrunScrim').classList.add('hidden');
    draw();
  }

  function onData(next) {
    // payload คือ { ready, state } ไม่ใช่ state เปล่า ๆ -- ready มาจาก GET / ซึ่งเร็ว
    // และเชื่อได้ ส่วน state มาจาก /api/state ซึ่งช้าได้และเป็น null ได้
    const payload = next || {};
    ready = !!payload.ready;
    state = payload.state || null;
    // ติดต่อได้ครั้งเดียวก็พอที่จะรู้ว่าเครื่องนี้มีตัวอัด -- ครั้งต่อไปที่ติดต่อ
    // ไม่ได้จึงบอกว่า "รออยู่" แทนที่จะหายไปเงียบ ๆ
    // ผูกกับ state ที่ parse ผ่าน ไม่ใช่ ready -- ต้องเป็นหลักฐานชุดเดียวกับที่ main.js
    // ใช้เขียน meetingRunnerSeen ลง config ไม่งั้นกฎ absent ใน viewOf ไม่มีผลอะไรเลย:
    // แอปอื่นที่ถือพอร์ต 8765 อยู่จะทำให้ ready เป็น true ในรอบ poll แรก แล้วยกธงนี้
    // ค้างไว้ตลอดชีพหน้าต่าง แถบก็ติดขึ้นมาอยู่ดี
    if (state) seenService = true;
    if (state && state.recorder === 'recording') stopping = false;
    // เริ่มตามงานตั้งแต่วินาทีที่ service บอกว่าได้ไฟล์แล้ว -- last_result ถูกล้าง
    // เมื่อเปิดห้องถัดไป จึงต้องจำไว้เอง ไม่ใช่อ่านจาก state ทุกรอบ
    if (state && state.last_result) {
      const stem = jobStemOf(state.last_result);
      if (stem && stem !== followingJob && stem !== dismissedJob) {
        followingJob = stem;
        detailOpen = false;
      }
    }
    if (root) draw();
  }

  // ถามสถานะทันทีที่เข้าแท็บ แทนที่จะรอรอบ poll ถัดไป -- เปิด service ทีหลัง
  // แล้วต้องนั่งรอถึง 30 วิโดยไม่มีอะไรบอกว่ารออะไร คือสิ่งที่เจอจริงตอนเทส
  function onShow() {
    if (api && api.getRunnerState) api.getRunnerState().then(onData);
  }
  function onHide() {}

  const core = {
    STEPS,
    SUMMARIZE_STEP,
    NO_SUMMARY_MODEL,
    PROFILES,
    DEFAULT_PROFILE,
    profileTitle,
    showsProfile,
    ENGINES,
    DEFAULT_ENGINE,
    engineTitle,
    STAGE_OF,
    jobStemOf,
    fmtClock,
    progressOf,
    finishedMeetingId,
    isOnAir,
    airTagOf,
    viewOf,
    viewWaiting,
    viewConnecting,
  };

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.meetingRunCore = core;
  global.COWORK.tabs.meetingRunner = { mount, mountBar, mountRead, onData, onShow, onHide };

  // เปิดทาง node --test ให้เทส logic ได้โดยไม่ต้องมี DOM
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
