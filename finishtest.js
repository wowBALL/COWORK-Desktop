// แผงตรวจก่อนสรุปผลเทสกลับ Redmine — ใช้ร่วมกันสองที่ (ตัดสินใจ 2026-08-07 ทำทั้ง A และ B):
//   · แท็บ Redmine  — ปุ่ม ✅/❌ ท้ายแถวงานสถานะ Test กางแผงใต้แถว
//   · Testing Room — ปุ่ม "จบงาน" บนหัวใบเทส กางแผงใต้หัวใบ
// ทั้งสองทางเรียก open() ตัวเดียวกัน ข้อความที่ QA เห็นและปุ่มยืนยันจึงเป็นอันเดียวกันเสมอ
//
// ไม่มี CSS ของตัวเอง — ใช้คลาส .testPreview/.tp-* ที่แผงปิดงานใช้อยู่แล้ว (tab-redmine.css)
// เพราะเป็นแผงชนิดเดียวกันในสายตาผู้ใช้ ต่างกันแค่เนื้อใน
//
// การเขียนกลับ Redmine เกิดที่เดียวคือปุ่มยืนยันในไฟล์นี้ Testing Room เองยังไม่แตะ Redmine
(function (global) {
  'use strict';

  // ---- ฟังก์ชันบริสุทธิ์ (ท้ายไฟล์ export ให้ node --test) ----

  // ผลสรุป → คำ/สถานะปลายทาง ตารางเดียวจบ เพื่อให้ "fail ต้องไม่มีวันพาไป Resolved"
  // เป็นข้อที่เทสยืนยันได้ ไม่ใช่ ternary ที่กระจายอยู่ในโค้ดวาดหน้าจอ
  // (ฝั่ง main มี OUTCOMES ของตัวเองใน testingroom.js — ตัวนั้นคุมข้อความที่เขียนลงไฟล์
  //  ตัวนี้คุมสิ่งที่แสดงบนจอ ทั้งคู่ผูกกับสถานะปลายทางเดียวกัน)
  const OUTCOMES = {
    success: { icon: '✅', word: 'ทดสอบผ่าน', target: 'Resolved', cls: 'ok' },
    fail: { icon: '❌', word: 'ทดสอบไม่ผ่าน', target: 'In Progress', cls: 'danger' },
  };
  function outcomeMeta(outcome) { return OUTCOMES[outcome] || null; }

  // สิ่งที่ต้องเตือนก่อนกดยืนยัน — เตือนอย่างเดียว ไม่ปิดปุ่ม (ตัดสินใจ 2026-08-07)
  // เพราะบางข้อจงใจไม่ทดสอบแล้วเขียนเหตุผลไว้ในหมายเหตุ ปุ่มที่กดไม่ได้จะกลายเป็นทางตัน
  // ที่ต้องไปแก้ไฟล์เอง ซึ่งแย่กว่าการปล่อยให้ตัดสินใจเองโดยเห็นข้อมูลครบ
  function warningsFor(preview) {
    const out = [];
    const t = (preview && preview.tally) || {};
    if (t.todo) out.push(`ยังมี ${t.todo} ข้อที่ยังไม่ได้ติ๊กผล — จะถูกบันทึกว่า "ยังไม่ทดสอบ"`);
    // fail ที่ตรวจแล้วว่าสคริปเทสเองพัง ไม่ใช่ข้อขัดข้องของการสรุปว่าผ่าน — ระบบไม่ได้มีบั๊ก
    // เตือนเฉพาะ fail ที่เหลือหลังหักกองนั้นออก ไม่งั้นจะเตือนทุกใบจนคนเลิกอ่านคำเตือน
    const realFail = (t.fail || 0) - (t.scriptFail || 0);
    if (preview && preview.outcome === 'success' && realFail > 0) {
      out.push(`ใบนี้มี ${realFail} ข้อที่ผลเป็น fail แต่กำลังจะสรุปว่าผ่าน`);
    }
    // กองที่อันตรายที่สุด: auto fail ที่ยังไม่มีใครเข้าไปดูว่าสคริปพังหรือระบบพัง
    // ส่งกลับ Redmine ตอนนี้ = เดาแทน QA ไม่ว่าจะสรุปว่าผ่านหรือไม่ผ่านก็ผิดได้ทั้งคู่
    if (t.unjudgedFail) {
      out.push(`มี ${t.unjudgedFail} ข้อที่ auto fail แต่ยังไม่ได้ตรวจว่าเป็นที่สคริปเทสหรือที่ระบบ`);
    }
    if (preview && preview.status && preview.status !== 'Test') {
      out.push(`ตอนนี้งานอยู่สถานะ ${preview.status} ไม่ใช่ Test แล้ว`);
    }
    return out;
  }

  // ก้อน `issue` ที่ถูก PUT ขึ้น Redmine — ย้ายสถานะ + Test Results + โน้ต + ไฟล์แนบ
  // อยู่ในคำขอเดียวโดยตั้งใจ (ล้มก็ล้มทั้งก้อน ไม่มีสภาพ "ย้ายสถานะแล้วแต่ผลไม่ถูกบันทึก")
  // main.js require ฟังก์ชันนี้ไปใช้ ตัวประกอบ payload จึงเทสได้ด้วย node --test ไม่ต้องยิงเน็ต
  //
  // คีย์ที่ว่างต้อง "ไม่ส่ง" ไม่ใช่ "ส่งเป็นค่าว่าง": notes:'' ทำให้ Redmine เพิ่มโน้ตเปล่า
  // ลงไทม์ไลน์ของงานทุกครั้งที่กดยืนยัน — รกโดยไม่ได้ข้อมูลเพิ่ม
  function buildIssueUpdate({ statusId, fieldId, value, notes, uploads } = {}) {
    const out = { status_id: statusId };
    // ค่าว่างต้องเป็น '' ไม่ใช่ null — Redmine ตอบ 422 กับ null (พฤติกรรมเดิมของ finish-test)
    if (fieldId) out.custom_fields = [{ id: fieldId, value: String(value == null ? '' : value) }];
    const note = String(notes == null ? '' : notes).trim();
    if (note) out.notes = note;
    // เอาเฉพาะสามคีย์ที่ Redmine ใช้ — ฝั่งหน้าจอเก็บ dataUrl ของรูปย่อไว้ในอ็อบเจกต์เดียวกัน
    // ถ้าปล่อยหลุดไปด้วยจะยิง base64 หลายร้อย KB ขึ้นเซิร์ฟเวอร์ทุกครั้งโดยไม่มีใครใช้
    if (uploads && uploads.length) {
      out.uploads = uploads.map(u => ({ token: u.token, filename: u.filename, content_type: u.content_type }));
    }
    return out;
  }

  if (typeof window === 'undefined') {
    module.exports = { OUTCOMES, outcomeMeta, warningsFor, buildIssueUpdate };
    return;
  }

  const { esc } = global.COWORK.util;
  const api = () => global.COWORK.shell.api;

  // host = element ที่จะให้แผงไปอยู่ข้างใน (ถูกล้างก่อนเสมอ)
  // opts.onSettled ถูกเรียกเมื่อโหลดพรีวิวเสร็จ ไม่ว่าสำเร็จหรือไม่ — ตัวเรียกใช้เอาไปคืนสภาพปุ่ม
  // opts.onClose ถูกเรียกเมื่อผู้ใช้ปิด/ยกเลิกแผง · opts.onDone เมื่อเขียนกลับ Redmine สำเร็จ
  function open(host, issueId, outcome, opts) {
    const o = outcomeMeta(outcome);
    const options = opts || {};
    if (!o || !host) return;
    host.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'testPreview';
    loading.textContent = 'กำลังรวบรวมผลจากใบเทส…';
    host.appendChild(loading);
    api().getFinishPreview(issueId, outcome).then(preview => {
      if (options.onSettled) options.onSettled(preview);
      host.innerHTML = '';
      host.appendChild(render(host, issueId, o, preview || { ok: false }, options));
    });
  }

  function closePanel(host, options) {
    host.innerHTML = '';
    if (options.onClose) options.onClose();
  }

  // ---- รูปแนบในช่องโน้ต ----
  // อัปขึ้น Redmine ตอน "วาง" ไม่ใช่ตอนกดยืนยัน เหมือนฟอร์มสร้าง issue — อัปไม่ขึ้นจะได้รู้
  // ทันทีตอนที่ยังแก้อะไรได้ ไม่ใช่ไปพังตอนกดยืนยันซึ่งเป็นจังหวะที่คนคิดว่าจบงานแล้ว
  //
  // ราคาที่ยอมจ่าย: วางรูปแล้วกดยกเลิก จะเหลือ upload กำพร้าบนเซิร์ฟเวอร์ (Redmine เก็บกวาดเอง)
  // เป็นพฤติกรรมเดียวกับฟอร์มสร้าง issue ที่ใช้อยู่ทุกวันนี้

  // คลิปบอร์ดไม่มีชื่อไฟล์ติดมา ชื่อตายตัวจะชนกันเองตอนวางหลายรูปในโน้ตเดียว
  // รูปแบบเดียวกับที่หน้าเว็บ Redmine ตั้งให้ (clipboard-YYYYMMDDHHMM-xxxxx)
  function shotName(file) {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const ext = ((file.type || '').split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
    return `clipboard-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
      + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  }
  function pastedImages(e) {
    return [...((e.clipboardData && e.clipboardData.items) || [])]
      .filter(it => it.kind === 'file' && /^image\//i.test(it.type))
      .map(it => it.getAsFile())
      .filter(Boolean);
  }
  function insertAtCursor(el, text) {
    const start = el.selectionStart == null ? el.value.length : el.selectionStart;
    const end = el.selectionEnd == null ? start : el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  }

  // คืน { list() } ให้ปุ่มยืนยันหยิบไฟล์แนบชุดล่าสุดตอนกด — ไม่ส่งอาเรย์ออกไปตรง ๆ เพราะ
  // ผู้เรียกจะถือ reference ที่ยังถูกแก้ต่อได้ ซึ่งอ่านยากกว่าเรียกฟังก์ชันตอนที่ต้องใช้จริง
  function wireNoteAttachments(panel) {
    const note = panel.querySelector('.tp-note');
    const strip = panel.querySelector('.tp-shots');
    const errEl = panel.querySelector('.tp-shots-err');
    const shots = [];   // [{token, filename, content_type, dataUrl}]
    // แท็กที่ฝังในโน้ต — ต้องประกอบสูตรเดียวกันทั้งตอนแทรกและตอนถอด ไม่งั้นถอดไม่ออก
    // รูปแบบเดียวกับที่ฟอร์มสร้าง issue ใช้ (Redmine ตัวนี้เรนเดอร์ <img src="ชื่อไฟล์แนบ"> ได้)
    const imgTag = (filename) => `<img src="${filename}">`;
    const fail = (filename, why) => {
      errEl.textContent = `แนบไฟล์ "${filename}" ไม่สำเร็จ: ${why}`;
      errEl.classList.add('on');
    };
    function renderStrip() {
      strip.innerHTML = shots.map((s, i) => `
        <div class="tp-shot" title="${esc(s.filename)}">
          ${s.dataUrl ? `<img src="${esc(s.dataUrl)}" alt="">` : ''}
          <button type="button" class="tp-shot-drop" data-i="${i}"
            title="เอารูปนี้ออกจากโน้ต">×</button>
        </div>`).join('');
      strip.querySelectorAll('.tp-shot-drop').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const [gone] = shots.splice(Number(btn.dataset.i), 1);
          // ถอดแท็กในโน้ตด้วย ไม่งั้นเหลือ <img> ชี้ไฟล์ที่ไม่ได้แนบแล้ว = รูปแตกใน Redmine
          if (gone) note.value = note.value.split(imgTag(gone.filename)).join('');
          renderStrip();
        };
      });
    }
    note.addEventListener('paste', (e) => {
      const files = pastedImages(e);
      if (!files.length) return;   // วางข้อความธรรมดา ปล่อยให้เบราว์เซอร์ทำงานตามปกติ
      e.preventDefault();
      errEl.textContent = ''; errEl.classList.remove('on');
      files.forEach(file => {
        const filename = shotName(file);
        const entry = { filename, token: '', content_type: file.type, dataUrl: '' };
        // แทรกแท็กทันทีที่วาง เพื่อให้รูปไปอยู่ตรงตำแหน่งที่ผู้ใช้เล็งไว้จริง ๆ ไม่ใช่ท้ายข้อความ
        // ตอนอัปเสร็จ (ซึ่งเคอร์เซอร์ย้ายไปไหนแล้วก็ไม่รู้) — อัปไม่ขึ้นค่อยถอดแท็กออก
        insertAtCursor(note, imgTag(filename));
        const reader = new FileReader();
        reader.onload = () => { entry.dataUrl = String(reader.result || ''); renderStrip(); };
        reader.readAsDataURL(file);
        file.arrayBuffer()
          .then(buf => api().uploadIssueAttachment(new Uint8Array(buf), filename))
          .then(res => {
            if (!res || !res.ok) {
              note.value = note.value.split(imgTag(filename)).join('');
              const at = shots.indexOf(entry);
              if (at >= 0) shots.splice(at, 1);
              renderStrip();
              return fail(filename, (res && res.error) || 'ไม่ทราบสาเหตุ');
            }
            entry.token = res.token;
            renderStrip();
          })
          .catch(err => fail(filename, err.message));
        shots.push(entry);
        renderStrip();
      });
    });
    // รูปที่ยังอัปไม่เสร็จไม่มี token — ส่งขึ้นไปก็ถูกปฏิเสธ ตัดออกตรงนี้ที่เดียว
    // และตัด dataUrl (รูปย่อ) ทิ้งก่อนข้าม IPC ด้วย: มันเป็น base64 หลายร้อย KB ต่อรูปที่ไม่มี
    // ใครใช้ฝั่ง main เลย — buildIssueUpdate กันไว้อีกชั้น แต่ไม่มีเหตุผลให้แบกมันข้ามไปตั้งแต่แรก
    return {
      list: () => shots.filter(s => s.token)
        .map(s => ({ token: s.token, filename: s.filename, content_type: s.content_type })),
    };
  }

  function render(host, issueId, o, preview, options) {
    const panel = document.createElement('div');
    panel.className = 'testPreview finish ' + o.cls;
    panel.onclick = e => e.stopPropagation();
    const head = `<div class="tp-head"><span class="tp-title">${o.icon} ${esc(o.word)} · #${esc(String(issueId))} → ${esc(o.target)}</span></div>`;

    // อ่านใบเทส/Redmine ไม่ได้ หรือ tracker นี้ไม่มี field "Test Results" — จบตรงนี้
    // ไม่ให้ย้ายสถานะโดยไม่มีที่บันทึกผล เพราะทั้งหมดของปุ่มนี้คือการบันทึกผล
    const blocked = !preview.ok ? ((preview && preview.error) || 'ไม่ทราบสาเหตุ')
      : !preview.testResults ? 'งานนี้ไม่มี field "Test Results" ในโปรเจกต์/tracker นี้ จึงสรุปผลจากตรงนี้ไม่ได้'
        : '';
    if (blocked) {
      panel.innerHTML = `${head}<div class="tp-warn">${esc(blocked)}</div>
        <div class="tp-actions"><button class="cancel">ปิด</button></div>`;
      panel.querySelector('.cancel').onclick = () => closePanel(host, options);
      return panel;
    }

    const t = preview.tally || {};
    const sum = `${preview.file} · รอบ ${preview.round} · pass ${t.pass || 0} · fail ${t.fail || 0} · ข้าม ${t.skipped || 0}`;
    const warns = warningsFor(preview).map(w => `<div class="tp-warn">${esc(w)}</div>`).join('');
    const hadValue = !!(preview.testResults.value || '').trim();
    panel.innerHTML = `${head}
      <div class="tp-sum">${esc(sum)}</div>
      ${warns}
      <div class="tp-label">Test Results ที่จะบันทึก${hadValue ? ' (ของเดิมอยู่ด้านบน · ต่อท้ายด้วยรอบนี้)' : ''} · แก้ได้</div>
      <textarea class="tp-edit">${esc(preview.merged || '')}</textarea>
      <div class="tp-label">โน้ตส่งขึ้น Redmine · ไม่บังคับ</div>
      <textarea class="tp-note" placeholder="สิ่งที่เห็นระหว่างเทส / หลักฐาน — วางรูปได้เลย (Ctrl+V)"></textarea>
      <div class="tp-shots"></div>
      <div class="tp-shots-err"></div>
      <div class="tp-actions">
        <button class="confirm ${o.cls}">ยืนยัน · บันทึกผลและย้ายเป็น ${esc(o.target)}</button>
        <button class="cancel">ยกเลิก</button>
      </div>`;
    panel.querySelector('.cancel').onclick = () => closePanel(host, options);
    const uploads = wireNoteAttachments(panel);
    const confirmBtn = panel.querySelector('.confirm');
    confirmBtn.onclick = () => {
      const value = panel.querySelector('.tp-edit').value;
      const label = confirmBtn.textContent;
      confirmBtn.disabled = true; confirmBtn.classList.add('pending'); confirmBtn.textContent = 'กำลังบันทึก...';
      api().finishTest(issueId, preview.outcome, value, preview.testResults.fieldId,
        { notes: panel.querySelector('.tp-note').value, uploads: uploads.list() }).then(res => {
        if (!res || !res.ok) {
          confirmBtn.disabled = false; confirmBtn.classList.remove('pending'); confirmBtn.textContent = label;
          let err = panel.querySelector('.tp-err');
          if (!err) { err = document.createElement('div'); err.className = 'tp-err'; panel.appendChild(err); }
          err.textContent = 'บันทึกไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ');
          return;
        }
        host.innerHTML = '';
        if (options.onDone) options.onDone(res);
      });
    };
    return panel;
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.finishtest = { OUTCOMES, outcomeMeta, warningsFor, open };
})(typeof window !== 'undefined' ? window : globalThis);
