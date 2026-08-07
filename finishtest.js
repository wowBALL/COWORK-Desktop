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
    if (preview && preview.outcome === 'success' && t.fail) {
      out.push(`ใบนี้มี ${t.fail} ข้อที่ผลเป็น fail แต่กำลังจะสรุปว่าผ่าน`);
    }
    if (preview && preview.status && preview.status !== 'Test') {
      out.push(`ตอนนี้งานอยู่สถานะ ${preview.status} ไม่ใช่ Test แล้ว`);
    }
    return out;
  }

  if (typeof window === 'undefined') {
    module.exports = { OUTCOMES, outcomeMeta, warningsFor };
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
      <div class="tp-actions">
        <button class="confirm ${o.cls}">ยืนยัน · บันทึกผลและย้ายเป็น ${esc(o.target)}</button>
        <button class="cancel">ยกเลิก</button>
      </div>`;
    panel.querySelector('.cancel').onclick = () => closePanel(host, options);
    const confirmBtn = panel.querySelector('.confirm');
    confirmBtn.onclick = () => {
      const value = panel.querySelector('.tp-edit').value;
      const label = confirmBtn.textContent;
      confirmBtn.disabled = true; confirmBtn.classList.add('pending'); confirmBtn.textContent = 'กำลังบันทึก...';
      api().finishTest(issueId, preview.outcome, value, preview.testResults.fieldId).then(res => {
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
