// แท็บ QA test — รายการรันเทส + หน้าอ่านรัน (log / วิวเวอร์ UI hierarchy / XML ดิบ)
//
// payload = { runs:[{id,dir,sourceLabel,name,status,startedAt,endedAt,log,hasXml}], sources:[label,...], error }
// failure.xml ไม่เคยอยู่ใน payload (ใหญ่ได้หลายสิบ KB) — โหลดตอนกดดูแล้ว cache ไว้
//
// เป็นแท็บเดียวที่มี onTheme เพราะวิวเวอร์อยู่ใน iframe คนละ document (ดูคอมเมนต์ตรง onTheme)
// CSS อยู่ใน tab-qatest.css
(function (global) {
  'use strict';
  const {esc, hashN} = global.COWORK.util;
  const {dateMatch, dateFilterHtml, wireDateFilter} = global.COWORK.dateFilter;
  const shell = () => global.COWORK.shell;   // เปลือกสร้างทีหลังไฟล์นี้ ต้องหยิบตอนเรียกใช้

  let qaData=null, qaFilter='all', qaSrcFilter=null, qaOpen=null, qaXmlCache=new Map();
  const qaDateSel={y:null,m:null,d:null};
  let qaTab='log';                 // log = ข้อความ log, ui = วิวเวอร์ failure.xml, xml = XML ดิบ

  // ===== ฟอร์มสร้าง issue =====
  let qiMeta = null;          // ผลจาก getIssueFormMeta ล่าสุด: {trackerId, priorityOptions, customFields}
  let qiMembers = [];         // ผลจาก getProjectMembers ล่าสุด
  let qiUploads = [];         // [{token, filename, content_type}] ทีละไฟล์ที่ upload สำเร็จแล้ว
  // รายชื่อโปรเจกต์จริงมาจาก payload ของแท็บ Redmine (tasks-update) ไม่ใช่ qaData ของแท็บนี้ —
  // onTasks รับ listener ได้หลายตัวพร้อมกัน (ipcRenderer.on ปกติของ Electron) แท็บนี้เลยแค่ดัก
  // ฟังเอง โดยไม่ต้องแตะ tab-redmine.js เลย ทุก issue มี projectId+project (ชื่อ) ติดมาอยู่แล้ว
  let qiKnownProjects = new Map();  // projectId -> projectName

  function qiOpenForm() {
    document.getElementById('qaStage').classList.add('hidden');
    document.getElementById('qaIssueForm').classList.remove('hidden');
    document.getElementById('qiProject').innerHTML =
      [...qiKnownProjects.entries()].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    qiLoadMetaForSelection();
  }
  function qiCloseForm() {
    document.getElementById('qaIssueForm').classList.add('hidden');
    document.getElementById('qaStage').classList.remove('hidden');
    qiUploads = [];
    document.getElementById('qiFileList').innerHTML = '';
    document.getElementById('qiFiles').value = '';
    document.getElementById('qiRawNotes').value = '';
    document.getElementById('qiSubject').value = '';
    document.getElementById('qiDescription').value = '';
    document.getElementById('qiRiskLevel').value = '';
    document.getElementById('qiDraftStatus').className = 'set-status';
    document.getElementById('qiDraftStatus').textContent = '';
    document.getElementById('qiFormError').style.display = 'none';
    document.getElementById('qiAssignee').innerHTML = '<option value="">(ไม่ระบุ)</option>';
    document.getElementById('qiPriority').innerHTML = '';
    document.getElementById('qiCustomFields').innerHTML = '';
    document.getElementById('qiReviewError').style.display = 'none';
    document.querySelectorAll('.qi-field-error').forEach(el => el.classList.remove('qi-field-error'));
    qiMeta = null;
    qiMembers = [];
  }

  function qiLoadMetaForSelection() {
    const api = shell().api;
    const projectId = document.getElementById('qiProject').value;
    const trackerName = document.getElementById('qiTracker').value;
    if (!projectId) return;
    const errEl = document.getElementById('qiFormError');
    api.getIssueFormMeta(projectId, trackerName).then(res => {
      if (!res || !res.ok) { qiMeta = null; return; }
      qiMeta = res;
      document.getElementById('qiPriority').innerHTML =
        res.priorityOptions.map(p => `<option${p === 'Normal' ? ' selected' : ''}>${esc(p)}</option>`).join('');
      const extra = res.customFields.filter(f => f.name !== 'Risk Level');
      document.getElementById('qiCustomFields').innerHTML = extra.map(f => `
        <div class="row-label">${esc(f.name)}</div>
        <textarea class="search qi-cf" data-field-id="${f.id}" rows="3"></textarea>`).join('');
    }).catch(e => {
      errEl.style.display = 'block';
      errEl.textContent = 'โหลดข้อมูลฟอร์มไม่สำเร็จ: ' + e.message;
    });
    api.getProjectMembers(projectId).then(res => {
      qiMembers = (res && res.ok) ? res.members : [];
      document.getElementById('qiAssignee').innerHTML = '<option value="">(ไม่ระบุ)</option>' +
        qiMembers.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    }).catch(e => {
      errEl.style.display = 'block';
      errEl.textContent = 'โหลดรายชื่อสมาชิกไม่สำเร็จ: ' + e.message;
    });
  }

  function qiDraft() {
    const api = shell().api;
    const status = document.getElementById('qiDraftStatus');
    const rawNotes = document.getElementById('qiRawNotes').value.trim();
    if (!rawNotes) { status.className = 'set-status err'; status.textContent = 'พิมพ์โน้ตดิบก่อน'; return; }
    const btn = document.getElementById('qiDraftBtn');
    btn.disabled = true;
    status.className = 'set-status';
    status.innerHTML = 'กำลังร่าง... <button type="button" id="qiSkipDraft">ข้ามไปกรอกเองเลย</button>';
    let skipped = false;
    document.getElementById('qiSkipDraft').onclick = () => { skipped = true; btn.disabled = false; status.textContent = ''; };
    api.draftIssueText(rawNotes, {
      model: document.getElementById('qiModel').value,
      language: document.getElementById('qiLanguage').value,
      tracker: document.getElementById('qiTracker').value,
    }).then(result => {
      btn.disabled = false;
      if (skipped) return;
      if (!result || !result.ok) {
        status.className = 'set-status err';
        status.textContent = (result && result.error) || 'ร่างไม่สำเร็จ — กรอกมือแทน';
        return;
      }
      status.className = 'set-status ok'; status.textContent = 'ร่างสำเร็จ — แก้ต่อได้ก่อนส่ง';
      const d = result.draft;
      document.getElementById('qiSubject').value = d.subject || '';
      document.getElementById('qiDescription').value = d.description || '';
      if (d.suggested_risk_level) document.getElementById('qiRiskLevel').value = d.suggested_risk_level;
    }).catch(e => {
      btn.disabled = false;
      if (skipped) return;
      status.className = 'set-status err';
      status.textContent = 'เกิดข้อผิดพลาด: ' + e.message;
    });
  }

  function qiCollectForm() {
    const customFieldValues = {};
    document.querySelectorAll('#qiCustomFields .qi-cf').forEach(el => {
      customFieldValues[el.dataset.fieldId] = el.value.trim();
    });
    const projectSel = document.getElementById('qiProject');
    return {
      projectId: projectSel.value,
      projectName: projectSel.selectedOptions[0] ? projectSel.selectedOptions[0].textContent : '',
      trackerName: document.getElementById('qiTracker').value,
      subject: document.getElementById('qiSubject').value.trim(),
      description: document.getElementById('qiDescription').value.trim(),
      priorityName: document.getElementById('qiPriority').value,
      assigneeId: document.getElementById('qiAssignee').value ? Number(document.getElementById('qiAssignee').value) : null,
      riskLevel: document.getElementById('qiRiskLevel').value,
      customFieldValues,
      uploads: qiUploads,
    };
  }
  function qiShowReview() {
    document.querySelectorAll('.qi-field-error').forEach(el => el.classList.remove('qi-field-error'));
    const errEl = document.getElementById('qiFormError');
    const form = qiCollectForm();
    if (!form.projectId || !form.subject || !form.description) {
      errEl.style.display = 'block'; errEl.textContent = 'กรอกโปรเจกต์ / หัวข้อ / รายละเอียดให้ครบก่อน';
      return;
    }
    errEl.style.display = 'none';
    document.getElementById('qaIssueForm').classList.add('hidden');
    document.getElementById('qaIssueReview').classList.remove('hidden');
    const lines = buildReviewLines(form, { ...(qiMeta || {}), members: qiMembers, customFields: (qiMeta && qiMeta.customFields) || [] });
    document.getElementById('qiReviewBody').innerHTML =
      '<dl>' + lines.map(l => `<dt>${esc(l.label)}</dt><dd>${esc(l.value)}</dd>`).join('') + '</dl>';
    document.getElementById('qiConfirmBtn').onclick = () => qiSubmit(form);
  }
  function qiBackToForm() {
    document.getElementById('qaIssueReview').classList.add('hidden');
    document.getElementById('qaIssueForm').classList.remove('hidden');
  }
  // ล้าง highlight ค้างของรอบก่อน แล้วไฮไลต์เฉพาะ field ที่ Redmine ฟ้อง 422 มา —
  // ครอบทั้ง field ตายตัว (Subject/Description/...) และ custom field แบบไดนามิก
  function qiHighlightFieldErrors(fieldErrors) {
    document.querySelectorAll('.qi-field-error').forEach(el => el.classList.remove('qi-field-error'));
    const builtinIds = { Subject: 'qiSubject', Description: 'qiDescription', 'Risk Level': 'qiRiskLevel', Priority: 'qiPriority' };
    (fieldErrors || []).forEach(fe => {
      if (!fe.fieldName) return;
      if (builtinIds[fe.fieldName]) {
        document.getElementById(builtinIds[fe.fieldName]).classList.add('qi-field-error');
        return;
      }
      const cf = (qiMeta && qiMeta.customFields || []).find(f => f.name === fe.fieldName);
      if (cf) {
        const el = document.querySelector(`#qiCustomFields .qi-cf[data-field-id="${cf.id}"]`);
        if (el) el.classList.add('qi-field-error');
      }
    });
  }
  function qiSubmit(form) {
    const api = shell().api, btn = document.getElementById('qiConfirmBtn'), errEl = document.getElementById('qiReviewError');
    btn.disabled = true; btn.textContent = 'กำลังสร้าง...'; errEl.style.display = 'none';
    api.createIssue(form).then(result => {
      btn.disabled = false; btn.textContent = 'ยืนยันสร้าง';
      if (!result || !result.ok) {
        const msg = 'สร้างไม่สำเร็จ: ' + ((result && result.error) || 'ไม่ทราบสาเหตุ') +
          ((result && result.fieldErrors && result.fieldErrors.length)
            ? ' (' + result.fieldErrors.map(f => f.message).join(', ') + ')' : '');
        if (result && result.fieldErrors && result.fieldErrors.length) {
          qiHighlightFieldErrors(result.fieldErrors);
          document.getElementById('qaIssueReview').classList.add('hidden');
          document.getElementById('qaIssueForm').classList.remove('hidden');
          const formErrEl = document.getElementById('qiFormError');
          formErrEl.style.display = 'block'; formErrEl.textContent = msg;
        } else {
          errEl.style.display = 'block'; errEl.textContent = msg;
        }
        return;
      }
      // แสดงผลสำเร็จอยู่ในแผง qaIssueReview เอง (ไม่พึ่ง qaRows ที่อาจถูกซ่อนอยู่ถ้าแท็บที่ active
      // ตอนนี้ไม่ใช่ QA test — ปุ่ม "+" ย้ายไปแท็บ Redmine แล้ว ฟอร์ม/review เป็นแผงลอยที่โชว์ได้
      // ไม่ว่าแท็บไหน active อยู่ก็ตาม) กด "ปิด" เมื่อไหร่ค่อยเรียก qiCloseForm() รีเซ็ตจริง
      document.getElementById('qiReviewBody').innerHTML =
        `<div class="hint">สร้างสำเร็จ: <a href="#" id="qiCreatedLink">#${result.id}</a></div>`;
      document.getElementById('qiCreatedLink').onclick = (e) => { e.preventDefault(); shell().api.openLink(result.url); };
      document.getElementById('qaIssueReviewBack').classList.add('hidden');
      btn.textContent = 'ปิด';
      btn.onclick = () => {
        document.getElementById('qaIssueReview').classList.add('hidden');
        document.getElementById('qaIssueReviewBack').classList.remove('hidden');
        btn.textContent = 'ยืนยันสร้าง';
        qiCloseForm();
      };
      // ยังแทรก banner ใน qaRows ไว้ด้วยเผื่อเปิดแท็บ QA test ทีหลัง (ปลอดภัยแม้ตอนนี้ถูกซ่อนอยู่)
      const el = document.getElementById('qaRows');
      if (el) {
        el.innerHTML = `<div class="hint">สร้างสำเร็จ: <a href="#" id="qiCreatedLink2">#${result.id}</a></div>` + el.innerHTML;
        const link2 = document.getElementById('qiCreatedLink2');
        if (link2) link2.onclick = (e) => { e.preventDefault(); shell().api.openLink(result.url); };
        bindQaRowClicks(el);
      }
      const notConfiguredBtn = document.getElementById('qaNotConfiguredBtn');
      if (notConfiguredBtn) notConfiguredBtn.onclick = () => shell().openSettings('cardQa');
    }).catch(e => {
      btn.disabled = false; btn.textContent = 'ยืนยันสร้าง';
      errEl.style.display = 'block';
      errEl.textContent = 'เกิดข้อผิดพลาด: ' + e.message;
    });
  }

  function qaBadge(status){
    const cls={PASS:'qa-b-pass',FAIL:'qa-b-fail',CRASH:'qa-b-crash'}[status]||'qa-b-crash';
    const label={PASS:'PASS',FAIL:'FAIL',CRASH:'ไม่จบ'}[status]||status;
    return `<span class="qa-badge ${cls}">${label}</span>`;
  }
  // สีของป้าย source หมุนตาม .sp0-7 ชุดเดียวกับสีผู้พูดในบทถอดเสียง
  //
  // เคยมีตัวแฮชส่วนตัวตรงนี้ที่วนทีละ code unit ส่วน hashN วนทีละ code point --
  // ให้ผลเท่ากันทุกค่าใน BMP (ตรวจแล้ว 83,487 ค่า ต่างกัน 0) ต่างเฉพาะป้ายที่มีอิโมจิ
  // ซึ่งได้แค่เปลี่ยนสี ไม่กระทบข้อมูล จึงยุบเข้าตัวกลาง
  function qaSrcTag(label){
    return `<span class="qa-src sp${hashN(label,8)}">${esc(label)}</span>`;
  }
  // แปลฟอร์ม issue กลับเป็นบรรทัด (label, value) สำหรับหน้า review — id -> ชื่อคนอ่านได้
  // ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM เพื่อให้เทสได้ตรงๆ
  function buildReviewLines(form, meta) {
    const member = (meta.members || []).find(m => m.id === form.assigneeId);
    const lines = [
      { label: 'โปรเจกต์', value: form.projectName },
      { label: 'Tracker', value: form.trackerName },
      { label: 'หัวข้อ', value: form.subject },
      { label: 'Priority', value: form.priorityName },
      { label: 'ผู้รับผิดชอบ', value: member ? member.name : '(ไม่ระบุ)' },
      { label: 'Risk Level', value: form.riskLevel || '(ไม่ระบุ)' },
    ];
    for (const [fieldId, value] of Object.entries(form.customFieldValues || {})) {
      const field = (meta.customFields || []).find(f => String(f.id) === String(fieldId));
      if (field && value) lines.push({ label: field.name, value });
    }
    lines.push({ label: 'ไฟล์แนบ', value: (form.uploads || []).map(u => u.filename).join(', ') || '(ไม่มี)' });
    return lines;
  }
  function qaDur(r){
    if(!r.startedAt||!r.endedAt) return '';
    const a=new Date(r.startedAt.replace(' ','T')), b=new Date(r.endedAt.replace(' ','T'));
    const s=Math.max(0,Math.round((b-a)/1000));
    return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`;
  }
  // ทุกบรรทัดใน log ขึ้นต้นด้วย [YYYY-MM-DD HH:MM:SS] — ตัดวันที่ทิ้งเหลือแค่เวลา
  // เพราะวันเต็มโชว์อยู่แล้วในหัวข้อด้านบน (qa-reader-sub) ซ้ำทุกบรรทัดกินที่เปล่าๆ
  // (รันนึงยาวไม่กี่นาที ไม่ต้องห่วงข้ามวัน — ถ้าข้ามจริงก็ยังเห็นเวลาวิ่ง 23:59 → 00:0x อยู่ดี)
  function qaStripDate(t){
    return String(t).replace(/^\[\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})\]/gm,'[$1]');
  }
  function qaColorLog(t){
    return esc(t).split('\n').map(l=>{
      if(/RESULT:\s*PASS|🎉|DONE_OK/.test(l)) return `<span class="ok">${l}</span>`;
      if(/RESULT:\s*FAIL|❌/.test(l)) return `<span class="bad">${l}</span>`;
      // ห้ามใส่ ^ — มันจะ anchor แค่ alternative แรก ทำให้บรรทัด 📁 ไม่ติดสีทั้งที่ 🔗/ℹ️/⏳ ติด
      if(/📁|🔗|ℹ️|⏳/.test(l)) return `<span class="info">${l}</span>`;
      return l;
    }).join('\n');
  }
  // วันที่ของรัน: ปกติมาจากบรรทัดแรกของ log แต่ log ที่ไม่มี timestamp เลย (adb ล้มก่อนเริ่ม)
  // จะไม่มี startedAt — ถอยไปใช้ชื่อโฟลเดอร์ YYYYMMDDHHMMSS ซึ่งมีเสมอ
  function qaDateOf(r){
    if(r.startedAt) return r.startedAt.slice(0,10);
    const m=/^(\d{4})(\d{2})(\d{2})/.exec(r.id||'');
    return m?`${m[1]}-${m[2]}-${m[3]}`:null;
  }
  // รันที่ผ่านตัวกรอง "ทุกแถวยกเว้นแถวที่ระบุ" — ใช้นับเลขบนชิปให้ตรงกับที่เห็นในลิสต์จริง
  function qaExcept(skip){
    const runs=(qaData&&qaData.runs)||[];
    return runs.filter(r=>
      (skip==='status'||qaFilter==='all'||r.status===qaFilter) &&
      (skip==='src'||qaSrcFilter===null||r.sourceLabel===qaSrcFilter) &&
      (skip==='date'||dateMatch(qaDateSel,qaDateOf(r))));
  }
  function qaList(){
    if(!qaData||!qaData.runs) return [];
    return qaExcept(null);
  }
  function renderQaStats(){
    const runs=(qaData&&qaData.runs)||[];
    const cells=[['ทั้งหมด',runs.length,'var(--accent)'],
                 ['PASS',runs.filter(r=>r.status==='PASS').length,'var(--green)'],
                 ['FAIL',runs.filter(r=>r.status==='FAIL').length,'var(--rose)'],
                 ['ไม่จบ',runs.filter(r=>r.status==='CRASH').length,'var(--amber)']];
    document.getElementById('qaStats').innerHTML=cells.map(([l,n,c])=>
      `<div class="stat" style="--sc:${c}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  }
  function renderQaChips(){
    const sources=(qaData&&qaData.sources)||[];
    // ล้าง qaSrcFilter ที่ค้างอยู่ก่อนนับเลข — ถ้า source ที่กรองไว้ถูกลบทิ้งในหน้าตั้งค่า
    // แล้วปล่อยค้าง ชิปจะนับได้ 0 ทุกอันทั้งที่ลิสต์ข้างล่างยังมีรันอยู่ (renderQaRows
    // รันทีหลังและเห็นค่าที่ล้างแล้ว) — ต้องล้างตรงนี้ ไม่ใช่ท้ายฟังก์ชัน
    if(qaSrcFilter!==null && !sources.includes(qaSrcFilter)) qaSrcFilter=null;
    if(sources.length<=1) qaSrcFilter=null;

    // แถว ปี/เดือน/วัน ต้องวาดก่อน เพราะ dateFilterHtml เป็นตัวล้าง qaDateSel ที่ค้างอยู่
    // ถ้าไปวาดทีหลัง เลขบนชิปสถานะ/source ข้างล่างจะนับด้วยค่าที่ค้างและออกมาเป็น 0 ทั้งแถว
    const dEl=document.getElementById('qaDateRows');
    dEl.innerHTML=dateFilterHtml(qaExcept('date'),qaDateOf,qaDateSel);
    wireDateFilter(dEl,qaDateSel,()=>{ renderQaChips(); renderQaRows(); });

    // ตัวเลขบนชิปแต่ละแถวต้องนับ "หลังหักตัวกรองแถวอื่นแล้ว" ไม่งั้นเลขโกหก —
    // เช่นกรอง source เหลือ 3 รัน แต่ชิป FAIL ยังขึ้น 4 ทั้งที่ในลิสต์เห็นแค่ 1
    const inSrc=qaExcept('status'), inStatus=qaExcept('src');
    const counts={all:inSrc.length,PASS:0,FAIL:0,CRASH:0};
    inSrc.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
    const defs=[['all','ทั้งหมด'],['PASS','PASS'],['FAIL','FAIL'],['CRASH','ไม่จบ']];
    document.getElementById('qaChips').innerHTML=defs.map(([k,l])=>
      `<div class="chip${qaFilter===k?' active':''}" data-k="${k}">${l}<span class="n">${counts[k]||0}</span></div>`).join('');
    document.querySelectorAll('#qaChips .chip').forEach(c=>c.onclick=()=>{qaFilter=c.dataset.k;renderQaChips();renderQaRows()});

    // ชิปกรอง source โผล่เฉพาะตอนมีมากกว่า 1 source (sources ประกาศไว้ข้างบนแล้ว)
    const srcLabelEl=document.getElementById('qaSrcLabel'), srcEl=document.getElementById('qaSrcChips');
    if(sources.length>1){
      srcLabelEl.style.display=''; srcEl.style.display='';
      srcEl.innerHTML=`<div class="chip${qaSrcFilter===null?' active':''}" data-s="">ทุก source<span class="n">${inStatus.length}</span></div>`+
        sources.map(s=>`<div class="chip${qaSrcFilter===s?' active':''}" data-s="${esc(s)}">${esc(s)}<span class="n">${inStatus.filter(r=>r.sourceLabel===s).length}</span></div>`).join('');
      srcEl.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{qaSrcFilter=c.dataset.s||null;renderQaChips();renderQaRows()});
    } else {
      srcLabelEl.style.display='none'; srcEl.style.display='none'; srcEl.innerHTML=''; qaSrcFilter=null;
    }
  }
  function renderQaRows(){
    const el=document.getElementById('qaRows');
    if(qaData && qaData.error){
      const notSetUp=qaData.error.startsWith('ไม่พบโฟลเดอร์ QA test');
      el.innerHTML=`<div class="not-configured">
        <p>${notSetUp?'ยังไม่ได้ตั้งค่าโฟลเดอร์ผล QA test':esc(qaData.error)}</p>
        <button id="qaNotConfiguredBtn">ตั้งค่าเลย</button>
      </div>`;
      document.getElementById('qaNotConfiguredBtn').onclick=()=>shell().openSettings('cardQa');
      return;
    }
    const list=qaList();
    if(!list.length){
      el.innerHTML='<div class="empty">ไม่พบรันทดสอบที่ตรงกับตัวกรอง</div>';
      qaOpen=null; renderQaReader();   // อย่าปล่อย reader ค้างโชว์รันที่ถูกกรองออกไปแล้ว
      return;
    }
    // ตัวกรองอาจตัดรันที่เลือกอยู่ออกจากลิสต์ — เด้งไปเลือกอันแรกที่ยังเห็นแทน
    // ไม่งั้นจอกว้างจะเหลือ reader โชว์รันที่ไม่มีในลิสต์ โดยไม่มีแถวไหนไฮไลต์เลย
    if(!list.some(r=>r.id===qaOpen)){ qaOpen=list[0].id; renderQaReader(); }
    // .sel ไฮไลต์แถวที่เลือกอยู่ — มีผลตอนจอกว้างที่ qaRows กับ qaReader โชว์คู่กัน (ดู container query ด้านบน)
    el.innerHTML=list.map(r=>`
      <div class="qa-row${r.id===qaOpen?' sel':''}" data-id="${esc(r.id)}">
        ${qaBadge(r.status)}${qaSrcTag(r.sourceLabel)}
        <span class="qa-name">${esc(r.name||'(ไม่ระบุชื่อเทส)')}</span>
        <span class="qa-time">${esc(r.endedAt?r.endedAt.slice(11):r.id)}</span>
      </div>`).join('');
    bindQaRowClicks(el);
  }
  // ผูก click handler ของแถว .qa-row — แยกเป็นฟังก์ชันกลางเพราะ qiSubmit ก็ต้องเรียกซ้ำหลัง
  // แทรก banner "สร้างสำเร็จ" ด้วย innerHTML (ซึ่งทำลาย .onclick เดิมของ DOM node ทุกตัว)
  function bindQaRowClicks(el){
    el.querySelectorAll('.qa-row').forEach(row=>row.onclick=()=>{
      const r=qaData.runs.find(x=>x.id===row.dataset.id);
      if(r) qaOpenRun(r);
    });
  }
  function qaOpenRun(r){
    qaOpen=r.id; qaTab='log';   // เปิดรันใหม่เริ่มที่ log เสมอ ไม่ให้ค้างแท็บวิวเวอร์ของรันก่อนหน้า
    document.getElementById('qaRows').classList.add('hidden');
    document.getElementById('qaReader').classList.remove('hidden');
    renderQaRows();   // รีเฟรชไฮไลต์ .sel (ไม่มีผลตอนจอแคบเพราะแถวถูกซ่อนไปแล้ว)
    renderQaReader();
    document.querySelector('.body').scrollTop=0;
  }
  function qaBackToList(){
    // ไม่ล้าง qaOpen — ถ้าขยายจอกว้างขึ้นทีหลัง reader (ที่โชว์คู่กับ list) จะมีเนื้อหาให้ดูทันที ไม่ต้องเลือกใหม่
    document.getElementById('qaReader').classList.add('hidden');
    document.getElementById('qaRows').classList.remove('hidden');
  }
  // สีของวิวเวอร์ (iframe) ต้องส่งเป็นค่าจริง ไม่ใช่ var(--x) เพราะ iframe คนละ document
  // ไม่เห็น :root ของแอป — อ่านค่าที่ resolve แล้วตอนสร้าง แล้ว re-render ใหม่เมื่อสลับธีม
  function qaViewerPalette(){
    const cs=getComputedStyle(document.documentElement);
    const v=n=>cs.getPropertyValue(n).trim();
    return {
      bg:v('--bg'), panel:v('--panel'), panelSoft:v('--panel'), line:v('--line'),
      lineSoft:v('--line-soft'), edge:v('--line'), ink:v('--ink'), muted:v('--muted'),
      deep:v('--dim'), accent:v('--accent'), amber:v('--amber'), rose:v('--rose'),
      clsInk:v('--cyan'), ridInk:v('--muted'), bdInk:v('--dim'),
      fitInk:v('--ink'), fitClkInk:v('--amber'), onAccent:v('--on-accent'),
      grid:'color-mix(in srgb,'+v('--accent')+' 7%,transparent)', shadow:v('--shadow'),
    };
  }
  // โหลด failure.xml (lazy + cache ต่อรัน) แล้วเรียก cb — ใช้ร่วมกันทั้งแท็บวิวเวอร์และแท็บ XML ดิบ
  function qaLoadXml(r, box, cb){
    if(qaXmlCache.has(r.dir)){ cb(qaXmlCache.get(r.dir)); return; }
    box.innerHTML='<div class="hint">กำลังโหลด...</div>';
    shell().api.getQaFailureXml(r.dir).then(res=>{
      if(qaOpen!==r.id) return;               // เปลี่ยนไปดูรันอื่นก่อนโหลดเสร็จ
      if(res && res.xml!=null){ qaXmlCache.set(r.dir,res.xml); cb(res.xml); }
      else box.innerHTML=`<div class="empty">อ่าน failure.xml ไม่สำเร็จ: ${esc(res&&res.error||'unknown error')}</div>`;
    });
  }
  function renderQaPane(r, logText, collapsedDefault){
    const box=document.getElementById('qaPane');
    if(!box) return;
    if(qaTab==='ui'){
      qaLoadXml(r, box, xml=>{
        let html;
        try{ html=uidumpHtml(xml,{label:'failure.xml',palette:qaViewerPalette()}); }
        catch(e){ box.innerHTML=`<div class="empty">แปลง failure.xml ไม่สำเร็จ: ${esc(e.message)}</div>`; return; }
        // sandbox allow-scripts (ไม่ให้ allow-same-origin) — วิวเวอร์รัน JS ของตัวเองได้
        // แต่แตะ DOM/ข้อมูลของแอปไม่ได้ และ CSS ก็ไม่ชนกัน
        const f=document.createElement('iframe');
        f.className='qa-ui'; f.setAttribute('sandbox','allow-scripts'); f.srcdoc=html;
        box.innerHTML=''; box.appendChild(f);
      });
      return;
    }
    if(qaTab==='xml'){
      qaLoadXml(r, box, xml=>{ box.innerHTML=`<div class="qa-xml">${qaColorLog(xml)}</div>`; });
      return;
    }
    const lines=logText.split('\n');
    box.innerHTML=`
      <span class="qa-toggle" id="qaToggle">${collapsedDefault?'▸ ขยาย log เต็ม':'▾ ย่อ log'}</span>
      <div class="qa-log" id="qaLog">${collapsedDefault?qaColorLog(lines.slice(-3).join('\n')):qaColorLog(logText)}</div>`;
    let collapsed=collapsedDefault;
    document.getElementById('qaToggle').onclick=()=>{
      collapsed=!collapsed;
      document.getElementById('qaLog').innerHTML=collapsed?qaColorLog(lines.slice(-3).join('\n')):qaColorLog(logText);
      document.getElementById('qaToggle').textContent=collapsed?'▸ ขยาย log เต็ม':'▾ ย่อ log';
    };
  }
  function renderQaReader(){
    // ต้องเช็ค qaData.runs ด้วย ไม่ใช่แค่ qaData — payload ที่เป็น {error} ไม่มี runs เลย
    // ปล่อยให้ r เป็น undefined แล้วตกลงไปเข้าเคส !r ข้างล่าง ซึ่งล้างจอแล้วพากลับไปหน้ารายการ
    const r=qaData && qaData.runs && qaData.runs.find(x=>x.id===qaOpen); const el=document.getElementById('qaReader');
    // ต้องล้าง innerHTML ด้วย ไม่ใช่แค่ .hidden — จอกว้าง container query สั่ง display:block ทับ .hidden อยู่
    if(!r){
      el.innerHTML=''; document.getElementById('qaStage').classList.remove('ui-wide');
      qaBackToList(); return;
    }
    if(!r.hasXml) qaTab='log';          // รันที่ไม่มี failure.xml มีแค่แท็บ Log ให้ดู
    const collapsedDefault=r.status==='PASS'; // FAIL/ไม่จบ ขึ้นเต็มทันที เพราะเป็นอันที่ต้องอ่าน
    const logText=qaStripDate(r.log);   // วันเต็มอยู่ใน qa-reader-sub ด้านล่างแล้ว
    const seg=[['log','📄 Log'],['ui','🧩 UI hierarchy'],['xml','⟨⟩ XML ดิบ']];
    el.innerHTML=`
      <button class="mt-back" id="qaBack">← กลับไปรายการรัน</button>
      <div class="qa-reader-head">${qaBadge(r.status)}${qaSrcTag(r.sourceLabel)}
        <span class="mt-title" style="font-size:14.5px">${esc(r.name||'(ไม่ระบุชื่อเทส)')}</span></div>
      <div class="qa-reader-sub">${esc(r.id)}${r.startedAt?' · '+esc(r.startedAt):''}${qaDur(r)?' · '+qaDur(r):''}</div>
      ${r.hasXml?`<div class="qa-seg" id="qaSeg">${seg.map(([k,l])=>
        `<button data-t="${k}" class="${qaTab===k?'on':''}">${l}</button>`).join('')}</div>`:''}
      <div id="qaPane"></div>`;
    document.getElementById('qaBack').onclick=qaBackToList;
    document.getElementById('qaStage').classList.toggle('ui-wide', qaTab==='ui');
    const segEl=document.getElementById('qaSeg');
    if(segEl) segEl.querySelectorAll('button').forEach(b=>b.onclick=()=>{
      qaTab=b.dataset.t; renderQaReader();
    });
    renderQaPane(r, logText, collapsedDefault);
  }
  // วิวเวอร์ failure.xml อยู่ใน iframe คนละ document — สีถูก inline ไปตอนสร้าง ไม่ได้สืบทอด :root
  // ของแอป จึงต้องสร้างใหม่เองเมื่อธีมเปลี่ยน
  // เช็คจาก DOM ไม่ใช่ตัวแปร qaTab เพราะเปลือกเรียก applyTheme ตอน init ซึ่งอาจมาถึงก่อนที่
  // โมดูลนี้จะมีข้อมูล — onTheme ต้องทนถูกเรียกตอนแท็บยังว่างได้
  function onTheme(){
    const onTab=document.querySelector('#qaSeg button.on');
    if(onTab && onTab.dataset.t==='ui') renderQaReader();
  }
  function onData(payload){
    qaData=payload;
    const stillThere=qaOpen && payload && !payload.error && payload.runs.find(x=>x.id===qaOpen);
    if(!stillThere){
      // เลือกรันล่าสุดให้อัตโนมัติ เผื่อจอกว้างพอที่ reader โชว์คู่กับ list อยู่แล้วตั้งแต่แรก — ไม่ต้องรอคลิก
      // ไม่กระทบจอแคบ เพราะที่นั่น reader ยังซ่อนด้วย .hidden จนกว่าจะมีคนคลิกแถวจริงๆ
      qaOpen=(payload && payload.runs && payload.runs[0]) ? payload.runs[0].id : null;
    }
    renderQaStats(); renderQaChips(); renderQaRows(); renderQaReader();
  }
  function mount(){
    const api=shell().api;
    api && api.onQaTests && api.onQaTests(onData);
    // ดักฟัง broadcast เดียวกับที่แท็บ Redmine ใช้ (tasks-update) เพื่อรู้จักรายชื่อโปรเจกต์จริง —
    // ipcRenderer.on รับ listener ได้หลายตัว จึงไม่ชนกับ onTasks ของ tab-redmine.js
    shell().api.onTasks(payload => {
      if (!payload) return;
      if (payload.error || !payload.groups) return;
      payload.groups.forEach(g => g.issues.forEach(i => {
        if (i.projectId) qiKnownProjects.set(i.projectId, i.project);
      }));
    });
    document.getElementById('qaNewIssueBtn').onclick = qiOpenForm;
    document.getElementById('qaIssueFormBack').onclick = qiCloseForm;
    document.getElementById('qiProject').onchange = qiLoadMetaForSelection;
    document.getElementById('qiTracker').onchange = qiLoadMetaForSelection;
    document.getElementById('qiDraftBtn').onclick = qiDraft;
    document.getElementById('qaRefresh').onclick=()=>api&&api.refreshQaTests&&api.refreshQaTests();
    document.getElementById('qiPreviewBtn').onclick = qiShowReview;
    document.getElementById('qaIssueReviewBack').onclick = qiBackToForm;
    document.getElementById('qiFiles').onchange = (e) => {
      const api = shell().api;
      const errEl = document.getElementById('qiFormError');
      [...e.target.files].forEach(file => {
        file.arrayBuffer().then(buf => api.uploadIssueAttachment(new Uint8Array(buf), file.name)).then(res => {
          if (res && res.ok) {
            qiUploads.push({ token: res.token, filename: res.filename, content_type: file.type });
            document.getElementById('qiFileList').innerHTML =
              qiUploads.map(u => `<span class="qi-file-chip">${esc(u.filename)}</span>`).join('');
            return;
          }
          errEl.style.display = 'block';
          errEl.textContent = `แนบไฟล์ "${file.name}" ไม่สำเร็จ: ${(res && res.error) || 'ไม่ทราบสาเหตุ'}`;
        }).catch(e => {
          errEl.style.display = 'block';
          errEl.textContent = `แนบไฟล์ "${file.name}" ไม่สำเร็จ: ${e.message}`;
        });
      });
    };
  }

  // ===== การ์ดตั้งค่าของแท็บนี้ =====
  // markup ของการ์ดอยู่ใน widget.html เหมือนเดิม ที่ย้ายมาคือสายไฟ
  // แต่ละ source เป็นหนึ่งแถว (label + path) แก้ในตัว qaRows แล้วเขียนลงดิสก์ตอนกดบันทึกเท่านั้น
  // เริ่มด้วยแถวว่างหนึ่งแถวเมื่อยังไม่เคยตั้งค่า เหมือนการ์ดอื่นที่เริ่มด้วยช่องว่าง
  let setQaRowsEl,setQaAdd,setQaStatus,setQaSave;
  let qaRows=[{label:'',path:''}];
  function renderSetQaRows(){
    setQaRowsEl.innerHTML=qaRows.map((r,i)=>`
      <div class="qa-src-row" data-i="${i}">
        <input class="search qa-src-label" type="text" placeholder="ชื่อ source" value="${esc(r.label)}" autocomplete="off">
        <input class="search" type="text" placeholder="เช่น D:\\COWORK\\Test-case-mobile\\appium-bluestacks\\results" value="${esc(r.path)}" autocomplete="off">
        <button type="button" class="qa-src-rm" title="ลบ source นี้">✕</button>
      </div>`).join('');
    setQaRowsEl.querySelectorAll('.qa-src-row').forEach(row=>{
      const i=Number(row.dataset.i);
      const [labelInput,pathInput]=row.querySelectorAll('input');
      labelInput.oninput=()=>qaRows[i].label=labelInput.value;
      pathInput.oninput=()=>qaRows[i].path=pathInput.value;
      row.querySelector('.qa-src-rm').onclick=()=>{
        qaRows.splice(i,1);
        if(!qaRows.length) qaRows=[{label:'',path:''}];
        renderSetQaRows();
      };
    });
  }
  let setLlmUrl,setLlmKey,setLlmStatus,setLlmSave;
  function mountSettings(){
    setQaRowsEl=document.getElementById('setQaRows'); setQaAdd=document.getElementById('setQaAdd');
    setQaStatus=document.getElementById('setQaStatus'); setQaSave=document.getElementById('setQaSave');
    setQaAdd.onclick=()=>{ qaRows.push({label:'',path:''}); renderSetQaRows(); };
    setQaSave.onclick=()=>{
      const sources=qaRows.map(r=>({label:r.label.trim(),path:r.path.trim()})).filter(r=>r.path);
      setQaSave.disabled=true;
      shell().api.saveQaSources(sources).then(()=>{
        setQaSave.disabled=false;
        setQaStatus.className='set-status ok';
        setQaStatus.textContent='บันทึกแล้ว';
      });
    };
    setLlmUrl=document.getElementById('setLlmUrl'); setLlmKey=document.getElementById('setLlmKey');
    setLlmStatus=document.getElementById('setLlmStatus'); setLlmSave=document.getElementById('setLlmSave');
    setLlmSave.onclick=()=>{
      const baseUrl=setLlmUrl.value.trim(), apiKey=setLlmKey.value.trim();
      if(!baseUrl || !apiKey){ setLlmStatus.className='set-status err'; setLlmStatus.textContent='กรอก Base URL และ API key ให้ครบ'; return; }
      setLlmSave.disabled=true; setLlmStatus.className='set-status'; setLlmStatus.textContent='กำลังบันทึก...';
      shell().api.saveLlmConfig({baseUrl,apiKey}).then(()=>{
        setLlmSave.disabled=false;
        setLlmStatus.className='set-status ok';
        setLlmStatus.textContent='บันทึกแล้ว';
      });
    };
  }
  function loadSettings(){
    setQaStatus.textContent=''; setQaStatus.className='set-status';
    const api=shell().api;
    api && api.getQaSources && api.getQaSources().then(sources=>{
      qaRows=(sources&&sources.length?sources:[{label:'',path:''}]).map(s=>({label:s.label||'',path:s.path||''}));
      renderSetQaRows();
    });
    setLlmStatus.textContent=''; setLlmStatus.className='set-status';
    api && api.getLlmConfig && api.getLlmConfig().then(cfg=>{
      setLlmUrl.value=(cfg&&cfg.baseUrl)||''; setLlmKey.value=(cfg&&cfg.apiKey)||'';
    });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.tabs.qatest = { key:'qa', settingsCard:'cardQa', mount, mountSettings, loadSettings, onData, onTheme };

  // เปิดทาง node --test แบบเดียวกับ tab-grafana.js / tab-meeting.js / tab-redmine.js
  // เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildReviewLines };
  }
})(typeof window !== 'undefined' ? window : globalThis);
