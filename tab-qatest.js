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

  let qaData=null, qaFilter='all', qaSrcFilter=null, qaTestFilter=null, qaOpen=null, qaXmlCache=new Map();
  const qaDateSel={y:null,m:null,d:null};
  let qaTab='log';                 // log = ข้อความ log, ui = วิวเวอร์ failure.xml, xml = XML ดิบ

  // ===== ฟอร์มสร้าง issue =====
  let qiMeta = null;          // ผลจาก getIssueFormMeta ล่าสุด: {trackerId, priorityOptions, customFields}
  let qiMembers = [];         // ผลจาก getProjectMembers ล่าสุด
  let qiUploads = [];         // [{token, filename, content_type}] ทีละไฟล์ที่ upload สำเร็จแล้ว
  // รูปที่วางในช่องโน้ตเพื่อให้ LLM ดู — เก็บ dataUrl ไว้ในหน่วยความจำ renderer เท่านั้น
  // ไม่ใช่ชุดเดียวกับ qiUploads: qiUploads คือไฟล์แนบของ issue (ทุกใบ ไม่ว่ามาจากทางไหน)
  // ส่วนตรงนี้คือ "ใบที่จะส่งให้โมเดลดู" ซึ่งผู้ใช้เอาออกทีละใบได้โดยไฟล์แนบยังอยู่
  let qiDraftImages = [];     // [{filename, dataUrl, pending}]
  // รายชื่อโปรเจกต์จริงมาจาก payload ของแท็บ Redmine (tasks-update) ไม่ใช่ qaData ของแท็บนี้ —
  // onTasks รับ listener ได้หลายตัวพร้อมกัน (ipcRenderer.on ปกติของ Electron) แท็บนี้เลยแค่ดัก
  // ฟังเอง โดยไม่ต้องแตะ tab-redmine.js เลย ทุก issue มี projectId+project (ชื่อ) ติดมาอยู่แล้ว
  let qiKnownProjects = new Map();  // projectId -> projectName

  // ตั้งชื่อไฟล์ให้รูปที่วางจากคลิปบอร์ด — คลิปบอร์ดไม่มีชื่อไฟล์ติดมา ถ้าใช้ชื่อตายตัวจะชนกัน
  // เองตอนวางหลายรูป รูปแบบเดียวกับที่หน้าเว็บ Redmine ตั้งให้ (clipboard-YYYYMMDDHHMM-xxxxx)
  function qiStamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
      + '-' + Math.random().toString(36).slice(2, 7);
  }

  function qiInsertAtCursor(el, text) {
    const start = el.selectionStart == null ? el.value.length : el.selectionStart;
    const end = el.selectionEnd == null ? start : el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  }

  function qiRenderFileChips() {
    document.getElementById('qiFileList').innerHTML = qiUploads
      .map(u => `<span class="qi-file-chip" data-fn="${esc(u.filename)}" title="คลิกเพื่อแทรกรูปนี้ตรงเคอร์เซอร์ในช่องรายละเอียด">${esc(u.filename)}</span>`)
      .join('');
  }

  // อัปโหลดไฟล์เดียวขึ้น Redmine — ใช้ร่วมกันทั้งปุ่มแนบไฟล์และการวางรูปจากคลิปบอร์ด
  // placeholder (ถ้ามี) คือข้อความคั่นที่วางไว้ในช่องรายละเอียดแล้ว รอแทนที่ด้วยแท็ก <img> จริง
  function qiUploadFile(file, filename, placeholder) {
    const api = shell().api;
    const errEl = document.getElementById('qiFormError');
    const desc = document.getElementById('qiDescription');
    const settle = (replacement) => {
      if (placeholder) desc.value = desc.value.replace(placeholder, replacement);
    };
    const fail = (why) => {
      settle('');
      errEl.style.display = 'block';
      errEl.textContent = `แนบไฟล์ "${filename}" ไม่สำเร็จ: ${why}`;
      return false;
    };
    // คืน true/false ให้ผู้เรียกรู้ผล — ทางช่องโน้ตต้องถอนรูปออกจากชุดที่จะส่งให้ LLM ถ้าอัปไม่ขึ้น
    // ไม่งั้นร่างจะอ้าง "ภาพที่ 1" ทั้งที่ issue ไม่มีรูปนั้นแนบอยู่จริง
    return file.arrayBuffer()
      .then(buf => api.uploadIssueAttachment(new Uint8Array(buf), filename))
      .then(res => {
        if (!res || !res.ok) return fail((res && res.error) || 'ไม่ทราบสาเหตุ');
        qiUploads.push({ token: res.token, filename: res.filename, content_type: file.type });
        qiRenderFileChips();
        settle(`<img src="${res.filename}">`);
        return true;
      })
      .catch(e => fail(e.message));
  }

  // ===== รูปสำหรับให้ LLM ดู =====
  // ป้ายปุ่มบอกจำนวนรูปที่จะส่ง เพราะรูปอยู่คนละที่กับปุ่ม — ไม่งั้นกดร่างแล้วไม่รู้ว่าโมเดลเห็นกี่ใบ
  function qiDraftBtnLabel(count) {
    return count ? `🪄 ให้ LLM ช่วยร่าง (${count} รูป)` : '🪄 ให้ LLM ช่วยร่าง';
  }

  function qiThumbsHtml(images) {
    return (images || []).map((im, i) => `
      <div class="qi-thumb${im.pending ? ' qi-thumb-busy' : ''}" title="${esc(im.filename)}">
        ${im.dataUrl ? `<img src="${esc(im.dataUrl)}" alt="">` : ''}
        <button type="button" class="qi-thumb-drop" data-i="${i}"
          title="ไม่ส่งภาพนี้ให้ LLM (ไฟล์แนบใน issue ยังอยู่เหมือนเดิม)">×</button>
      </div>`).join('');
  }

  function qiSyncDraftBtnLabel() {
    document.getElementById('qiDraftBtn').textContent = qiDraftBtnLabel(qiDraftImages.length);
  }

  function qiRenderDraftImages() {
    document.getElementById('qiNotesImages').innerHTML = qiThumbsHtml(qiDraftImages);
    qiSyncDraftBtnLabel();
  }

  // วางรูปในช่องโน้ต = อัปขึ้น Redmine เป็นไฟล์แนบ + เก็บไบต์ไว้ส่งให้โมเดลดู ทำสองอย่างพร้อมกัน
  // เพื่อไม่ให้ผู้ใช้ต้องวางรูปสองรอบ (รอบให้ dev เห็น กับรอบให้ LLM เห็น) ซึ่งเป็นเคสปกติ
  function qiAttachImageToNotes(file, filename) {
    const entry = { filename, dataUrl: '', pending: true };
    qiDraftImages.push(entry);
    qiRenderDraftImages();
    const reader = new FileReader();
    reader.onload = () => { entry.dataUrl = String(reader.result || ''); qiRenderDraftImages(); };
    reader.readAsDataURL(file);
    return qiUploadFile(file, filename).then(ok => {
      if (ok) entry.pending = false;
      else {
        const i = qiDraftImages.indexOf(entry);
        if (i >= 0) qiDraftImages.splice(i, 1);
      }
      qiRenderDraftImages();
    });
  }

  // ===== ย่อรูปให้พอดีเพดานของ endpoint =====
  // ยิงวัด 2026-08-06: endpoint คิดโทเคนรูปเป็น round(w/32)×round(h/32) และ "รวมทั้งคำขอ"
  // ต้องน้อยกว่า 4096 ไม่งั้นได้ HTTP 400 "Failed to apply Qwen3VLProcessor" ใน 0.2 วินาที
  // — ไม่ใช่คำตอบแย่ลง แต่ร่างไม่ได้เลย เส้นแบ่งคม: 3,969 ผ่าน 100% / 4,096 พัง 100%
  //
  // ที่ไม่เกี่ยว (ตัดออกด้วยการวัด ไม่ใช่การเดา): จำนวนรูป (4 ใบ 1280×800 = 4,000 ผ่าน),
  // ขนาดไฟล์ (1.6MB ผ่าน / 0.6MB พัง), สัดส่วนภาพ (4000×600 กับ 600×4000 ผ่านทั้งคู่),
  // ความยาวพรอมป์ (อัดจน 7,631 prompt tokens ยังผ่าน — ข้อความไม่นับในงบนี้)
  const QI_IMAGE_TOKEN_LIMIT = 4096;
  // เผื่อขอบไว้เพราะขนาดจริงหลัง canvas ปัดเป็นจำนวนเต็ม อาจดันโทเคนขึ้นจากที่คำนวณได้เล็กน้อย
  const QI_IMAGE_TOKEN_BUDGET = 3900;

  function qiImageTokens(w, h) {
    return Math.max(1, Math.round(w / 32)) * Math.max(1, Math.round(h / 32));
  }

  // ย่อทุกใบด้วยอัตราเดียวกัน ไม่ใช่แบ่งงบเท่า ๆ กันต่อใบ — ผู้ใช้แนบสกรีนช็อตเต็มจอคู่กับภาพ
  // ครอปเล็ก ๆ เป็นเรื่องปกติ ถ้าแบ่งเท่ากันภาพครอปจะถูกขยาย/ภาพเต็มจอถูกบีบจนเสียน้ำหนักที่ตั้งใจ
  function qiFitPlan(sizes, budget = QI_IMAGE_TOKEN_BUDGET) {
    const list = (sizes || []).map(s => ({
      w: Math.max(1, Math.round(s.w)), h: Math.max(1, Math.round(s.h)),
    }));
    const totalOf = arr => arr.reduce((a, s) => a + qiImageTokens(s.w, s.h), 0);
    if (!list.length || totalOf(list) <= budget) return list;

    // ย่อ 1 เท่าของด้าน = ย่อ 1 เท่ากำลังสองของโทเคน จึงเริ่มที่รากที่สองของอัตราส่วนงบ
    const at = s => list.map(x => ({
      w: Math.max(32, Math.round(x.w * s)), h: Math.max(32, Math.round(x.h * s)),
    }));
    let scale = Math.min(1, Math.sqrt(budget / totalOf(list)));
    let out = at(scale);
    // ค่าที่คำนวณได้เป็นค่าประมาณเพราะการปัดเศษ ไล่ลงทีละนิดจนพอดีจริง ๆ ดีกว่าเชื่อสูตรรอบเดียว
    for (let i = 0; i < 200 && totalOf(out) > budget; i++) {
      scale *= 0.98;
      out = at(scale);
    }
    return out;
  }

  // ต่ำกว่านี้ตัวหนังสือขนาด 13px ในสกรีนช็อตเริ่มอ่านไม่ออก — และปัญหาไม่ใช่ "อ่านไม่ออกแล้วเว้นไว้"
  // แต่เป็น "แต่งค่าที่อ่านไม่ออกขึ้นมาแทน" ซึ่งอันตรายกว่ามากเพราะดูเนียนจนไม่รู้ว่าผิด
  //
  // ยิงถอดความจริงกับสกรีนช็อตจำลอง 2398×1096 ที่มีตัวหนังสือไทย+อังกฤษ (2026-08-06):
  //   1.00× และ 0.71× -> ถูกครบ 8/8 ตรงกันทุกตัวอักษร
  //   0.65×           -> ถูกครบ 8/8
  //   0.55×           -> เหลือ 5/8
  //   0.45×           -> เหลือ 4/8 และเปลี่ยน customer_id 88213 เป็น 80213, ปี 2026 เป็น 2025,
  //                      แถมแต่งบรรทัด payment_method ที่ไม่มีในภาพขึ้นมาเอง
  const QI_SAFE_FIT_SCALE = 0.6;

  function qiFitNotice(sizes, plan) {
    if (!sizes || !sizes.length) return '';
    const scale = Math.min(...sizes.map((s, i) => plan[i].w / s.w));
    if (scale >= QI_SAFE_FIT_SCALE) return '';
    return `⚠️ ย่อรูปเหลือ ${Math.round(scale * 100)}% เพื่อให้พอดีเพดานของโมเดล — `
      + 'ตัวหนังสือเล็กในภาพอาจอ่านไม่ออกจนโมเดลเดาค่าผิดแบบดูเนียน '
      + 'ถ้าร่างออกมารายละเอียดไม่ตรง ให้ลดจำนวนรูปหรือครอปเฉพาะส่วนที่สำคัญแล้วร่างใหม่';
  }

  function qiLoadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('อ่านรูปไม่ได้'));
      img.src = dataUrl;
    });
  }

  // ย่อตอนกดร่าง ไม่ใช่ตอนแนบ — งบขึ้นกับ "ทั้งชุด" ถ้าย่อตอนแนบแล้วผู้ใช้แนบใบที่สี่เพิ่ม
  // ใบที่ย่อไว้ตามงบของสามใบจะกลายเป็นใหญ่เกินทันที และย่อซ้ำจากของที่ย่อแล้วยิ่งเบลอ
  function qiFitImagesToBudget(images) {
    if (!images.length) return Promise.resolve({ images: [], notice: '' });
    return Promise.all(images.map(im => qiLoadImage(im.dataUrl))).then(loaded => {
      const sizes = loaded.map(img => ({ w: img.naturalWidth, h: img.naturalHeight }));
      const plan = qiFitPlan(sizes);
      const fitted = images.map((im, i) => {
        const img = loaded[i];
        const t = plan[i];
        if (t.w === img.naturalWidth && t.h === img.naturalHeight) return im;
        const canvas = document.createElement('canvas');
        canvas.width = t.w;
        canvas.height = t.h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, t.w, t.h);
        // png ไม่ใช่ jpeg เพราะภาพเป็นสกรีนช็อต — jpeg ทำให้ขอบตัวหนังสือแตกซึ่งทำร้าย OCR ตรง ๆ
        return { filename: im.filename, dataUrl: canvas.toDataURL('image/png') };
      });
      return { images: fitted, notice: qiFitNotice(sizes, plan) };
    });
  }

  function qiPastedImages(e) {
    return [...((e.clipboardData && e.clipboardData.items) || [])]
      .filter(it => it.kind === 'file' && /^image\//i.test(it.type))
      .map(it => it.getAsFile())
      .filter(Boolean);
  }
  function qiPastedName(file) {
    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
    return `clipboard-${qiStamp()}.${ext}`;
  }

  // บางแหล่ง (เช่นคัดลอกจาก devtools/หน้าเว็บ) ใส่ "data:image/...;base64,...." ลงคลิปบอร์ดเป็น
  // ข้อความ ไม่ใช่ไฟล์รูป — clipboardData.items จะไม่มี kind:'file' เลย qiPastedImages() เลยไม่เห็น
  // มัน ถ้าปล่อยผ่านจะได้ก้อน base64 ยาวหลายพันตัวอักษรลงในโน้ตที่ถูกส่งเป็น prompt ทั้งดุ้น —
  // เปลืองโทเคนฟรี ๆ และไม่ใช่รูปที่โมเดลมองเห็นได้ (มันเห็นแค่ตัวหนังสือ)
  function qiIsImageDataUrlText(text) {
    return /^\s*data:image\/[a-z0-9.+-]+;base64,/i.test(text || '');
  }

  // ทีมกรอกค่าเดิมทุกใบ เติมให้เลยดีกว่าให้พิมพ์ซ้ำ — ลบทิ้งหรือแก้เป็นค่าอื่นได้ตามปกติ
  // และ buildIssuePayload ตัด custom field ที่ค่าว่างออกอยู่แล้ว การลบทิ้งจึงได้ผลจริง
  const QI_CUSTOM_FIELD_DEFAULTS = {
    'Document Type': 'ASPIRE-FR-18 ISSUE TRACKING',
  };

  // Risk Level มี dropdown ตายตัวใน markup อยู่แล้ว ถ้าวาดจากที่นี่ด้วยจะได้สองช่อง
  function qiCustomFieldsHtml(fields, defaults = QI_CUSTOM_FIELD_DEFAULTS) {
    return (fields || []).filter(f => f.name !== 'Risk Level').map(f => `
        <div class="row-label">${esc(f.name)}</div>
        <textarea class="search qi-cf" data-field-id="${f.id}" rows="3">${esc(defaults[f.name] || '')}</textarea>`).join('');
  }

  function qiDraftGapsHtml(list) {
    if (!list || !list.length) return '';
    return '<b>ข้อมูลที่ยังขาด — เติมก่อนส่งจะลดรอบที่ dev ถามกลับ</b><ul>'
      + list.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>';
  }

  function qiRenderDraftGaps(list) {
    const el = document.getElementById('qiDraftGaps');
    const html = qiDraftGapsHtml(list);
    // className คุมทั้งการซ่อน (.show) — ล้าง html อย่างเดียวไม่พอ กรอบเปล่าจะค้างอยู่บนฟอร์ม
    el.className = html ? 'qi-draft-gaps show' : 'qi-draft-gaps';
    el.innerHTML = html;
  }

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
    qiDraftImages = [];
    document.getElementById('qiFileList').innerHTML = '';
    document.getElementById('qiNotesImages').innerHTML = '';
    qiSyncDraftBtnLabel();
    qiRenderDraftGaps([]);
    document.getElementById('qiFiles').value = '';
    document.getElementById('qiRawNotes').value = '';
    document.getElementById('qiSubject').value = '';
    document.getElementById('qiDescription').value = '';
    document.getElementById('qiRiskLevel').value = '';
    document.getElementById('qiRiskLevelRow').classList.remove('hidden');
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
      // false = tracker นี้ไม่มี Risk Level แน่ (เคยเห็น issue ของคู่นี้แล้วไม่มี) — ซ่อนไปเลย
      // ไม่งั้นผู้ใช้เลือกค่าที่ส่งไม่ได้ แล้วไปเจอ error ตอนกด "ยืนยันสร้าง" ซึ่งสายเกินไป
      // null = ยังไม่เคยเห็น issue ของคู่นี้ ตอบไม่ได้ → โชว์ไว้ก่อนแบบ best-effort
      const hideRisk = res.riskLevelAvailable === false;
      document.getElementById('qiRiskLevelRow').classList.toggle('hidden', hideRisk);
      if (hideRisk) document.getElementById('qiRiskLevel').value = '';
      document.getElementById('qiCustomFields').innerHTML = qiCustomFieldsHtml(res.customFields);
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
    if (!rawNotes) {
      status.className = 'set-status err';
      // รูปอย่างเดียวไม่พอโดยตั้งใจ ไม่ใช่ข้อจำกัดทางเทคนิค — โมเดลดูสกรีนช็อตแล้วบอกได้แค่ว่า
      // "จอนี้หน้าตาแบบนี้" ไม่รู้ว่าอะไรผิด จนกว่าจะมีคนบอก (วัดมาแล้ว ดู spec 2026-08-05)
      status.textContent = qiDraftImages.length
        ? 'พิมพ์โน้ตดิบก่อน — รูปอย่างเดียวไม่พอ โมเดลไม่รู้ว่าอะไรในภาพคือสิ่งที่ผิด'
        : 'พิมพ์โน้ตดิบก่อน';
      return;
    }
    // ใบที่ FileReader ยังอ่านไม่เสร็จจะไม่มี dataUrl — ตัดออกดีกว่าส่ง url ว่างให้ endpoint ปฏิเสธทั้งคำขอ
    const images = qiDraftImages
      .filter(im => im.dataUrl)
      .map(im => ({ filename: im.filename, dataUrl: im.dataUrl }));
    const btn = document.getElementById('qiDraftBtn');
    btn.disabled = true;
    status.className = 'set-status';
    status.innerHTML = 'กำลังร่าง... <button type="button" id="qiSkipDraft">ข้ามไปกรอกเองเลย</button>';
    let skipped = false;
    document.getElementById('qiSkipDraft').onclick = () => { skipped = true; btn.disabled = false; status.textContent = ''; };
    let fitNotice = '';
    qiFitImagesToBudget(images).then(fit => {
      fitNotice = fit.notice;
      return api.draftIssueText(rawNotes, {
        model: shell().llmModel(),   // ตัวเลือกอยู่บน navrow (🪄) ไม่ใช่ในฟอร์มนี้แล้ว
        language: document.getElementById('qiLanguage').value,
        tracker: document.getElementById('qiTracker').value,
        images: fit.images,
        pci: document.getElementById('qiPci').checked,
      });
    }).then(result => {
      btn.disabled = false;
      if (skipped) return;
      if (!result || !result.ok) {
        status.className = 'set-status err';
        status.textContent = (result && result.error) || 'ร่างไม่สำเร็จ — กรอกมือแทน';
        return;
      }
      // คำเตือนเรื่องย่อรูปไม่ทำให้ร่างล้มเหลว จึงยังเป็นสถานะ ok — แต่ต้องเห็น เพราะมันบอกว่า
      // รายละเอียดในร่างอาจถูกโมเดลเดาขึ้นมา ซึ่งเป็นจุดที่คนตรวจต้องเพ่งเป็นพิเศษ
      // คำเตือนจากฝั่ง LLM (เช่น ขาดฝั่งภาษาที่ขอไป) ต่อท้ายแบบเดียวกับคำเตือนเรื่องย่อรูป
      const notices = [fitNotice, ...(result.warnings || [])].filter(Boolean);
      status.className = notices.length ? 'set-status' : 'set-status ok';
      status.textContent = (images.length
        ? `ร่างสำเร็จ (ดู ${images.length} รูปประกอบ) — ตรวจแล้วแก้ต่อได้ก่อนส่ง`
        : 'ร่างสำเร็จ — แก้ต่อได้ก่อนส่ง') + (notices.length ? '\n' + notices.join('\n') : '');
      const d = result.draft;
      document.getElementById('qiSubject').value = d.subject || '';
      document.getElementById('qiDescription').value = d.description || '';
      if (d.suggested_risk_level) document.getElementById('qiRiskLevel').value = d.suggested_risk_level;
      qiRenderDraftGaps(d.missing_info);
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
      const meta = [['โปรเจกต์', form.projectName], ['Tracker', form.trackerName], ['Priority', form.priorityName]];
      if (form.riskLevel) meta.push(['Risk', form.riskLevel]);
      if ((form.uploads || []).length) meta.push(['ไฟล์แนบ', form.uploads.length + ' ไฟล์']);
      document.getElementById('qaIssueReview').classList.add('qi-done');
      document.getElementById('qiReviewBody').innerHTML = `
        <div class="qi-done-head">
          <span class="qi-done-check">✓</span>
          <span class="qi-done-title">สร้าง issue สำเร็จ</span>
          <a href="#" class="qi-done-id" id="qiCreatedLink" title="เปิดใน Redmine">#${result.id}</a>
        </div>
        <div class="qi-done-subject">${esc(form.subject)}</div>
        <div class="qi-done-meta">${meta.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>`;
      const openIssue = (e) => { if (e) e.preventDefault(); shell().api.openLink(result.url); };
      document.getElementById('qiCreatedLink').onclick = openIssue;
      document.getElementById('qaIssueReviewBack').classList.add('hidden');
      // ปุ่มเปิดกลายเป็นปุ่มหลักแทน "ยืนยันสร้าง" ที่หมดหน้าที่แล้ว — ขั้นถัดไปที่คนมักทำคือไปดูใบที่เพิ่งสร้าง
      const openBtn = document.getElementById('qiOpenIssueBtn');
      openBtn.classList.remove('hidden');
      openBtn.classList.add('set-save');
      openBtn.onclick = openIssue;
      btn.classList.remove('set-save');
      btn.textContent = 'ปิด';
      btn.onclick = () => {
        document.getElementById('qaIssueReview').classList.add('hidden');
        document.getElementById('qaIssueReview').classList.remove('qi-done');
        document.getElementById('qaIssueReviewBack').classList.remove('hidden');
        openBtn.classList.add('hidden');
        openBtn.classList.remove('set-save');
        btn.classList.add('set-save');
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
  // ย่อคนละทางตามชนิดของข้อความ เพราะส่วนที่ใช้แยกความต่างอยู่คนละที่:
  //   ชื่อไฟล์ — ชุดเดียวกันขึ้นต้นเหมือนกันหมด (zinga-wallet-test-food-…) ต่างกันที่หาง → เก็บหาง
  //   ชื่อไทย (ล็อกเก่าที่ไม่มีบรรทัด TEST:) — ต่างกันกลางประโยค ("dine-in" กับ "dine-in (Tyro)")
  //     แต่ลงท้ายเหมือนกันเป๊ะ ("…ผ่านแอป Zinga (native, BlueStacks)") → เก็บหัว
  // ย่อผิดทางแล้วชิปสองอันจะอ่านได้เหมือนกันทุกตัวอักษร ซึ่งคือปัญหาที่ป้ายนี้เกิดมาเพื่อแก้พอดี
  function shortTestName(s, max=22){
    const t=String(s==null?'':s).trim();
    if(t.length<=max) return t;
    return /\.[cm]?js$/i.test(t) ? '…'+t.slice(t.length-max+1) : t.slice(0,max-1)+'…';
  }
  // ป้ายบอกว่ารอบนี้มาจากไฟล์เทสไหน — โผล่เฉพาะตอนรู้ชื่อไฟล์จริง (บรรทัด TEST: ในล็อก)
  // ล็อกเก่าที่ไม่มีบรรทัดนั้นได้ป้ายจาง ๆ แทน ไม่ใช่เอาชื่อไทยมาใส่ซ้ำกับข้อความในแถวเดียวกัน
  function qaTestTag(r){
    if(r.testId) return `<span class="qa-tf" title="${esc(r.testId)}">${esc(shortTestName(r.testId))}</span>`;
    return `<span class="qa-tf none" title="ล็อกนี้ไม่มีบรรทัด TEST: — จัดกลุ่มจากชื่อเทสแทน">?</span>`;
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
    // บอกด้วยว่ารูปจะถูกฝังในเนื้อหา ไม่ใช่แค่แนบท้าย — buildIssuePayload เติมแท็ก <img> ให้ตอนส่ง
    // (ไม่โชว์แท็กดิบในหน้า review เพราะเป็น noise ผู้ใช้ไม่ได้พิมพ์เอง)
    const files = form.uploads || [];
    const imgCount = files.filter(u => /^image\//i.test(u.content_type || '')).length;
    lines.push({
      label: 'ไฟล์แนบ',
      value: files.length
        ? files.map(u => u.filename).join(', ') + (imgCount ? ` · ฝังรูปในเนื้อหาให้ ${imgCount} รูป` : '')
        : '(ไม่มี)',
    });
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
      (skip==='test'||qaTestFilter===null||(r.testKey||'')===qaTestFilter) &&
      (skip==='date'||dateMatch(qaDateSel,qaDateOf(r))));
  }
  // รายการไฟล์เทสที่เห็นในผลรัน — จำนวนรอบต่อไฟล์ เรียงจากมากไปน้อย แล้วจึงตามชื่อ
  // key มาจาก main (testId ถ้ามี ไม่งั้นชื่อไทย) ป้ายบนชิปแสดง key ตรง ๆ เพราะชิปมีที่พอ
  function qaTestGroups(list){
    const by=new Map();
    for(const r of list){
      const k=r.testKey||'';
      by.set(k,(by.get(k)||0)+1);
    }
    return [...by.entries()].map(([key,n])=>({key,n}))
      .sort((a,b)=>b.n-a.n||a.key.localeCompare(b.key));
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

    // ชิปกรองตามไฟล์เทส — เหตุผลที่มี: ผลรันของงานเดียวกันหลายสิบรอบมีชื่อไทยเหมือนกันหมด
    // แยกออกได้แค่เวลา ซึ่งไม่ช่วยอะไรตอนอยากดูเฉพาะเทสตัวหนึ่ง
    const inTest=qaExcept('test');
    const groups=qaTestGroups(inTest);
    // ล้างตัวกรองที่ค้างก่อนนับ ด้วยเหตุผลเดียวกับ source ข้างบน (ไฟล์ที่กรองไว้อาจหายไปแล้ว)
    if(qaTestFilter!==null && !groups.some(g=>g.key===qaTestFilter)) qaTestFilter=null;
    const tLabelEl=document.getElementById('qaTestLabel'), tEl=document.getElementById('qaTestChips');
    // มีไฟล์เดียวก็ไม่ต้องมีชิป — ชิป "ทุกไฟล์" กับชิปเดียวที่เหลือให้ผลเหมือนกันเป๊ะ
    if(groups.length>1){
      tLabelEl.style.display=''; tEl.style.display='';
      tEl.innerHTML=`<div class="chip${qaTestFilter===null?' active':''}" data-t="">ทุกไฟล์<span class="n">${qaExcept('test').length}</span></div>`+
        groups.map(g=>`<div class="chip${qaTestFilter===g.key?' active':''}" data-t="${esc(g.key)}" title="${esc(g.key||'ล็อกที่ไม่มีทั้งบรรทัด TEST: และชื่อเทส')}">${esc(shortTestName(g.key,28)||'(ไม่ระบุ)')}<span class="n">${g.n}</span></div>`).join('');
      tEl.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{qaTestFilter=c.dataset.t||null;renderQaChips();renderQaRows()});
    } else {
      tLabelEl.style.display='none'; tEl.style.display='none'; tEl.innerHTML=''; qaTestFilter=null;
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
        ${qaBadge(r.status)}${qaSrcTag(r.sourceLabel)}${qaTestTag(r)}
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
      [...e.target.files].forEach(file => qiUploadFile(file, file.name));
    };
    // คลิกชิปชื่อไฟล์ = แทรกรูปนั้นตรงเคอร์เซอร์ สำหรับไฟล์ที่แนบมาทางปุ่มแล้วอยากย้ายที่เอง
    document.getElementById('qiFileList').onclick = (e) => {
      const chip = e.target.closest('.qi-file-chip');
      if (!chip) return;
      qiInsertAtCursor(document.getElementById('qiDescription'), `<img src="${chip.dataset.fn}">`);
    };
    // วางรูปจากคลิปบอร์ดลงช่องรายละเอียดได้ตรง ๆ (Ctrl+V) — เป็นวิธีที่ทีมใช้อยู่แล้วบนหน้าเว็บ
    // Redmine (ไฟล์แนบใน issue เก่าชื่อ clipboard-*.png) และเป็นทางเดียวที่เลือกตำแหน่งรูปเองได้
    document.getElementById('qiDescription').addEventListener('paste', (e) => {
      const files = qiPastedImages(e);
      if (!files.length) return;   // วางข้อความธรรมดา ปล่อยให้เบราว์เซอร์จัดการเองตามเดิม
      e.preventDefault();
      const desc = document.getElementById('qiDescription');
      files.forEach(file => {
        const filename = qiPastedName(file);
        // แทรกข้อความคั่นไว้ก่อนแล้วค่อยแทนที่ด้วยแท็กจริงตอนอัปโหลดเสร็จ — เห็นผลทันทีที่วาง
        // และไม่พังถ้าผู้ใช้เลื่อนเคอร์เซอร์ไปพิมพ์ที่อื่นระหว่างรออัปโหลด
        const placeholder = `[กำลังอัปโหลด ${filename}]`;
        qiInsertAtCursor(desc, placeholder);
        qiUploadFile(file, filename, placeholder);
      });
    });
    // วางรูปลงช่องโน้ต = ให้โมเดลดูรูปนั้นตอนร่าง ต่างจากช่องรายละเอียดตรงที่ไม่แทรกข้อความใด ๆ
    // ลงในโน้ต เพราะโน้ตทั้งก้อนถูกส่งเป็น prompt แท็ก <img> ในนั้นมีแต่ทำให้โมเดลสับสน
    document.getElementById('qiRawNotes').addEventListener('paste', (e) => {
      const files = qiPastedImages(e);
      if (files.length) {
        e.preventDefault();
        files.forEach(file => qiAttachImageToNotes(file, qiPastedName(file)));
        return;
      }
      // ไม่มีไฟล์รูปเลย เช็คต่อว่าที่วางเป็นข้อความ data:image/...;base64 มั่ว ๆ ไหม (ดูคอมเมนต์
      // qiIsImageDataUrlText) ถ้าใช่ กันไม่ให้มันตกลงไปในโน้ต แล้วเตือนแทนที่จะปล่อยเงียบ ๆ
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (qiIsImageDataUrlText(text)) {
        e.preventDefault();
        const status = document.getElementById('qiDraftStatus');
        status.className = 'set-status err';
        status.textContent = 'นี่คือ "ที่อยู่" ของรูปแบบข้อความ ไม่ใช่ตัวรูป — ก๊อปรูปจริงมาวางแทน (Ctrl+C จากรูปโดยตรง)';
      }
    });
    document.getElementById('qiNotesImages').onclick = (e) => {
      const btn = e.target.closest('.qi-thumb-drop');
      if (!btn) return;
      qiDraftImages.splice(Number(btn.dataset.i), 1);
      qiRenderDraftImages();
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
  }
  function loadSettings(){
    setQaStatus.textContent=''; setQaStatus.className='set-status';
    const api=shell().api;
    api && api.getQaSources && api.getQaSources().then(sources=>{
      qaRows=(sources&&sources.length?sources:[{label:'',path:''}]).map(s=>({label:s.label||'',path:s.path||''}));
      renderSetQaRows();
    });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  // openRun เปิดให้ Testing Room เรียกข้ามโมดูล — ข้อ checklist ที่ผูกกับ auto test เก็บเลข run
  // ไว้ กดแล้วต้องพาไปดู log ของรอบนั้นได้เลย ไม่ใช่ให้ผู้ใช้ไปไล่หาเองในลิสต์
  function openRunById(id){
    const r = qaData && qaData.runs && qaData.runs.find(x => x.id === id);
    if(!r) return false;
    qaOpenRun(r);
    return true;
  }
  global.COWORK.tabs.qatest = { key:'qa', settingsCard:'cardQa', mount, mountSettings, loadSettings, onData, onTheme, openRunById };

  // เปิดทาง node --test แบบเดียวกับ tab-grafana.js / tab-meeting.js / tab-redmine.js
  // เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM — ยกเว้น qiFitImagesToBudget ที่ต้องมี Image/canvas
  // จริงจึงเรียกจาก node --test ไม่ได้ แต่ export ไว้ให้ smoke test ใน Electron เรียกโค้ดตัวจริง
  // ได้ แทนที่จะเขียนโค้ดเลียนแบบขึ้นมาทดสอบเอง (ซึ่งพิสูจน์แค่ว่าของเลียนแบบทำงาน)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      shortTestName, qaTestGroups,
      buildReviewLines, qiDraftBtnLabel, qiThumbsHtml, qiDraftGapsHtml, qiPastedName, qiIsImageDataUrlText,
      qiImageTokens, qiFitPlan, QI_IMAGE_TOKEN_LIMIT, qiFitImagesToBudget,
      qiFitNotice, QI_SAFE_FIT_SCALE, qiCustomFieldsHtml, QI_CUSTOM_FIELD_DEFAULTS,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
