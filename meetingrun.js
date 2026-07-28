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

  // ---- ตัวโมดูล (ต้องมี DOM) ------------------------------------------------
  const MODELS = [
    ['GLM-5.2', 'GLM 5.2', 'ข้อมูลไม่ออกนอกบริษัท · ช้ากว่า'],
    ['claude-opus-5', 'Opus 5', 'แม่นสุด · $5/$25 ต่อ MTok'],
    ['claude-sonnet-5', 'Sonnet 5', 'ประหยัด · $3/$15 ต่อ MTok'],
    [NO_SUMMARY_MODEL, 'ถอดเสียงอย่างเดียว', 'ไม่สรุป · ไม่เสียเงิน'],
  ];

  let root = null;
  let api = null;           // window.cowork
  let state = null;         // state ล่าสุดจาก service (null = ไม่ตอบ)
  let model = 'GLM-5.2';
  let roomDraft = '';
  let modelsOpen = false;
  let stopping = false;     // กันกดปิดซ้ำระหว่างรอ service ตอบ
  let signature = null;     // วาดใหม่เฉพาะตอนสถานะเปลี่ยนจริง

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function modelTitle(id) {
    const hit = MODELS.find((m) => m[0] === id);
    return hit ? hit[1] : (id || '');
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

  function modelsHtml() {
    if (!modelsOpen) return '';
    return `<div class="mrunx">${MODELS.map(([id, t, d]) => `
      <div class="mrunopt ${model === id ? 'on' : ''}" data-model="${esc(id)}">
        <span class="tick">✓</span>
        <span><span class="t">${esc(t)}</span><br><span class="d">${esc(d)}</span></span>
      </div>`).join('')}</div>`;
  }

  function viewIdle() {
    return `<div class="mrun" data-s="idle">
        <span class="sd"></span>
        <input class="sin" id="mrunRoom" type="text" placeholder="ชื่อห้อง (ไม่ใส่ก็ได้)"
               value="${esc(roomDraft)}" autocomplete="off">
        <button class="sbtn" data-act="open">เปิดห้อง</button>
        <button class="smore" data-act="models" title="เลือกโมเดลสรุป (${esc(modelTitle(model))})">⋯</button>
      </div>${modelsHtml()}${workerHtml()}${warnHtml()}`;
  }

  function viewRecording() {
    const closing = state.recorder === 'stopping' || stopping;
    return `<div class="mrun" data-s="recording">
        <span class="sd"></span>
        <span class="sclock" id="mrunClock">${fmtClock(state.elapsed_seconds)}</span>
        <span class="stxt">${esc(state.room || 'ประชุมไม่ได้ตั้งชื่อ')}
          <em>· ${esc(modelTitle(state.model))}</em></span>
        <button class="sbtn stop" data-act="stop" ${closing ? 'disabled' : ''}>
          ${closing ? 'กำลังปิด…' : 'ปิดห้อง'}</button>
      </div>${warnHtml()}`;
  }

  function draw() {
    const view = !state ? 'absent'
      : (state.recorder === 'recording' || state.recorder === 'stopping') ? 'recording' : 'idle';
    const sig = [view, state && state.room, state && state.model, model, modelsOpen, stopping,
      state && state.worker_ready,
      state ? (state.warnings || []).map((w) => w.code).join(',') : ''].join('|');
    if (sig !== signature) {
      // service ไม่ตอบ = ไม่วาดอะไรเลย ไม่ใช่ปุ่มเทาที่กดแล้วพัง
      root.innerHTML = view === 'absent' ? ''
        : view === 'recording' ? viewRecording() : viewIdle();
      signature = sig;
    }
    // นาฬิกาเดินทุกวินาทีโดยไม่ต้องวาดใหม่ทั้งก้อน -- การแทน innerHTML ทุกวินาที
    // จะดีดเคอร์เซอร์ออกจากช่องชื่อห้องระหว่างที่ผู้ใช้พิมพ์อยู่
    const clock = root.querySelector('#mrunClock');
    if (clock && state) clock.textContent = fmtClock(state.elapsed_seconds);
  }

  function confirmStop() {
    const scrim = document.getElementById('mrunScrim');
    if (scrim) scrim.classList.remove('hidden');
  }

  async function openRoom() {
    const input = root.querySelector('#mrunRoom');
    roomDraft = input ? input.value.trim() : '';
    if (!api || !api.startMeeting) return;
    const res = await api.startMeeting(model, roomDraft);
    // 409 = มีห้องเปิดอยู่แล้ว ปล่อยให้ poll รอบถัดไปบอกความจริง ไม่เดาแทน
    if (res && res.ok) roomDraft = '';
    if (api.getRunnerState) onData(await api.getRunnerState());
  }

  async function stopRoom() {
    stopping = true;
    draw();
    if (api && api.stopMeeting) await api.stopMeeting();
    if (api && api.getRunnerState) onData(await api.getRunnerState());
  }

  function onClick(e) {
    const opt = e.target.closest('[data-model]');
    if (opt) {
      model = opt.dataset.model;
      modelsOpen = false;
      if (api && api.saveRunnerConfig) api.saveRunnerConfig({ model });
      draw();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'models') { modelsOpen = !modelsOpen; draw(); }
    if (act.dataset.act === 'open') openRoom();
    if (act.dataset.act === 'stop') confirmStop();
  }

  function onInput(e) {
    if (e.target && e.target.id === 'mrunRoom') roomDraft = e.target.value;
  }

  function mount(el) {
    root = el;
    api = global.cowork || null;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    if (api && api.getRunnerConfig) {
      api.getRunnerConfig().then((cfg) => { if (cfg && cfg.model) { model = cfg.model; draw(); } });
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
    state = next;
    if (state && state.recorder === 'recording') stopping = false;
    if (root) draw();
  }

  function onShow() {}
  function onHide() {}

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
  global.COWORK.tabs.meetingRunner = { mount, onData, onShow, onHide };

  // เปิดทาง node --test ให้เทส logic ได้โดยไม่ต้องมี DOM
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
