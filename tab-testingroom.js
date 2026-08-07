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
    const fails = active.filter(i => i.result === 'fail');
    // fail สามกอง: สคริปเทสเองพัง (ไม่ใช่บั๊กของระบบ) · บั๊กจริง · ยังไม่มีใครเข้าไปตรวจ
    // กองสุดท้ายอันตรายที่สุดเพราะหน้าตาเหมือน fail ธรรมดา แต่ยังไม่มีใครรู้ว่ามันคืออะไร
    const scriptFail = fails.filter(i => i.cause === 'สคริป').length;
    const unjudgedFail = fails.filter(i => i.by === 'auto' && !i.cause).length;
    return {
      total: list.length, skipped: list.length - active.length,
      active: active.length, pass, fail: fails.length, scriptFail, unjudgedFail,
      todo: active.length - pass - fails.length,
    };
  }
  // ใบเปล่า (ข้ามหมด/ไม่มีข้อ) ไม่ใช่ใบที่เสร็จ — ไม่งั้นใบที่เพิ่งสร้างแล้วยังไม่มีข้อจะขึ้นว่าเสร็จ
  function sheetDone(items) {
    const p = progressOf(items);
    return p.active > 0 && p.todo === 0;
  }
  // กดปุ่มผล — คืนไอเทมใหม่ ไม่แก้ของเดิม
  // กดซ้ำปุ่มที่เลือกอยู่ = ถอนกลับ เพราะกดพลาดแล้วต้องแก้ได้โดยไม่ต้องไปเปิดไฟล์เอง
  // วันที่ผูกกับ "ข้อนี้ได้ผลเมื่อไหร่" จึงประทับ/ล้างไปพร้อมผลเสมอ ข้อที่ไม่มีผลต้องไม่มี
  // วันที่ค้าง ไม่งั้นกวาดตาดูแล้วเหมือนเทสไปแล้ว
  function applyAction(today, item, action) {
    const it = Object.assign({}, item);
    if (action === 'ข้าม') {
      if (it.by === 'ข้าม') { it.by = 'qa'; return it; }
      // ข้ามแล้วผล/วันที่/เลข run ของเดิมไม่มีความหมายอีก ล้างทิ้งไม่ให้ค้างเป็นข้อมูลลวง
      it.by = 'ข้าม'; it.result = '–'; it.cause = ''; it.date = ''; it.run = ''; return it;
    }
    if (it.by === 'ข้าม') it.by = 'qa';   // ให้ผลกับข้อที่ข้ามอยู่ = เลิกข้ามไปในตัว
    it.result = it.result === action ? '–' : action;
    it.date = it.result === '–' ? '' : today;
    // สาเหตุเป็นคำตัดสินเกี่ยวกับ fail ครั้งนั้น พอผลเปลี่ยนเป็นอย่างอื่นมันก็ไม่มีความหมายแล้ว
    if (it.result !== 'fail') it.cause = '';
    return it;
  }
  // กดปุ่มสาเหตุ — กดซ้ำปุ่มเดิม = ถอนคำตัดสินกลับไปเป็น "ยังไม่ได้ตรวจ"
  // ใช้ได้เฉพาะข้อที่ผลเป็น fail เท่านั้น สาเหตุที่ค้างอยู่บนข้อที่ผ่านแล้วคือข้อมูลลวง
  function applyCause(item, cause) {
    const it = Object.assign({}, item);
    if (it.result !== 'fail') return it;
    it.cause = it.cause === cause ? '' : cause;
    return it;
  }
  function emptyItem() {
    return { title: '', by: 'qa', result: '–', cause: '', date: '', system: '', test: '', run: '', note: '' };
  }

  // เติมผลจากรอบรันอัตโนมัติล่าสุดของไฟล์เทสที่ข้อนี้ผูกไว้
  // res = { run, status:'PASS'|'FAIL'|'CRASH', startedAt } หรือ null ถ้าไฟล์นั้นยังไม่เคยรัน
  //
  // วันที่มาจาก "วันที่รันจริง" ไม่ใช่วันที่กดดึง — ดึงผลของรอบเมื่อวานมาวันนี้แล้วประทับวันนี้
  // เท่ากับบันทึกว่าทดสอบวันนี้ทั้งที่ไม่ได้ทดสอบ
  function applyAutoResult(item, res) {
    if (!res) return item;                       // ยังไม่เคยรัน = ไม่มีอะไรให้เติม อย่าไปล้างของเดิม
    const it = Object.assign({}, item);
    it.run = res.run || '';
    // ผลรอบใหม่มาแล้ว คำตัดสินของ QA เป็นของรอบเก่า ต้องล้าง ไม่ใช่ยกมาใช้ต่อ —
    // ไม่งั้นข้อที่เคยตรวจว่า "สคริปพัง" จะยังติดป้ายนั้นทั้งที่รอบใหม่ fail ด้วยเหตุอื่น
    it.cause = '';
    if (res.status === 'PASS' || res.status === 'FAIL') {
      it.result = res.status === 'PASS' ? 'pass' : 'fail';
      it.date = String(res.startedAt || '').slice(0, 10);
    } else {
      // CRASH — รอบล่าสุดตายกลางคัน ไม่ได้บอกว่าระบบผิดหรือถูก จะเติมเป็น fail ก็เท่ากับ
      // ปนปัญหาสภาพแวดล้อม (BlueStacks/เน็ต) เข้ากับบั๊กจริง ล้างผลให้กลับเป็นยังไม่ทดสอบ
      // แต่คงเลข run ไว้ให้กดไปดู log ได้ว่าตายตรงไหน
      it.result = '–';
      it.date = '';
    }
    return it;
  }

  // สรุปว่าการกด "ดึงผล" รอบนี้เกิดอะไรขึ้นบ้าง — ต้องบอกให้ครบ ไม่ใช่บอกแค่จำนวนที่เติมได้
  // ข้อที่ยังไม่เคยรันกับข้อที่ยังไม่ผูกไฟล์เงียบหายไปเฉย ๆ จะดูเหมือนดึงผลครบแล้ว
  function autoSummary(items, results) {
    const out = { filled: 0, crashed: 0, missing: 0, unlinked: 0 };
    for (const it of (Array.isArray(items) ? items : [])) {
      if (!it || it.by !== 'auto') continue;
      if (!it.test) { out.unlinked += 1; continue; }
      const res = results && results[it.test];
      if (!res) out.missing += 1;
      else if (res.status === 'CRASH') out.crashed += 1;
      else out.filled += 1;
    }
    return out;
  }

  // วันที่ที่ "ใบนี้เทสเสร็จ" = วันที่ของข้อที่เทสหลังสุด ไม่ใช่วันที่กดบันทึกครั้งล่าสุด
  // (ใบเดียวมักเทสข้ามหลายวัน) — ถ้าครบแต่ไม่มีวันที่เลย (ใบเก่า/แก้มือ) คืนว่าง ไม่เดาวันให้
  function doneAtFor(items) {
    if (!sheetDone(items)) return '';
    return (Array.isArray(items) ? items : [])
      .filter(i => i && i.by !== 'ข้าม')
      .map(i => String(i.date || ''))
      .filter(Boolean)
      .sort()                       // YYYY-MM-DD เรียงเป็นตัวอักษรได้ตรงกับเรียงตามเวลา
      .pop() || '';
  }

  // ---- ลำดับการรันของใบนี้ ----
  // ใบเทสเป็นใบสั่งรันอยู่แล้ว (ตัดสินใจ 2026-08-07): ข้อที่ตั้ง auto และผูกไฟล์ไว้ เรียงตาม
  // ลำดับ # คือชุดกับลำดับครบทั้งสองอย่าง ไม่ต้องมีไฟล์ที่สองที่ต้องคอยซิงก์ให้ตรงกัน

  // แหล่งที่ไฟล์นี้อยู่จริง — ใบเก่าเก็บแค่ชื่อไฟล์ ต้องค้นให้เอง
  // และไฟล์ชื่อซ้ำกันในสองแหล่งต้องบอกว่ากำกวม ไม่ใช่หยิบอันแรกที่เจอมาเดา
  function findSource(sources, item) {
    const list = Array.isArray(sources) ? sources : [];
    if (item.system) {
      const byLabel = list.find(s => s.label === item.system);
      return byLabel ? { src: byLabel }
        : { src: null, warn: `ไม่รู้จักระบบ "${item.system}" แล้ว — อาจถูกเปลี่ยนชื่อหรือลบไปจากตั้งค่า` };
    }
    const hits = list.filter(s => (s.tests || []).includes(item.test));
    if (hits.length === 1) return { src: hits[0], filled: true };
    if (hits.length > 1) return { src: null, warn: 'ไฟล์ชื่อนี้มีอยู่ในหลายระบบ — กดเลือกไฟล์ใหม่เพื่อระบุว่าใช้ตัวไหน' };
    return { src: null, warn: 'หาไฟล์นี้ในโฟลเดอร์ที่ตั้งค่าไว้ไม่เจอแล้ว' };
  }
  // คำสั่งที่ต้องไปรันเอง — .spec.js คือชุด Playwright สั่งตรงได้เลย
  // ที่เหลือคือชุดมือถือซึ่งต้องผ่าน run-test.bat: มันเป็นเมนูตัวเลข ไม่รับชื่อไฟล์เป็น argument
  // จึงสั่งจากข้างนอกไม่ได้ ต้องบอกตรง ๆ ว่าให้ไปกดเอง ไม่ใช่แต่งคำสั่งปลอมให้ก๊อป
  function commandFor(item, src) {
    if (!src) return { cwd: '', cmd: '', manual: '' };
    return /\.spec\.js$/i.test(item.test)
      ? { cwd: src.path || '', cmd: `npx playwright test ${item.test}`, manual: '' }
      : { cwd: src.path || '', cmd: '', manual: 'เปิด run-test.bat ในโฟลเดอร์นี้แล้วเลือกไฟล์นี้จากเมนู' };
  }
  // only = ไอเทมเดียวที่กด ▶ รัน รายข้อ — ยังต้องส่ง items ทั้งใบเข้ามา เพราะเลขข้อที่โชว์
  // ต้องเป็นตำแหน่งจริงในใบ (ข้อ 3 ต้องขึ้นว่า "3.") ไม่ใช่นับใหม่จาก 1 ในลิสต์ที่กรองแล้ว
  function runPlan(items, sources, only) {
    const steps = [], skipped = [];
    (Array.isArray(items) ? items : []).forEach((it, i) => {
      const n = i + 1;
      if (only && it !== only) return;
      // ข้ามข้อที่ไม่ใช่ auto หรือยังไม่ผูกไฟล์ แต่ต้องรายงานว่าข้ามข้อไหนบ้าง —
      // ชุดที่หายไปเงียบ ๆ ทำให้เข้าใจว่ารันครบแล้วทั้งที่ยังเหลือข้อที่ลืมผูกไฟล์
      if (!it || it.by !== 'auto' || !it.test) { if (!only) skipped.push(n); return; }
      const found = findSource(sources, it);
      steps.push(Object.assign({
        n, title: it.title || '', test: it.test,
        system: it.system || (found.src && found.src.label) || '',
        filled: !!found.filled, warn: found.warn || '',
      }, commandFor(it, found.src)));
    });
    return { steps, skipped };
  }

  if (typeof window === 'undefined') {
    module.exports = {
      progressOf, sheetDone, applyAction, applyCause, emptyItem, doneAtFor,
      applyAutoResult, autoSummary, runPlan,
    };
    return;
  }

  const { esc } = global.COWORK.util;
  const shell = () => global.COWORK.shell;
  let api = null;

  // วันที่เครื่อง ไม่ใช่ UTC — ต้องตรงกับวันที่ผู้ใช้เห็นบนนาฬิกาตอนกดบันทึกผล
  // รูปแบบเดียวกับ receivedAt ที่ main.js เขียนตอนสร้างใบ
  function todayStr() {
    const n = new Date(), p = x => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  }
  // 2026-08-06 → 06/08 สำหรับที่แคบ ๆ อย่างลิสต์กับการ์ด (ปีไม่ช่วยอะไรในบริบทนั้น)
  function shortDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
    return m ? `${m[3]}/${m[2]}` : String(d || '');
  }

  let sheets = [];        // ใบทั้งหมด ใหม่สุดก่อน
  let dir = '';
  let openPath = null;    // ใบที่เปิดอยู่ (path เต็ม)
  let loadError = '';
  let saveTimer = null;
  let saveState = '';     // '' | 'saving' | 'saved' | ข้อความ error
  let autoTests = null;   // [{label, path, tests:[ชื่อไฟล์]}] โหลดครั้งแรกที่ต้องใช้
  let autoMsg = '';       // ผลของการกดดึงผลครั้งล่าสุด

  function current() { return sheets.find(s => s.path === openPath) || null; }

  // ---- โหลด/บันทึก ----
  function refresh() {
    if (!api || !api.listQtests) return;
    // ต้อง flush การบันทึกที่ค้างอยู่ก่อน — refresh ทับ state ในหน่วยความจำด้วยของจากดิสก์
    // ติ๊กผลแล้วสลับ sub-tab ภายใน 500ms (debounce) จะทำให้การติ๊กนั้นหายไปเงียบ ๆ
    flushSave().then(() => api.listQtests()).then(res => {
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
  function writeNow(sheet) {
    // สถานะกับวันที่เทสเสร็จคำนวณจากข้อจริงเสมอ ไม่ให้ผู้ใช้กดปิดใบเองแล้วขัดกับผลข้างใน
    sheet.meta.status = sheetDone(sheet.items) ? 'done' : 'open';
    sheet.meta.doneAt = doneAtFor(sheet.items);
    return api.saveQtest(sheet.path, { meta: sheet.meta, items: sheet.items, notes: sheet.notes })
      .then(r => {
        saveState = (r && r.ok) ? 'saved' : ((r && r.error) || 'บันทึกไม่สำเร็จ');
        paintSaveState();
        if (r && r.ok) renderList();   // ตัวเลขความคืบหน้าบนลิสต์ต้องขยับตาม
      });
  }
  function queueSave() {
    const sheet = current();
    if (!sheet) return;
    saveState = 'saving'; paintSaveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; writeNow(sheet); }, 500);
  }
  // เขียนทันทีถ้ายังมีคิวค้าง — ใช้ก่อนทุกจังหวะที่ state ในหน่วยความจำกำลังจะถูกทับ
  function flushSave() {
    if (!saveTimer) return Promise.resolve();
    clearTimeout(saveTimer); saveTimer = null;
    const sheet = current();
    return sheet ? writeNow(sheet) : Promise.resolve();
  }
  function paintSaveState() {
    const el = document.getElementById('trSaveState');
    if (!el) return;
    el.className = 'tr-save' + (saveState && saveState !== 'saving' && saveState !== 'saved' ? ' err' : '');
    el.textContent = saveState === 'saving' ? 'กำลังบันทึก…' : saveState === 'saved' ? 'บันทึกแล้ว' : saveState;
  }

  // ---- ผูกกับชุดเทสอัตโนมัติ ----
  // โหลดรายชื่อไฟล์เทสจากดิสก์ (main เป็นคนอ่าน) ครั้งแรกที่ผู้ใช้จะเลือก แล้วคงไว้ทั้ง session
  function loadAutoTests() {
    if (autoTests) return Promise.resolve(autoTests);
    if (!api || !api.listAutoTests) return Promise.resolve([]);
    return api.listAutoTests().then(list => { autoTests = list || []; return autoTests; });
  }
  // ดึงผลรันล่าสุดมาเติมให้ข้อ auto — ส่ง testIds ไปทีเดียว ไม่ยิงทีละข้อ
  function pullAuto(sheet, only) {
    const targets = sheet.items.filter(i => i.by === 'auto' && i.test && (!only || i === only));
    if (!targets.length) {
      autoMsg = only ? 'ข้อนี้ยังไม่ได้ผูกไฟล์เทส' : 'ยังไม่มีข้อไหนตั้งเป็น auto และผูกไฟล์เทสไว้';
      renderSheet();
      return;
    }
    autoMsg = 'กำลังดึงผล…'; paintAutoMsg();
    api.latestAutoResults([...new Set(targets.map(i => i.test))]).then(results => {
      results = results || {};
      sheet.items = sheet.items.map(i => (targets.includes(i) ? applyAutoResult(i, results[i.test]) : i));
      const s = autoSummary(targets, results);
      const bits = [];
      if (s.filled) bits.push(`เติมผลแล้ว ${s.filled} ข้อ`);
      if (s.crashed) bits.push(`รันไม่จบ ${s.crashed} ข้อ (ไม่เติมผลให้ กดเลข run ดู log ได้)`);
      if (s.missing) bits.push(`ยังไม่เคยรัน ${s.missing} ข้อ`);
      autoMsg = bits.join(' · ') || 'ไม่มีอะไรเปลี่ยน';
      renderSheet();
      queueSave();
    });
  }
  // ---- ลำดับการรัน ----
  // เฟสนี้ยังไม่สั่งรันเอง — แผงบอกว่า "ถ้ารันชุดนี้จะรันอะไร ตามลำดับไหน ด้วยคำสั่งอะไร"
  // แล้ว QA เอาคำสั่งไปรันเอง · รันจริงจากในแอปคือเฟสถัดไป ต่อบนแผงนี้ได้ไม่ต้องรื้อ
  function openRunPlan(sheet, only) {
    const host = document.getElementById('trRun');
    if (!host) return;
    host.innerHTML = '<div class="testPreview">กำลังอ่านรายชื่อไฟล์เทส…</div>';
    loadAutoTests().then(sources => {
      const plan = runPlan(sheet.items, sources, only);
      // ผูกไฟล์ไว้แล้วแต่ยังไม่มีระบบ (ใบเก่า) และค้นเจอแหล่งเดียว = เติมให้เลย ไม่ต้องให้กดใหม่
      let filled = 0;
      plan.steps.forEach(s => {
        if (!s.filled) return;
        const it = sheet.items.find(x => x.test === s.test && !x.system);
        if (it) { it.system = s.system; filled += 1; }
      });
      if (filled) { renderItems(sheet); queueSave(); }
      return api.latestAutoResults([...new Set(plan.steps.map(s => s.test))])
        .then(res => paintRunPlan(host, plan, res || {}, only, filled));
    });
  }
  function lastRunText(res) {
    if (!res) return 'ยังไม่เคยรัน';
    return `รอบล่าสุด ${res.status} ${shortDate(String(res.startedAt || '').slice(0, 10))} · run ${res.run}`;
  }
  function paintRunPlan(host, plan, results, only, filled) {
    if (!plan.steps.length) {
      host.innerHTML = `<div class="testPreview finish">
        <div class="tp-head"><span class="tp-title">▶ ลำดับการรัน</span></div>
        <div class="tp-warn">${only ? 'ข้อนี้ยังไม่ได้ผูกไฟล์เทส' : 'ใบนี้ยังไม่มีข้อไหนตั้งเป็น auto และผูกไฟล์เทสไว้'}</div>
        <div class="tp-actions"><button class="cancel">ปิด</button></div></div>`;
      host.querySelector('.cancel').onclick = () => { host.innerHTML = ''; };
      return;
    }
    const bySys = {};
    plan.steps.forEach(s => { bySys[s.system || '?'] = (bySys[s.system || '?'] || 0) + 1; });
    const rows = plan.steps.map(s => {
      const last = results[s.test];
      const cls = !last ? 'none' : last.status === 'PASS' ? 'ok' : last.status === 'FAIL' ? 'no' : 'warn';
      const how = s.warn ? `<div class="rp-warn">⚠ ${esc(s.warn)}</div>`
        : s.cmd ? `<div class="rp-cmd"><code>${esc(s.cmd)}</code><span class="rp-cwd">ใน ${esc(s.cwd)}</span></div>`
          : `<div class="rp-cmd"><span class="rp-manual">${esc(s.manual)}</span><span class="rp-cwd">${esc(s.cwd)}</span></div>`;
      return `<div class="rp-step">
        <div class="rp-line"><span class="rp-n">${s.n}.</span>
          <b class="rp-sys">${esc(s.system || 'ไม่รู้ระบบ')}</b>
          <span class="rp-test">${esc(s.test)}</span>
          <span class="rp-last ${cls}">${esc(lastRunText(last))}</span></div>
        ${how}</div>`;
    }).join('');
    const sysLine = Object.entries(bySys).map(([k, v]) => `${k} ${v}`).join(' · ');
    host.innerHTML = `<div class="testPreview finish run">
      <div class="tp-head"><span class="tp-title">▶ ลำดับการรัน · ${plan.steps.length} ไฟล์</span></div>
      <div class="tp-sum">${esc(sysLine)} · รันทีละตัวตามลำดับ ห้ามขนาน (ทุกไฟล์แชร์ table/till เดียวกัน)</div>
      ${filled ? `<div class="tp-sum">เติมชื่อระบบให้ ${filled} ข้อที่ผูกไฟล์ไว้ตั้งแต่ก่อนมีคอลัมน์นี้</div>` : ''}
      <div class="rp-list">${rows}</div>
      ${plan.skipped.length ? `<div class="tp-sum">ข้ามข้อ ${plan.skipped.join(', ')} (ไม่ใช่ auto หรือยังไม่ผูกไฟล์)</div>` : ''}
      <div class="tp-warn">⚠ รันชุดนี้ = สั่งออเดอร์จริงบน dev ${plan.steps.length} ครั้ง</div>
      <div class="tp-actions">
        <button class="copy">คัดลอกคำสั่งทั้งชุด</button>
        <button class="cancel">ปิด</button>
      </div></div>`;
    host.querySelector('.cancel').onclick = () => { host.innerHTML = ''; };
    const copyBtn = host.querySelector('.copy');
    copyBtn.onclick = () => {
      // เขียนเป็นสคริปต์ที่ก๊อปไปวางใน terminal ได้ทั้งก้อน ไฟล์ที่สั่งตรงไม่ได้เป็นคอมเมนต์
      // ไม่ใช่หายไปเฉย ๆ — ไม่งั้นก๊อปไปรันแล้วนึกว่าครบทั้งที่ขาดฝั่งมือถือไป
      const text = plan.steps.map(s => s.cmd
        ? `cd "${s.cwd}"\n${s.cmd}`
        : `# ${s.n}. ${s.test} — ${s.warn || s.manual} (${s.cwd})`).join('\n\n');
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'คัดลอกแล้ว';
        setTimeout(() => { copyBtn.textContent = 'คัดลอกคำสั่งทั้งชุด'; }, 1500);
      });
    };
  }

  // ---- จบงาน: สรุปผลกลับ Redmine ----
  // แผงกับการเขียนจริงอยู่ใน finishtest.js ตัวเดียวกับปุ่ม ✅/❌ ในแท็บ Redmine
  //
  // flushSave() ก่อนเสมอ — ฝั่ง main อ่านใบเทสจากดิสก์ใหม่ตอนประกอบข้อความ ติ๊กผลข้อสุดท้าย
  // แล้วกดจบงานภายใน 500ms (ช่วง debounce) จะได้ผลสรุปที่ขาดข้อนั้นไปโดยไม่มีอะไรฟ้อง
  function openFinish(sheet, outcome) {
    const host = document.getElementById('trFinish');
    if (!host || !global.COWORK.finishtest) return;
    host.innerHTML = 'กำลังบันทึกใบเทส…';
    flushSave().then(() => {
      global.COWORK.finishtest.open(host, sheet.meta.issue, outcome, {
        onDone: res => {
          autoMsg = `ส่งผลกลับ Redmine แล้ว — #${sheet.meta.issue} ตอนนี้อยู่สถานะ ${res.status}`;
          paintAutoMsg();
        },
      });
    });
  }

  function paintAutoMsg() {
    const el = document.getElementById('trAutoMsg');
    if (el) el.textContent = autoMsg;
  }
  // เลือกไฟล์เทสให้ข้อหนึ่ง — เมนูลอยเหนือการ์ดนั้น จัดกลุ่มตาม source
  function openTestPicker(anchor, sheet, idx) {
    document.querySelectorAll('.tr-picker').forEach(p => p.remove());
    loadAutoTests().then(sources => {
      const box = document.createElement('div');
      box.className = 'tr-picker';
      box.onclick = e => e.stopPropagation();
      // เมนูจัดกลุ่มตามระบบอยู่แล้ว การเลือกไฟล์จึงเป็นการเลือกตัวรันไปในตัว — เก็บ label
      // ติดไปกับไฟล์เลย (ตัดสินใจ 2026-08-07 แบบ B) ถ้าแยกเป็นสองปุ่มจะตั้ง "Playwright"
      // คู่กับไฟล์ของมือถือได้ ซึ่งเป็นคู่ที่รันไม่ได้จริงและไม่มีอะไรฟ้อง
      const groups = sources.filter(s => s.tests && s.tests.length).map(s =>
        `<div class="tp-src">${esc(s.label)}</div>` +
        s.tests.map(t => `<button type="button" data-t="${esc(t)}" data-s="${esc(s.label)}">${esc(t)}</button>`).join('')).join('');
      box.innerHTML = (groups || `<div class="tp-src">ไม่พบไฟล์เทสในโฟลเดอร์ที่ตั้งค่าไว้</div>`)
        + `<button type="button" class="tp-clear" data-t="" data-s="">— ไม่ผูกไฟล์เทส —</button>`;
      box.querySelectorAll('button').forEach(b => b.onclick = () => {
        sheet.items[idx].test = b.dataset.t;
        sheet.items[idx].system = b.dataset.s || '';
        // ผูกไฟล์เทส = ข้อนี้ตั้งใจให้เครื่องรัน ปรับ ทำโดย ให้ตรงไปเลย ผู้ใช้จะได้ไม่ต้องกดสองที
        if (b.dataset.t && sheet.items[idx].by !== 'auto') sheet.items[idx].by = 'auto';
        box.remove(); renderItems(sheet); queueSave();
      });
      anchor.parentNode.appendChild(box);
    });
  }
  document.addEventListener('click', () => document.querySelectorAll('.tr-picker').forEach(p => p.remove()));

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
      const at = doneAtFor(s.items);
      // เห็นวันที่เทสเสร็จตั้งแต่หน้าลิสต์ ไม่ต้องเปิดใบทีละใบเพื่อหาว่าอันไหนเสร็จเมื่อไหร่
      const stat = sheetDone(s.items) ? `<span class="tr-done">เสร็จ${at ? ' ' + esc(shortDate(at)) : ''}</span>`
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
    const m = sheet.meta, p = progressOf(sheet.items), at = doneAtFor(sheet.items);
    el.innerHTML = `
      <button class="mt-back" id="trBack">← ใบเทสทั้งหมด</button>
      <div class="tr-head">
        <div class="tr-head-top">
          <span class="tr-id">#${esc(String(m.issue || '?'))}</span>
          <span class="tr-meta">รอบ ${esc(String(m.round || 1))} · ${esc(m.tracker || '–')} · ${esc(m.project || '–')}</span>
          <span class="tr-save" id="trSaveState"></span>
        </div>
        <div class="tr-subject">${esc(m.subject || '(ไม่มีหัวเรื่อง)')}</div>
        <div class="tr-sub">รับเข้า ${esc(m.receivedAt || '–')}<span id="trDoneAt">${doneAtHtml(at)}</span> · ${esc(sheet.file)}${m.model ? ' · ' + esc(m.model) : ''}</div>
        <div class="tr-tally">
          <span class="tr-counts">${tallyHtml(p)}</span>
          <button type="button" class="tr-runall" id="trRunAll">▶ Run all</button>
          <button type="button" class="tr-pull-all" id="trPullAll">⤓ ดึงผล auto ทั้งใบ</button>
          <button type="button" class="tr-finish ok" id="trFinishOk">✅ จบงาน · ผ่าน</button>
          <button type="button" class="tr-finish no" id="trFinishNo">❌ จบงาน · ไม่ผ่าน</button>
        </div>
        <div class="tr-automsg" id="trAutoMsg">${esc(autoMsg)}</div>
      </div>
      <div id="trRun"></div>
      <div id="trFinish"></div>
      <div id="trItems"></div>
      <button class="tr-add" id="trAdd">+ เพิ่มข้อทดสอบ</button>
      <div class="row-label" style="margin-top:14px">บันทึกเพิ่มเติม</div>
      <textarea id="trNotes" class="tr-notes" placeholder="จดอะไรก็ได้เกี่ยวกับการเทสรอบนี้…">${esc(sheet.notes || '')}</textarea>`;
    document.getElementById('trBack').onclick = () => { openPath = null; autoMsg = ''; render(); };
    document.getElementById('trRunAll').onclick = () => openRunPlan(sheet, null);
    document.getElementById('trPullAll').onclick = () => pullAuto(sheet, null);
    document.getElementById('trFinishOk').onclick = () => openFinish(sheet, 'success');
    document.getElementById('trFinishNo').onclick = () => openFinish(sheet, 'fail');
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
      // เลข run กดได้ — พาไปเปิด log ของรอบนั้นในแท็บผลรันเลย ไม่ต้องไปไล่หาเองในลิสต์
      const runTag = it.by === 'auto' && it.run
        ? `<button type="button" class="tr-run" data-i="${i}" title="ดู log ของรอบนี้">${esc(it.run)} ↗</button>` : '';
      // วันที่โผล่เฉพาะข้อที่มีผลแล้ว — ข้อที่ยังไม่เทสต้องไม่มีอะไรให้เข้าใจผิดว่าเทสแล้ว
      const dateTag = it.date
        ? `<span class="tr-date" title="ทดสอบเมื่อ ${esc(it.date)}">${esc(shortDate(it.date))}</span>` : '';
      // ป้ายระบบข้าง auto — กวาดตาดูทั้งใบแล้วรู้ทันทีว่าข้อไหนรันด้วยอะไร ไม่ต้องอ่านชื่อไฟล์
      const sysTag = it.by === 'auto' && it.system
        ? `<span class="tr-sys" title="รันด้วย ${esc(it.system)}">${esc(it.system)}</span>` : '';
      // ปุ่มสาเหตุโผล่เฉพาะข้อ auto ที่ fail — ข้อที่ QA ทดสอบเองแล้วไม่ผ่านไม่มีคำถามว่า
      // "สคริปพังหรือระบบพัง" อยู่แล้ว ส่วนข้อที่ผ่านแล้วไม่มีอะไรให้ตรวจ
      const causeRow = (it.by === 'auto' && it.result === 'fail') ? `<div class="tr-cause">
        <span class="tr-cause-q">ตรวจแล้วเป็นที่</span>
        <button type="button" class="tr-cz app${it.cause === 'แอป' ? ' on' : ''}" data-i="${i}" data-c="แอป">บั๊กระบบ</button>
        <button type="button" class="tr-cz script${it.cause === 'สคริป' ? ' on' : ''}" data-i="${i}" data-c="สคริป">สคริปเทส</button>
        ${it.cause ? '' : '<span class="tr-cause-todo">ยังไม่ได้ตรวจ</span>'}
      </div>` : '';
      return `<div class="tr-item ${state}${it.cause === 'สคริป' ? ' script' : ''}">
        <div class="tr-item-top">
          <span class="tr-n">${i + 1}</span>
          <input class="tr-title" data-i="${i}" value="${esc(it.title)}" placeholder="สิ่งที่ต้องทดสอบ…">
          <button class="tr-del" data-i="${i}" title="ลบข้อนี้">✕</button>
        </div>
        <div class="tr-item-actions">
          ${btns}${dateTag}${runTag}${sysTag}
          <button class="tr-by" data-i="${i}" title="สลับ ทดสอบเอง ↔ ใช้ผลจากชุดเทสอัตโนมัติ">${esc(it.by === 'ข้าม' ? 'qa' : it.by)}</button>
        </div>
        ${causeRow}
        ${it.by === 'auto' ? `<div class="tr-link">
          <button type="button" class="tr-pick${it.test ? ' on' : ''}" data-i="${i}">${it.test ? '⛓ ' + (it.system ? '<b>' + esc(it.system) + '</b> · ' : '') + esc(it.test) : '⛓ ยังไม่ได้ผูกไฟล์เทส'}</button>
          ${it.test ? `<button type="button" class="tr-run1" data-i="${i}">▶ รัน</button>
          <button type="button" class="tr-pull" data-i="${i}">⤓ ดึงผลล่าสุด</button>` : ''}
        </div>` : ''}
        <input class="tr-note" data-i="${i}" value="${esc(it.note)}" placeholder="หมายเหตุ…">
      </div>`;
    }).join('');
    if (!sheet.items.length) el.innerHTML = '<div class="empty">ใบนี้ยังไม่มีข้อทดสอบ — กดปุ่มข้างล่างเพื่อเพิ่ม</div>';

    el.querySelectorAll('.tr-act').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.i);
      sheet.items[i] = applyAction(todayStr(), sheet.items[i], b.dataset.a);
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
    el.querySelectorAll('.tr-pick').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      openTestPicker(b, sheet, Number(b.dataset.i));
    });
    el.querySelectorAll('.tr-cz').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.i);
      sheet.items[i] = applyCause(sheet.items[i], b.dataset.c);
      renderItems(sheet); repaintTally(sheet); queueSave();
    });
    el.querySelectorAll('.tr-run1').forEach(b => b.onclick = () => openRunPlan(sheet, sheet.items[Number(b.dataset.i)]));
    el.querySelectorAll('.tr-pull').forEach(b => b.onclick = () => pullAuto(sheet, sheet.items[Number(b.dataset.i)]));
    el.querySelectorAll('.tr-run').forEach(b => b.onclick = () => {
      const run = sheet.items[Number(b.dataset.i)].run;
      showSub('runs');
      const qa = global.COWORK.tabs.qatest;
      // รอบที่อ้างถึงอาจถูกลบไปแล้ว (ล้างโฟลเดอร์ results) — บอกตรง ๆ ดีกว่าพาไปหน้าว่าง
      if (!(qa && qa.openRunById && qa.openRunById(run))) {
        autoMsg = `ไม่พบรอบรัน ${run} ในผลรันที่โหลดอยู่ — อาจถูกลบไปแล้ว หรือกด ↻ ที่แท็บผลรันก่อน`;
        showSub('tr'); renderSheet();
      }
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
  function doneAtHtml(at) { return at ? ` · <b class="tr-doneat">เทสเสร็จ ${esc(at)}</b>` : ''; }
  // fail ที่ตรวจแล้วว่าเป็นสคริปเทสเองพัง ต้องแยกให้เห็นตั้งแต่แถบสรุป ไม่งั้นใบที่ระบบไม่มีบั๊กเลย
  // จะดูเหมือนมีบั๊ก · fail ที่ยังไม่มีใครตรวจก็ต้องทวงตรงนี้ เพราะมันคือคิวงานที่ค้างอยู่จริง
  function tallyHtml(p) {
    return `<span class="ok">pass ${p.pass}</span><span class="no">fail ${p.fail}</span>`
      + (p.scriptFail ? `<span class="sc">สคริปพัง ${p.scriptFail}</span>` : '')
      + (p.unjudgedFail ? `<span class="uj">รอตรวจ ${p.unjudgedFail}</span>` : '')
      + `<span>ค้าง ${p.todo}</span><span class="sk">ข้าม ${p.skipped}</span>`;
  }
  // อัปเดตแถบสรุปโดยไม่วาดทั้งใบใหม่ — วาดใหม่จะทำให้ข้อความที่พิมพ์ค้างในช่องหมายเหตุเสีย focus
  // ต้องอัปเดต "เทสเสร็จ" ด้วย ไม่ใช่แค่ตัวเลข: ติ๊กข้อสุดท้ายแล้วบรรทัดนั้นต้องโผล่ทันที
  // เขียนทับเฉพาะ .tr-counts ไม่ใช่ทั้ง .tr-tally — ปุ่มดึงผล/จบงานอยู่ในแถวเดียวกัน
  // เขียนทับทั้งแถวจะลบปุ่มทิ้งทุกครั้งที่ติ๊กผล (บั๊กเดิมของปุ่ม ⤓ ดึงผล ตั้งแต่เฟส 3)
  function repaintTally(sheet) {
    const el = document.querySelector('#trSheet .tr-tally .tr-counts');
    if (!el) return;
    el.innerHTML = tallyHtml(progressOf(sheet.items));
    const at = document.getElementById('trDoneAt');
    if (at) at.innerHTML = doneAtHtml(doneAtFor(sheet.items));
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
