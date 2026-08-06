// Testing Room — sub-tab ของหน้า QA test ที่ QA ใช้ทำงานจริง
//
// ใบเทส (.md) เป็น source of truth ตัวเดียว โมดูลนี้อ่านมาทั้งใบ แก้ในหน่วยความจำ แล้วเขียน
// ทับทั้งใบผ่าน save-qtest — ตัว parse/serialize อยู่ที่ testingroom.js ฝั่ง main
//
// pull-based เหมือน Grafana ไม่ใช่ push เหมือน Redmine/QA test: ใบเปลี่ยนเพราะผู้ใช้กดเอง
// การให้ main ยิงมาทับเป็นระยะจะเขียนทับสิ่งที่กำลังแก้ค้างบนจอ
//
// ลงทะเบียนด้วย key:'qa' เหมือน tab-qatest.js ตั้งใจ — showTab วนเรียก onShow ของทุกโมดูล
// ที่ key ตรง จึงได้ hook ตอนเปิดแท็บ QA test โดยไม่ต้องไปแก้ tab-qatest.js ที่ใหญ่อยู่แล้ว
(function (global) {
  'use strict';

  // ---- ฟังก์ชันบริสุทธิ์ (ท้ายไฟล์ export ให้ node --test) ----

  // ข้อที่ "ข้าม" ไม่นับเป็นงานค้าง ไม่งั้นใบที่ตัดสินใจข้ามครบแล้วจะไม่มีวันเสร็จ
  function progressOf(items) {
    const list = Array.isArray(items) ? items : [];
    const active = list.filter(i => i && i.by !== 'ข้าม');
    const pass = active.filter(i => i.result === 'pass').length;
    const fail = active.filter(i => i.result === 'fail').length;
    return {
      total: list.length, skipped: list.length - active.length,
      active: active.length, pass, fail, todo: active.length - pass - fail,
    };
  }
  // ใบเปล่า (ข้ามหมด/ไม่มีข้อ) ไม่ใช่ใบที่เสร็จ — ไม่งั้นใบที่เพิ่งสร้างแล้วยังไม่มีข้อจะขึ้นว่าเสร็จ
  function sheetDone(items) {
    const p = progressOf(items);
    return p.active > 0 && p.todo === 0;
  }
  // กดปุ่มผล — คืนไอเทมใหม่ ไม่แก้ของเดิม
  // กดซ้ำปุ่มที่เลือกอยู่ = ถอนกลับ เพราะกดพลาดแล้วต้องแก้ได้โดยไม่ต้องไปเปิดไฟล์เอง
  function applyAction(item, action) {
    const it = Object.assign({}, item);
    if (action === 'ข้าม') {
      if (it.by === 'ข้าม') { it.by = 'qa'; return it; }
      // ข้ามแล้วผล/เลข run ของเดิมไม่มีความหมายอีก ล้างทิ้งไม่ให้ค้างเป็นข้อมูลลวง
      it.by = 'ข้าม'; it.result = '–'; it.run = ''; return it;
    }
    if (it.by === 'ข้าม') it.by = 'qa';   // ให้ผลกับข้อที่ข้ามอยู่ = เลิกข้ามไปในตัว
    it.result = it.result === action ? '–' : action;
    return it;
  }
  function emptyItem() { return { title: '', by: 'qa', result: '–', run: '', note: '' }; }

  if (typeof window === 'undefined') {
    module.exports = { progressOf, sheetDone, applyAction, emptyItem };
    return;
  }

  const { esc } = global.COWORK.util;
  const shell = () => global.COWORK.shell;
  let api = null;

  let sheets = [];        // ใบทั้งหมด ใหม่สุดก่อน
  let dir = '';
  let openPath = null;    // ใบที่เปิดอยู่ (path เต็ม)
  let loadError = '';
  let saveTimer = null;
  let saveState = '';     // '' | 'saving' | 'saved' | ข้อความ error

  function current() { return sheets.find(s => s.path === openPath) || null; }

  // ---- โหลด/บันทึก ----
  function refresh() {
    if (!api || !api.listQtests) return;
    api.listQtests().then(res => {
      dir = (res && res.dir) || '';
      sheets = (res && res.sheets) || [];
      loadError = '';
      // ใบที่เปิดค้างไว้อาจถูกลบ/ย้ายไปแล้ว — เด้งกลับลิสต์แทนที่จะโชว์ใบร้าง
      if (openPath && !sheets.some(s => s.path === openPath)) openPath = null;
      render();
    }).catch(e => { loadError = e.message; render(); });
  }
  // debounce เพราะการพิมพ์ในช่องหัวข้อ/หมายเหตุยิงทุกตัวอักษร — เขียนไฟล์ทุกคีย์ไม่ไหว
  // แต่ก็ไม่ให้มีปุ่ม "บันทึก" เพราะงาน QA คือติ๊กไปเรื่อย ๆ ปุ่มที่ต้องกดจำจะกลายเป็นงานที่ลืม
  function queueSave() {
    const sheet = current();
    if (!sheet) return;
    saveState = 'saving'; paintSaveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // สถานะใบคำนวณจากข้อจริงเสมอ ไม่ให้ผู้ใช้กดปิดใบเองแล้วขัดกับผลข้างใน
      sheet.meta.status = sheetDone(sheet.items) ? 'done' : 'open';
      api.saveQtest(sheet.path, { meta: sheet.meta, items: sheet.items, notes: sheet.notes })
        .then(r => {
          saveState = (r && r.ok) ? 'saved' : ((r && r.error) || 'บันทึกไม่สำเร็จ');
          paintSaveState();
          if (r && r.ok) renderList();   // ตัวเลขความคืบหน้าบนลิสต์ต้องขยับตาม
        });
    }, 500);
  }
  function paintSaveState() {
    const el = document.getElementById('trSaveState');
    if (!el) return;
    el.className = 'tr-save' + (saveState && saveState !== 'saving' && saveState !== 'saved' ? ' err' : '');
    el.textContent = saveState === 'saving' ? 'กำลังบันทึก…' : saveState === 'saved' ? 'บันทึกแล้ว' : saveState;
  }

  // ---- วาดลิสต์ใบ ----
  function render() { renderList(); renderSheet(); }

  function renderList() {
    const el = document.getElementById('trList');
    if (!el) return;
    document.getElementById('trDirHint').textContent = dir ? '· ' + dir : '';
    if (loadError) { el.innerHTML = `<div class="hint">โหลดใบเทสไม่สำเร็จ: ${esc(loadError)}</div>`; return; }
    if (!sheets.length) {
      el.innerHTML = `<div class="empty">ยังไม่มีใบเทส — กดปุ่ม 🧪 ที่งานสถานะ Test ในแท็บ Redmine เพื่อเปิดใบแรก</div>`;
      return;
    }
    // จัดกลุ่มตามเลข issue: กลุ่มเรียงตามใบใหม่สุดของกลุ่ม ในกลุ่มเรียงรอบล่าสุดก่อน
    // รอบเก่าของ issue เดิมเยื้องเข้าและจางลง เพื่อให้เห็นว่าเป็นงานเดียวกันที่เทสมาหลายรอบ
    const groups = [];
    for (const s of sheets) {
      const key = String(s.meta.issue);
      const g = groups.find(x => x.key === key);
      if (g) g.rows.push(s); else groups.push({ key, rows: [s] });
    }
    el.innerHTML = groups.map(g => g.rows.map((s, i) => {
      const p = progressOf(s.items);
      const done = sheetDone(s.items);
      const stat = done ? `<span class="tr-done">เสร็จ</span>`
        : `<span class="tr-prog">${p.pass + p.fail}/${p.active}</span>`;
      const fail = p.fail ? `<span class="tr-fail">fail ${p.fail}</span>` : '';
      return `<div class="tr-row${i ? ' older' : ''}${s.path === openPath ? ' sel' : ''}" data-p="${esc(s.path)}">
        <span class="tr-id">#${esc(String(s.meta.issue || '?'))}</span>
        <span class="tr-subj">${esc(s.meta.subject || '(ไม่มีหัวเรื่อง)')}</span>
        ${fail}${stat}
        <span class="tr-round">รอบ ${esc(String(s.meta.round || 1))}</span>
      </div>`;
    }).join('')).join('');
    el.querySelectorAll('.tr-row').forEach(row => row.onclick = () => {
      openPath = row.dataset.p; saveState = ''; render();
      document.querySelector('.body').scrollTop = 0;
    });
  }

  // ---- วาดใบที่เปิดอยู่ ----
  function renderSheet() {
    const el = document.getElementById('trSheet');
    const list = document.getElementById('trList');
    if (!el) return;
    const sheet = current();
    if (!sheet) { el.classList.add('hidden'); list.classList.remove('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden'); list.classList.add('hidden');
    const m = sheet.meta, p = progressOf(sheet.items);
    el.innerHTML = `
      <button class="mt-back" id="trBack">← ใบเทสทั้งหมด</button>
      <div class="tr-head">
        <div class="tr-head-top">
          <span class="tr-id">#${esc(String(m.issue || '?'))}</span>
          <span class="tr-meta">รอบ ${esc(String(m.round || 1))} · ${esc(m.tracker || '–')} · ${esc(m.project || '–')}</span>
          <span class="tr-save" id="trSaveState"></span>
        </div>
        <div class="tr-subject">${esc(m.subject || '(ไม่มีหัวเรื่อง)')}</div>
        <div class="tr-sub">รับเข้า ${esc(m.receivedAt || '–')} · ${esc(sheet.file)}${m.model ? ' · ' + esc(m.model) : ''}</div>
        <div class="tr-tally">
          <span class="ok">pass ${p.pass}</span><span class="no">fail ${p.fail}</span>
          <span>ค้าง ${p.todo}</span><span class="sk">ข้าม ${p.skipped}</span>
        </div>
      </div>
      <div id="trItems"></div>
      <button class="tr-add" id="trAdd">+ เพิ่มข้อทดสอบ</button>
      <div class="row-label" style="margin-top:14px">บันทึกเพิ่มเติม</div>
      <textarea id="trNotes" class="tr-notes" placeholder="จดอะไรก็ได้เกี่ยวกับการเทสรอบนี้…">${esc(sheet.notes || '')}</textarea>`;
    document.getElementById('trBack').onclick = () => { openPath = null; render(); };
    document.getElementById('trAdd').onclick = () => {
      sheet.items.push(emptyItem());
      renderSheet();
      const inputs = document.querySelectorAll('#trItems .tr-title');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
      queueSave();
    };
    const notes = document.getElementById('trNotes');
    notes.oninput = () => { sheet.notes = notes.value; queueSave(); };
    renderItems(sheet);
    paintSaveState();
  }

  const ACTIONS = [['pass', 'pass'], ['fail', 'fail'], ['ข้าม', 'ข้าม']];
  function renderItems(sheet) {
    const el = document.getElementById('trItems');
    el.innerHTML = sheet.items.map((it, i) => {
      const state = it.by === 'ข้าม' ? 'skip' : it.result === 'pass' ? 'pass' : it.result === 'fail' ? 'fail' : 'todo';
      const btns = ACTIONS.map(([key, label]) => {
        const on = key === 'ข้าม' ? it.by === 'ข้าม' : (it.by !== 'ข้าม' && it.result === key);
        return `<button class="tr-act ${key === 'ข้าม' ? 'skip' : key}${on ? ' on' : ''}" data-i="${i}" data-a="${key}">${label}</button>`;
      }).join('');
      // เลข run โผล่เฉพาะข้อที่ตั้งเป็น auto — เฟส 3 จะเป็นตัวโยงกลับไปหา log ในแท็บผลรัน
      const runTag = it.by === 'auto' && it.run
        ? `<span class="tr-run" title="เลขโฟลเดอร์ผลรัน">${esc(it.run)}</span>` : '';
      return `<div class="tr-item ${state}">
        <div class="tr-item-top">
          <span class="tr-n">${i + 1}</span>
          <input class="tr-title" data-i="${i}" value="${esc(it.title)}" placeholder="สิ่งที่ต้องทดสอบ…">
          <button class="tr-del" data-i="${i}" title="ลบข้อนี้">✕</button>
        </div>
        <div class="tr-item-actions">
          ${btns}${runTag}
          <button class="tr-by" data-i="${i}" title="สลับ ทดสอบเอง ↔ ใช้ผลจากชุดเทสอัตโนมัติ">${esc(it.by === 'ข้าม' ? 'qa' : it.by)}</button>
        </div>
        <input class="tr-note" data-i="${i}" value="${esc(it.note)}" placeholder="หมายเหตุ…">
      </div>`;
    }).join('');
    if (!sheet.items.length) el.innerHTML = '<div class="empty">ใบนี้ยังไม่มีข้อทดสอบ — กดปุ่มข้างล่างเพื่อเพิ่ม</div>';

    el.querySelectorAll('.tr-act').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.i);
      sheet.items[i] = applyAction(sheet.items[i], b.dataset.a);
      renderItems(sheet); repaintTally(sheet); queueSave();
    });
    el.querySelectorAll('.tr-by').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.i);
      const it = sheet.items[i];
      // ข้อที่ข้ามอยู่ไม่มีคำว่า qa/auto — กดแล้วให้กลับมาเป็นข้อปกติก่อน
      it.by = it.by === 'auto' ? 'qa' : 'auto';
      if (it.by === 'qa') it.run = '';
      renderItems(sheet); repaintTally(sheet); queueSave();
    });
    el.querySelectorAll('.tr-del').forEach(b => b.onclick = () => {
      sheet.items.splice(Number(b.dataset.i), 1);
      renderItems(sheet); repaintTally(sheet); queueSave();
    });
    // พิมพ์แล้วอัปเดตเฉพาะข้อมูล ไม่วาดใหม่ ไม่งั้น cursor เด้งออกจากช่องทุกตัวอักษร
    el.querySelectorAll('.tr-title').forEach(inp => inp.oninput = () => {
      sheet.items[Number(inp.dataset.i)].title = inp.value; queueSave();
    });
    el.querySelectorAll('.tr-note').forEach(inp => inp.oninput = () => {
      sheet.items[Number(inp.dataset.i)].note = inp.value; queueSave();
    });
  }
  // อัปเดตแถบสรุปโดยไม่วาดทั้งใบใหม่ — วาดใหม่จะทำให้ข้อความที่พิมพ์ค้างในช่องหมายเหตุเสีย focus
  function repaintTally(sheet) {
    const el = document.querySelector('#trSheet .tr-tally');
    if (!el) return;
    const p = progressOf(sheet.items);
    el.innerHTML = `<span class="ok">pass ${p.pass}</span><span class="no">fail ${p.fail}</span>`
      + `<span>ค้าง ${p.todo}</span><span class="sk">ข้าม ${p.skipped}</span>`;
  }

  // ---- sub-tab ----
  function showSub(which) {
    const tr = which === 'tr';
    document.getElementById('trView').classList.toggle('hidden', !tr);
    document.getElementById('qaRunsView').classList.toggle('hidden', tr);
    document.getElementById('qaSubTr').classList.toggle('on', tr);
    document.getElementById('qaSubRuns').classList.toggle('on', !tr);
    try { localStorage.setItem('cowork.qaSubTab', which); } catch {}
    if (tr) refresh();
  }
  function activeSub() {
    try { return localStorage.getItem('cowork.qaSubTab') || 'tr'; } catch { return 'tr'; }
  }

  function mount() {
    api = shell().api;
    document.getElementById('qaSubTr').onclick = () => showSub('tr');
    document.getElementById('qaSubRuns').onclick = () => showSub('runs');
    // ↻ บนแถบเป็นของแท็บ QA test (tab-qatest.js ผูก onclick ไว้แล้ว) — เกาะเพิ่มด้วย
    // addEventListener เพื่อไม่ทับของเดิม แล้วค่อยเช็คเองว่าตอนนี้อยู่ sub-tab ไหน
    const btn = document.getElementById('qaRefresh');
    if (btn) btn.addEventListener('click', () => { if (activeSub() === 'tr') refresh(); });
    showSub(activeSub());
  }
  function onShow() { if (activeSub() === 'tr') refresh(); }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.tabs.testingroom = { key: 'qa', mount, onShow };
})(typeof window !== 'undefined' ? window : globalThis);
