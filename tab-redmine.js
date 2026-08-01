// แท็บ Redmine — งานที่จัดกลุ่มตามสถานะ กรองด้วยโปรเจกต์ / ผู้รับผิดชอบ / ระดับความเสี่ยง
//
// payload = { groups:[{status,issues:[...]}], stats, notes, currentUser, error }
// notes มาพร้อม payload เลย ไม่ได้ยิงขอแยก — โน้ตเก็บในเครื่อง ไม่เคยถูกส่งกลับ Redmine
//
// นาฬิกากับคำทักทายหัวหน้าต่างอยู่ใน #redmineView ก็จริง แต่เป็นของเปลือก ไม่ใช่ของแท็บนี้
// แท็บนี้แตะมันทางเดียวคือส่งชื่อผู้ใช้ให้ผ่าน shell.setUserName()
//
// CSS อยู่ใน tab-redmine.css ยกเว้น .chips/.chip, .stats/.stat และ .not-configured ที่ใช้ร่วมทุกแท็บ
(function (global) {
  'use strict';
  const {esc, hashN, timeAgo} = global.COWORK.util;
  const shell = () => global.COWORK.shell;   // เปลือกสร้างทีหลังไฟล์นี้ ต้องหยิบตอนเรียกใช้
  // ผูกค่าตอน mount() แทนที่จะ destructure ตอนโหลด — จุดที่ใช้ api ทุกจุดอยู่ใน callback
  // ที่ทำงานหลัง mount ทั้งหมด ทำแบบนี้แล้วโค้ดข้างล่างเขียน api เฉย ๆ ได้เหมือนตอนอยู่ใน widget.html
  let api=null;

  // Redmine tasks, grouped by status, filtered by a multi-select project set
  const STATUS_COLOR={'In Progress':'var(--accent)','New':'var(--cyan)','Test':'var(--amber)',
    'Backlog':'var(--dim)','Resolved':'var(--green)','Closed':'var(--dim)'};
  function projColor(key){ return 'pc'+hashN(key,6); }
  function whoColor(key){ return 'wc'+hashN(key,6); }
  const RISK_ORDER=['Low','Fairly Low','Moderate','Medium','High'];
  const RISK_COLORS=['var(--green)','var(--cyan)','var(--amber)','var(--orange)','var(--rose)'];
  let lastPayload=null, activeStatus=null;
  let notes={};   // set from payload.notes in renderTasks(), before renderPanel() runs — never fetched separately
  const selectedProjects=new Set();    // empty = show all projects
  const selectedAssignees=new Set();   // empty = show all assignees
  let selectedRisk=null;   // null = ทั้งหมด; 'none' = ไม่ระบุ; else exact risk string
  function issueMatch(i){
    return (selectedProjects.size===0 || selectedProjects.has(i.project))
        && (selectedAssignees.size===0 || selectedAssignees.has(i.assignee))
        && (selectedRisk===null || (selectedRisk==='none' ? !i.risk : i.risk===selectedRisk));
  }
  function allIssues(){ return lastPayload.groups.flatMap(g=>g.issues); }
  function openIssues(){ return allIssues().filter(i=>!i.closed && i.status!=='Backlog'); } // ALL tab = only open work, excluding Backlog
  function statusIssues(status){
    const g=lastPayload.groups.find(g=>g.status===status);
    return (g?g.issues:[]).filter(issueMatch);
  }

  // ===== ค้นหา — ทำฝั่ง renderer ล้วน ๆ =====
  // payload มี issue ครบทุกสถานะอยู่แล้ว (main.js:320 ดึง status_id=* ไล่หน้าจนหมด)
  // จึงไม่ต้องยิง /search.json และค้นโน้ตส่วนตัวที่ไม่เคยขึ้น Redmine ได้ด้วย
  let searchQuery='';
  function parseTerms(q){ return String(q==null?'':q).trim().toLowerCase().split(/\s+/).filter(Boolean); }
  // '#' ติดไปกับเลขด้วย ทั้ง "550" และ "#550" จึงเจอ #550 เหมือนกัน
  function issueHay(issue, noteText){
    return ('#'+issue.id+' '+(issue.subject||'')+' '+(issue.project||'')+' '
           +(issue.assignee||'')+' '+(noteText||'')).toLowerCase();
  }
  function matchTerms(hay, terms){ return terms.every(t=>hay.includes(t)); }
  function termsHitNote(noteText, terms){
    if(!noteText || !terms.length) return false;
    const h=noteText.toLowerCase();
    return terms.some(t=>h.includes(t));
  }
  // เปิดก่อนปิด แล้วใหม่→เก่า · updatedOn คือ issue.updated_on ของ Redmine ตรง ๆ (main.js:372)
  // เป็น ISO UTC ความยาวคงที่ เทียบแบบ string ได้ ไม่ต้องแปลงเป็น Date
  function sortForSearch(list){
    return list.slice().sort((a,b)=>
      (a.closed?1:0)-(b.closed?1:0) ||
      String(b.updatedOn||'').localeCompare(String(a.updatedOn||'')));
  }

  // ตัวคิดเลขทั้งแท็บ — บริสุทธิ์ ไม่แตะ DOM ไม่อ่านตัวแปรระดับโมดูล
  // renderer ทุกตัวรับตัวเลขจากที่นี่ที่เดียว "เลขบนแท็บ ≠ แถวข้างล่าง" จึงเป็นไปไม่ได้
  // กฎการนับ (สเปก 2026-08-01-redmine-search-design.md):
  //   คีย์ชิป มาจาก issue ทั้งก้อนเสมอ → ชิปที่เลือกอยู่ไม่มีวันหายจนกดปิดไม่ได้
  //   ตัวเลข  นับจาก searched (คำค้นหักแล้ว) แต่ไม่ถูกหักด้วยชิปแถวอื่น = พฤติกรรมเดิม
  //   ALL     ไม่ค้น = งานที่ยังเปิดและไม่ใช่ Backlog · ค้นอยู่ = ทุกสถานะ
  function viewModel(payload, notes, state){
    const groups=(payload&&payload.groups)||[];
    const all=groups.flatMap(g=>g.issues);
    const terms=parseTerms(state.query);
    const searching=terms.length>0;
    const noteOf=i=>{ const n=notes&&notes[String(i.id)]; return (n&&n.text)||''; };
    const searched=all.filter(i=>matchTerms(issueHay(i,noteOf(i)),terms));
    const hit=new Set(searched.map(i=>i.id));

    const selProj=new Set(state.selectedProjects||[]);
    const selAsg=new Set(state.selectedAssignees||[]);
    const selRisk=state.selectedRisk==null?null:state.selectedRisk;
    const chipMatch=i=>
         (selProj.size===0||selProj.has(i.project))
      && (selAsg.size===0||selAsg.has(i.assignee))
      && (selRisk===null||(selRisk==='none'?!i.risk:i.risk===selRisk));

    const chipsOf=(keyFn,selected)=>{
      const counts=new Map();
      all.forEach(i=>{ const k=keyFn(i); if(!counts.has(k)) counts.set(k,{open:0,closed:0}); });
      searched.forEach(i=>{ const c=counts.get(keyFn(i)); i.closed?c.closed++:c.open++; });
      return [...counts.keys()].sort().map(k=>{
        const c=counts.get(k);
        return {key:k, open:c.open, closed:c.closed, selected:selected.has(k), zero:c.open+c.closed===0};
      });
    };
    const oc=list=>({open:list.filter(i=>!i.closed).length, closed:list.filter(i=>i.closed).length});
    const riskRows=[
      Object.assign({key:'all'}, oc(searched), {active:selRisk===null}),
      ...RISK_ORDER.map(r=>Object.assign({key:r}, oc(searched.filter(i=>i.risk===r)), {active:selRisk===r})),
      Object.assign({key:'none'}, oc(searched.filter(i=>!i.risk)), {active:selRisk==='none'}),
    ];

    const allBase=searching?searched:searched.filter(i=>!i.closed&&i.status!=='Backlog');
    const allList=allBase.filter(chipMatch);
    const statusTabs=groups.map(g=>({
      status:g.status,
      count:g.issues.filter(i=>hit.has(i.id)&&chipMatch(i)).length,
      active:state.activeStatus===g.status,
    }));
    const raw=state.activeStatus==='ALL'
      ? allList
      : (groups.find(g=>g.status===state.activeStatus)||{issues:[]}).issues
          .filter(i=>hit.has(i.id)&&chipMatch(i));
    const list=(searching?sortForSearch(raw):raw)
      .map(i=>({issue:i, noteHit:termsHitNote(noteOf(i),terms)}));

    return {
      searching, query:String(state.query==null?'':state.query),
      projectChips:chipsOf(i=>i.project,selProj),
      assigneeChips:chipsOf(i=>i.assignee,selAsg),
      riskRows, statusTabs,
      allTab:{count:allList.length, active:state.activeStatus==='ALL'},
      list,
    };
  }

  let visibleCount=15; // reset to 15 whenever the tab/filters change; "load more" just bumps this
  function renderPanel(){
    const el=document.getElementById('tasks');
    const allMatching=activeStatus==='ALL'?openIssues().filter(issueMatch):statusIssues(activeStatus);
    if(!allMatching.length){ el.innerHTML='<div class="hint">ไม่มีงานในสถานะนี้</div>'; return; }
    const issues=allMatching.slice(0,visibleCount);
    el.innerHTML='';
    issues.forEach(issue=>{
      const row=document.createElement('div');
      row.className='task'+(issue.overdue?' overdue':'');
      const rank=RISK_ORDER.indexOf(issue.risk);
      const riskCls=rank>=0?`rk${rank}`:'rk-none';
      const riskTxt=issue.risk||'–';
      const idColor=STATUS_COLOR[issue.status]||'var(--dim)';
      row.innerHTML=`
        <span class="idnum" style="color:${idColor}" title="${esc(issue.status)}">#${issue.id}</span>
        <div class="tmain">
          <div class="t">${esc(issue.subject)}</div>
          <div class="tip">สร้าง <b>${timeAgo(issue.createdOn)}</b> · แก้ไข <b>${timeAgo(issue.updatedOn)}</b></div>
        </div>
        <span class="proj ${projColor(issue.project)}" title="${esc(issue.project)}">${esc(issue.project)}</span>
        <span class="who ${whoColor(issue.assignee)}" title="${esc(issue.assignee)}">${esc(issue.assignee)}</span>
        <span class="risk ${riskCls}" title="Risk: ${esc(issue.risk||'ไม่ระบุ')}">${esc(riskTxt)}</span>`;
      row.onclick=()=>api&&api.openLink&&api.openLink(issue.url);
      const slot=document.createElement('div');
      if(issue.status==='Resolved') row.appendChild(makeCloseBtn(issue.id, slot));
      row.appendChild(makeNoteBtn(issue.id, slot));
      el.appendChild(row);
      el.appendChild(slot);
    });
    if(allMatching.length>visibleCount){
      const moreBtn=document.createElement('button');
      moreBtn.className='loadMoreBtn';
      moreBtn.textContent=`โหลดเพิ่ม (เหลืออีก ${allMatching.length-visibleCount})`;
      moreBtn.onclick=()=>{ visibleCount+=15; renderPanel(); };
      el.appendChild(moreBtn);
    }
  }
  // both the close-issue preview and the private-note panel render into the same
  // per-row `slot` (a sibling element right after the row) — only one panel of
  // either kind is open at a time, tracked via slot.dataset.kind
  function clearSlot(slot){ slot.innerHTML=''; delete slot.dataset.kind; delete slot._attemptClose; }
  function closeAllPanels(){ document.querySelectorAll('[data-kind]').forEach(clearSlot); }
  // icon button: click fetches the issue's history + Test Results field and opens a preview
  // panel in `slot` for review before closing
  function makeCloseBtn(issueId, slot){
    const btn=document.createElement('button');
    btn.className='closeBtn'; btn.textContent='✓'; btn.title='ปิดงาน (Resolved → Closed)';
    btn.onclick=(e)=>{
      e.stopPropagation();
      if(slot.dataset.kind==='close'){ closeAllPanels(); return; } // toggle closed if already open
      closeAllPanels(); // only one panel open at a time, across the whole list
      btn.classList.add('pending'); btn.title='กำลังโหลดประวัติ...';
      api.getIssuePreview(issueId).then(result=>{
        btn.classList.remove('pending'); btn.title='ปิดงาน (Resolved → Closed)';
        if(!result || !result.ok){
          btn.classList.add('err');
          btn.title='โหลดประวัติไม่สำเร็จ: '+((result&&result.error)||'ไม่ทราบสาเหตุ');
          setTimeout(()=>btn.classList.remove('err'),2000);
          return;
        }
        slot.dataset.kind='close';
        renderTestPreview(slot, issueId, result);
      });
    };
    return btn;
  }
  function notePreview(text){ return text.length>60 ? text.slice(0,60)+'…' : text; }
  // icon button: opens/closes the private note panel for this issue in `slot`.
  // Local-only — the note text never leaves this machine via any Redmine call.
  function makeNoteBtn(issueId, slot){
    const btn=document.createElement('button');
    const existing=notes[String(issueId)];
    btn.className='noteBtn'+(existing?' has':'');
    btn.textContent='📝';
    btn.title=existing?('โน้ต: '+notePreview(existing.text)):'เพิ่มโน้ตส่วนตัว';
    btn.onclick=(e)=>{
      e.stopPropagation();
      if(slot.dataset.kind==='note'){ (slot._attemptClose||closeAllPanels)(); return; }
      closeAllPanels();
      slot.dataset.kind='note';
      renderNotePanel(slot, issueId);
    };
    return btn;
  }
  function renderNotePanel(slot, issueId){
    const existing=notes[String(issueId)];
    const original=existing?existing.text:'';
    const panel=document.createElement('div');
    panel.className='notePanel';
    panel.onclick=e=>e.stopPropagation();
    panel.innerHTML=`
      <div class="np-label"><span>📝 โน้ตส่วนตัว · #${issueId}</span><span class="local">เก็บบนเครื่องนี้ · ไม่ส่งไป Redmine</span></div>
      <textarea class="np-edit" placeholder="จดอะไรก็ได้ที่ไม่อยากให้ใครเห็น…">${esc(original)}</textarea>
      <div class="np-actions">
        <button class="save">บันทึก</button>
        <button class="cancel">ยกเลิก</button>
        ${existing?`<span class="np-stamp">แก้ไขล่าสุด ${timeAgo(existing.updatedAt)}</span><button class="del">ลบโน้ต</button>`:''}
      </div>
      <div class="np-err" style="display:none"></div>`;
    slot.appendChild(panel);
    const textarea=panel.querySelector('.np-edit');
    const saveBtn=panel.querySelector('.save');
    const showErr=msg=>{ const err=panel.querySelector('.np-err'); err.style.display='block'; err.textContent=msg; };
    function doSave(){
      const val=textarea.value.trim();
      saveBtn.disabled=true; saveBtn.textContent='กำลังบันทึก...';
      api.saveNote(issueId, val).then(result=>{
        saveBtn.disabled=false; saveBtn.textContent='บันทึก';
        if(!result || !result.ok){ showErr('บันทึกไม่สำเร็จ: '+((result&&result.error)||'ไม่ทราบสาเหตุ')); return; }
        if(val) notes[String(issueId)]={text:val, updatedAt:new Date().toISOString()};
        else delete notes[String(issueId)];
        clearSlot(slot);
        renderPanel();
      });
    }
    function attemptClose(){
      if(textarea.value.trim()!==original.trim() && !confirm('มีข้อความที่ยังไม่ได้บันทึก ปิดทิ้งเลยไหม?')) return;
      clearSlot(slot);
    }
    slot._attemptClose=attemptClose;
    panel.querySelector('.save').onclick=doSave;
    panel.querySelector('.cancel').onclick=attemptClose;
    const delBtn=panel.querySelector('.del');
    if(delBtn) delBtn.onclick=()=>{
      delBtn.disabled=true;
      api.saveNote(issueId,'').then(result=>{
        delBtn.disabled=false;
        if(!result || !result.ok){ showErr('ลบไม่สำเร็จ: '+((result&&result.error)||'ไม่ทราบสาเหตุ')); return; }
        delete notes[String(issueId)];
        clearSlot(slot);
        renderPanel();
      });
    };
    textarea.addEventListener('keydown',e=>{
      if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); doSave(); }
      else if(e.key==='Escape'){ e.preventDefault(); attemptClose(); }
    });
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
  function renderTestPreview(slot, issueId, {historyText, testResults}){
    const panel=document.createElement('div');
    panel.className='testPreview';
    const historyBlock=historyText
      ? `<div class="tp-block">${esc(historyText)}</div>`
      : `<div class="tp-block empty">ไม่มี comment ในประวัติ</div>`;
    if(!testResults){
      panel.innerHTML=`
        <div class="tp-warn">งานนี้ไม่มี field "Test Results" ในโปรเจกต์/tracker นี้ จึงปิดงานจากตรงนี้ไม่ได้</div>
        <div class="tp-label">ประวัติที่รวบรวมได้</div>
        ${historyBlock}
        <div class="tp-actions"><button class="cancel">ปิด</button></div>`;
      panel.querySelector('.cancel').onclick=(e)=>{ e.stopPropagation(); clearSlot(slot); };
      slot.appendChild(panel);
      return;
    }
    panel.innerHTML=`
      <div class="tp-label">Test Results (แก้ไขได้)</div>
      <textarea class="tp-edit" placeholder="ยังไม่มีข้อมูล — ดูประวัติด้านล่างแล้วเขียน/แก้ไขผล test ที่นี่">${esc(testResults.value||'')}</textarea>
      <div class="tp-label">ประวัติที่รวบรวมได้</div>
      ${historyBlock}
      <div class="tp-actions">
        <button class="confirm">ยืนยันและปิดงาน</button>
        <button class="cancel">ยกเลิก</button>
      </div>`;
    panel.querySelector('.cancel').onclick=(e)=>{ e.stopPropagation(); clearSlot(slot); };
    const confirmBtn=panel.querySelector('.confirm');
    confirmBtn.onclick=(e)=>{
      e.stopPropagation();
      const newValue=panel.querySelector('.tp-edit').value;
      confirmBtn.disabled=true; confirmBtn.classList.add('pending'); confirmBtn.textContent='กำลังปิดงาน...';
      api.closeIssue(issueId, { id: testResults.fieldId, value: newValue }).then(result=>{
        if(!result || !result.ok){
          confirmBtn.disabled=false; confirmBtn.classList.remove('pending'); confirmBtn.textContent='ยืนยันและปิดงาน';
          let err=panel.querySelector('.tp-err');
          if(!err){ err=document.createElement('div'); err.className='tp-err'; panel.appendChild(err); }
          err.textContent='ปิดงานไม่สำเร็จ: '+((result&&result.error)||'ไม่ทราบสาเหตุ');
          return;
        }
        // success: main process refetches tasks; this row + panel disappear once the new payload renders
      });
    };
    slot.appendChild(panel);
  }
  function renderTabs(){
    const tabsEl=document.getElementById('tabs');
    tabsEl.innerHTML='';
    // ALL tab (default) — every status combined
    const allTab=document.createElement('div');
    allTab.className='tab'+(activeStatus==='ALL'?' active':'');
    allTab.style.setProperty('--sc','var(--accent)');
    allTab.innerHTML=`<span class="dot"></span>ALL<span class="n">${openIssues().filter(issueMatch).length}</span>`;
    allTab.onclick=()=>{ activeStatus='ALL'; visibleCount=15; renderTabs(); renderPanel(); };
    tabsEl.appendChild(allTab);
    lastPayload.groups.forEach(g=>{
      const tab=document.createElement('div');
      tab.className='tab'+(g.status===activeStatus?' active':'');
      tab.style.setProperty('--sc', STATUS_COLOR[g.status]||'var(--dim)');
      tab.innerHTML=`<span class="dot"></span>${esc(g.status)}<span class="n">${statusIssues(g.status).length}</span>`;
      tab.onclick=()=>{ activeStatus=g.status; visibleCount=15; renderTabs(); renderPanel(); };
      tabsEl.appendChild(tab);
    });
  }
  const ocSpan=(o,c)=>`<span class="n"><span class="o">${o}</span><span class="sep">/</span><span class="c">${c}</span></span>`;
  function renderChipFilter(elId, keyFn, selected){
    const el=document.getElementById(elId);
    el.innerHTML='';
    const counts=new Map();
    allIssues().forEach(i=>{
      const k=keyFn(i);
      if(!counts.has(k)) counts.set(k,{open:0,closed:0});
      const c=counts.get(k);
      i.closed?c.closed++:c.open++;
    });
    [...counts.keys()].sort().forEach(k=>{
      const chip=document.createElement('div');
      chip.className='chip'+(selected.has(k)?' active':'');
      const c=counts.get(k);
      chip.innerHTML=`${esc(k)}${ocSpan(c.open,c.closed)}`;
      chip.onclick=()=>{
        selected.has(k)?selected.delete(k):selected.add(k);
        visibleCount=15; renderFilters(); renderTabs(); renderPanel();
      };
      el.appendChild(chip);
    });
  }
  function renderRiskFilter(){
    const el=document.getElementById('riskFilter');
    el.innerHTML='';
    const issues=allIssues();
    const oc=list=>({open:list.filter(i=>!i.closed).length,closed:list.filter(i=>i.closed).length});
    const mk=(cls,sc,label,list,onclick)=>{
      const tab=document.createElement('div');
      tab.className='tab'+cls;
      tab.style.setProperty('--sc',sc);
      const c=oc(list);
      tab.innerHTML=`<span class="dot"></span>${esc(label)}${ocSpan(c.open,c.closed)}`;
      tab.onclick=onclick;
      el.appendChild(tab);
    };
    mk(selectedRisk===null?' active':'','var(--accent)','ทั้งหมด',issues,
      ()=>{ selectedRisk=null; visibleCount=15; renderRiskFilter(); renderTabs(); renderPanel(); });
    RISK_ORDER.forEach((r,idx)=>{
      const list=issues.filter(i=>i.risk===r);
      mk(selectedRisk===r?' active':'',RISK_COLORS[idx],r,list,
        ()=>{ selectedRisk=(selectedRisk===r?null:r); visibleCount=15; renderRiskFilter(); renderTabs(); renderPanel(); });
    });
    const noneList=issues.filter(i=>!i.risk);
    mk(selectedRisk==='none'?' active':'','var(--dim)','ไม่ระบุ',noneList,
      ()=>{ selectedRisk=(selectedRisk==='none'?null:'none'); visibleCount=15; renderRiskFilter(); renderTabs(); renderPanel(); });
  }
  function renderFilters(){
    renderChipFilter('projectFilter', i=>i.project, selectedProjects);
    renderChipFilter('assigneeFilter', i=>i.assignee, selectedAssignees);
    renderRiskFilter();
  }
  let closedYearsOpen=false;
  function renderRmStats(stats){
    const el=document.getElementById('rmStats');
    if(!stats){ el.innerHTML=''; return; }
    const cells=[
      ['open',stats.open,'var(--accent)'],
      ['high risk',stats.highRisk,'var(--rose)'],
      ['overdue',stats.overdue,'var(--amber)'],
    ];
    const closedYears=stats.closedByYear||[];
    const yearsHtml=closedYears.map(y=>
      `<div class="yr"><span>${esc(y.label)}</span><b>${y.count}</b></div>`).join('');
    el.innerHTML=cells.map(([l,n,c])=>
      `<div class="stat" style="--sc:${c}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join('')
      + `<div class="stat${closedYears.length?' expandable':''}${closedYears.length&&closedYearsOpen?' open':''}" style="--sc:var(--dim)" id="closedStat">
           <div class="n">${stats.closed}</div><div class="l">closed${closedYears.length?'<i class="chev2">›</i>':''}</div>
           <div class="years">${yearsHtml}</div>
         </div>`;
    const closedEl=document.getElementById('closedStat');
    if(closedEl && closedYears.length){
      closedEl.onclick=()=>{ closedYearsOpen=!closedYearsOpen; renderRmStats(stats); };
    }
  }
  function onData(payload){
    const el=document.getElementById('tasks');
    document.getElementById('tabs').innerHTML='';
    document.getElementById('projectFilter').innerHTML='';
    document.getElementById('assigneeFilter').innerHTML='';
    document.getElementById('riskFilter').innerHTML='';
    shell().setUserName(payload.currentUser);
    renderRmStats(payload.stats);
    if(payload.error){
      if(payload.error==='ยังไม่ได้ตั้งค่า Redmine'){
        el.innerHTML=`<div class="not-configured">
          <p>ยังไม่ได้ตั้งค่า Redmine URL และ API key — ตั้งค่าก่อนถึงจะดึงงานได้</p>
          <button id="notConfiguredBtn">ตั้งค่าเลย</button>
        </div>`;
        document.getElementById('notConfiguredBtn').onclick=()=>shell().openSettings('cardRedmine');
      } else {
        el.innerHTML=`<div class="hint">โหลด Redmine ไม่สำเร็จ: ${esc(payload.error)}</div>`;
      }
      return;
    }
    if(!payload.groups || !payload.groups.length){ el.innerHTML='<div class="hint">ไม่มีงานค้าง</div>'; return; }
    lastPayload=payload;
    notes=payload.notes||{};
    // drop selections that no longer exist
    const projNames=new Set(allIssues().map(i=>i.project));
    const asgNames=new Set(allIssues().map(i=>i.assignee));
    [...selectedProjects].forEach(p=>{ if(!projNames.has(p)) selectedProjects.delete(p); });
    [...selectedAssignees].forEach(a=>{ if(!asgNames.has(a)) selectedAssignees.delete(a); });
    const riskValues=new Set(allIssues().map(i=>i.risk).filter(Boolean));
    if(selectedRisk && selectedRisk!=='none' && !riskValues.has(selectedRisk)) selectedRisk=null;
    if(!activeStatus || (activeStatus!=='ALL' && !payload.groups.some(g=>g.status===activeStatus))){
      activeStatus='ALL';
    }
    renderFilters(); renderTabs(); renderPanel();
  }

  function mount(){
    api=shell().api;
    api && api.onTasks && api.onTasks(onData);
  }

  // ===== การ์ดตั้งค่าของแท็บนี้ =====
  // markup ของการ์ดอยู่ใน widget.html เหมือนเดิม (เปลือกเป็นเจ้าของ markup ทุก view)
  // ที่ย้ายมาคือสายไฟ: mountSettings ผูกปุ่มครั้งเดียวตอน boot, loadSettings ดึงค่าทุกครั้งที่เปิดหน้า
  let setUrl,setKey,setStatus,setSave;
  function mountSettings(){
    setUrl=document.getElementById('setUrl'); setKey=document.getElementById('setKey');
    setStatus=document.getElementById('setStatus'); setSave=document.getElementById('setSave');
    setSave.onclick=()=>{
      const url=setUrl.value.trim(), apiKey=setKey.value.trim();
      if(!url || !apiKey){ setStatus.className='set-status err'; setStatus.textContent='กรอก URL และ API key ให้ครบ'; return; }
      setSave.disabled=true; setStatus.className='set-status'; setStatus.textContent='กำลังทดสอบการเชื่อมต่อ...';
      api.testRedmineConnection({url,apiKey}).then(result=>{
        if(!result || !result.ok){
          setSave.disabled=false;
          setStatus.className='set-status err';
          setStatus.textContent='เชื่อมต่อไม่สำเร็จ: '+((result&&result.error)||'ไม่ทราบสาเหตุ');
          return;
        }
        api.saveRedmineConfig({url,apiKey}).then(()=>{
          setSave.disabled=false;
          setStatus.className='set-status ok';
          setStatus.textContent='บันทึกแล้ว · สวัสดี '+result.userName;
        });
      });
    };
  }
  function loadSettings(){
    setStatus.textContent=''; setStatus.className='set-status';
    api && api.getRedmineConfig && api.getRedmineConfig().then(cfg=>{
      setUrl.value=(cfg&&cfg.url)||''; setKey.value=(cfg&&cfg.apiKey)||'';
    });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.tabs.redmine = { key:"rm", settingsCard:'cardRedmine', mount, mountSettings, loadSettings, onData };

  // เปิดทาง node --test แบบเดียวกับ tab-grafana.js / tab-meeting.js
  // เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM — พวกนี้คือที่เก็บกฎที่พลาดแล้วเงียบ:
  // ตัวเลขบนแท็บต้องเท่าจำนวนแถวที่เห็น · ชิปที่ถูกเลือกต้องมีให้กดปิดเสมอ
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseTerms, issueHay, matchTerms, termsHitNote, sortForSearch, viewModel };
  }
})(typeof window !== 'undefined' ? window : globalThis);
