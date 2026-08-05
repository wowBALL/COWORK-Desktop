// แท็บ Workspace — สรุป A_Workspace vault: การ์ดโปรเจกต์, ฟีดบันทึกรายวัน, บทเรียน/แผนรับมือ
//
// โมดูลแท็บตัวแรกตามสัญญาที่ v1.8.3 วางไว้ (ดู meetingrun.js ที่เป็นต้นแบบ):
// เปลือกรู้จักแค่ key/mount/onData ไม่รู้ว่าข้างในวาดอะไร ส่วนโมดูลก็ไม่รู้จัก
// element ของแท็บอื่นเลย — คุยกับเปลือกผ่าน COWORK.shell เท่านั้น
//
// CSS ยังอยู่ใน widget.html — 18 บรรทัด ยังไม่คุ้มที่จะแยกไฟล์
(function (global) {
  'use strict';
  const {esc, hashN} = global.COWORK.util;

  // COWORK.shell ถูกสร้างในสคริปต์ของ widget.html ซึ่งรันทีหลังไฟล์นี้ จึงต้องหยิบตอนเรียกใช้
  // ไม่ใช่ตอนโหลด — ถ้า destructure ไว้บนสุดจะได้ undefined
  const shell = () => global.COWORK.shell;

  const ST_META={
    active:{c:'var(--green)',t:'🟢 กำลังทำ',label:'กำลังทำ'},
    pause :{c:'var(--amber)',t:'🟡 พัก',   label:'พัก'},
    done  :{c:'var(--dim)',  t:'✅ จบแล้ว',label:'จบแล้ว'},
    dropped:{c:'var(--rose)',t:'⛔ ปิดโปรเจกต์',label:'ปิดแล้ว'},
    unknown:{c:'var(--dim)', t:'– ไม่ระบุ',label:'ไม่ระบุ'},
  };
  const PROJ_HUES=['var(--accent)','var(--green)','var(--amber)','var(--rose)','var(--cyan)','var(--violet)'];
  const hueOf=key=>PROJ_HUES[hashN(key,PROJ_HUES.length)];   // hashN ตัวเดียวกับที่ Redmine ใช้แจกสีโปรเจกต์

  let wsData=null;
  let wsView='today';          // 'today' | 'projects' | 'knowledge'
  let wsProjectOpen=null;      // file path of the project currently shown in the detail panel, or null
  const wsStatSel=new Set();
  let wsQuery='';
  let wsKnowQuery='';
  const wsKnowTypeSel=new Set();   // 'lesson'|'ref'|'rule'|'playbook'
  const wsKnowTagSel=new Set();
  function openFile(p){ shell().openFile(p); }

  const SEGMENTS=[['today','วันนี้'],['projects','โปรเจกต์'],['knowledge','ความรู้']];
  // สร้างทีละ node ด้วย createElement แล้วผูก .onclick ตรงบน node นั้นเลย — ไม่ใช้
  // innerHTML+querySelectorAll เพราะโค้ดฐานนี้ (ดู tab-redmine.js renderTabs) ไม่ใช้แพตเทิร์นนั้น
  // และ query selector จำลองในเทสต์ไม่รองรับด้วย
  function renderWsSegments(){
    const el=document.getElementById('wsSegments');
    el.innerHTML='';
    SEGMENTS.forEach(([k,label])=>{
      const chip=document.createElement('div');
      chip.className='chip'+(wsView===k?' active':'');
      chip.textContent=label;
      chip.onclick=()=>{
        wsView=k;
        if(wsView!=='projects') wsProjectOpen=null;   // leaving Projects closes any open detail panel
        renderWsViewVisibility();
      };
      el.appendChild(chip);
    });
  }
  function renderWsViewVisibility(){
    renderWsSegments();
    document.getElementById('wsToday').classList.toggle('hidden', wsView!=='today');
    document.getElementById('wsProjectsView').classList.toggle('hidden', wsView!=='projects' || !!wsProjectOpen);
    document.getElementById('wsProjectDetail').classList.toggle('hidden', wsView!=='projects' || !wsProjectOpen);
    document.getElementById('wsKnowledgeView').classList.toggle('hidden', wsView!=='knowledge');
  }

  function renderWsStats(){
    const s=(wsData&&wsData.stats)||{};
    const cells=[
      ['กำลังทำ',s.active,'var(--green)'],
      ['งานค้าง',s.tasks,'var(--amber)'],
      ['บทเรียน',s.lessons,'var(--cyan)'],
    ];
    document.getElementById('wsStats').innerHTML=cells.map(([l,n,c])=>
      `<div class="stat" style="--sc:${c}"><div class="n">${n||0}</div><div class="l">${l}</div></div>`).join('');
  }
  function renderWsRulesBox(){
    const el=document.getElementById('wsRulesBox');
    el.innerHTML='';
    const rules=(wsData&&wsData.rules)||[];
    if(!rules.length) return;
    const details=document.createElement('details'); details.className='ws-details';
    const summary=document.createElement('summary'); summary.textContent=`⚠️ กติกาที่ต้องรู้ (${rules.length})`;
    details.appendChild(summary);
    const list=document.createElement('div'); list.className='ws-rules-list';
    rules.forEach(r=>{
      const item=document.createElement('div'); item.className='ws-rule-item';
      item.textContent=r.name;
      item.onclick=()=>openFile(r.file);
      list.appendChild(item);
    });
    details.appendChild(list);
    el.appendChild(details);
  }
  function renderWsTasks(){
    const el=document.getElementById('wsTasks');
    const projects=(wsData&&wsData.projects)||[];
    const withTasks=projects.filter(p=>p.tasks&&p.tasks.length);
    if(!withTasks.length){ el.innerHTML='<div class="empty">ไม่มีงานค้าง</div>'; return; }
    el.innerHTML=withTasks.slice(0,10).map(p=>
      `<div class="ws-task-group"><div class="ws-task-proj">${esc(p.name)}</div>` +
      p.tasks.slice(0,5).map(t=>`<div class="ws-task-item">- ${esc(t)}</div>`).join('') +
      `</div>`).join('');
  }
  function renderWsFeed(){
    const el=document.getElementById('wsFeed');
    const files=((wsData&&wsData.daily)||[]).filter(d=>d.entries&&d.entries.length);
    if(!files.length){ el.innerHTML='<div class="empty">ยังไม่มีบันทึกรายวัน</div>'; return; }
    const byDate=new Map();
    files.forEach(d=>d.entries.forEach(e=>{
      if(!byDate.has(d.date)) byDate.set(d.date,new Map());
      const projs=byDate.get(d.date);
      if(!projs.has(e.project)) projs.set(e.project,[]);
      const arr=projs.get(e.project);
      if(!arr.some(x=>x.text===e.text)) arr.push({text:e.text,file:d.file});
    }));
    const dates=[...byDate.keys()].sort((a,b)=>b.localeCompare(a)).slice(0,3);
    el.innerHTML='';
    dates.forEach(date=>{
      const projs=byDate.get(date);
      const day=document.createElement('div'); day.className='day';
      day.innerHTML=`<div class="dhead"><span class="ddate">${esc(date)}</span>
        <span class="dsub">${projs.size} โปรเจกต์อัปเดต</span></div>`;
      projs.forEach((items,project)=>{
        const en=document.createElement('div'); en.className='entry';
        en.style.setProperty('--pc',hueOf(project));
        const texts=items.map(it=>
          `<div class="ptext" data-file="${esc(it.file)}" title="คลิกเพื่อย่อ/ขยาย">${esc(it.text)}</div>`).join('');
        en.innerHTML=`<div class="rail"><span class="pin"></span><span class="ln"></span></div>
          <div class="content"><div class="pname">${esc(project)}</div>${texts}</div>`;
        en.querySelectorAll('.ptext').forEach(t=>t.onclick=()=>t.classList.toggle('expanded'));
        day.appendChild(en);
      });
      el.appendChild(day);
    });
  }
  function renderWsToday(){
    renderWsStats(); renderWsRulesBox(); renderWsTasks(); renderWsFeed();
  }
  function wsProjectsFiltered(){
    if(!wsData||!wsData.projects) return [];
    const terms=wsQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return wsData.projects.filter(p=>{
      const hay=(p.name+' '+(p.path||'')+' '+(p.desc||'')).toLowerCase();
      return (wsStatSel.size===0 || wsStatSel.has(p.status)) && terms.every(t=>hay.includes(t));
    });
  }
  // createElement ทีละ chip + ผูก .onclick ตรง node เดียวกับที่ Task 23 ทำกับ renderWsSegments
  // (ไม่ใช้ innerHTML+querySelectorAll — เหตุผลเดียวกับที่อธิบายไว้ใน Task 23 Step 1)
  function renderWsStatusChips(){
    const ps=(wsData&&wsData.projects)||[];
    const stEl=document.getElementById('wsStatus');
    stEl.innerHTML='';
    const allChip=document.createElement('div');
    allChip.className='chip'+(wsStatSel.size===0?' active':'');
    allChip.innerHTML=`ทั้งหมด<span class="n">${ps.length}</span>`;
    allChip.onclick=()=>{ wsStatSel.clear(); renderWsStatusChips(); renderWsProjects(); };
    stEl.appendChild(allChip);
    const order=['active','pause','dropped','done','unknown'];
    order.filter(k=>ps.some(p=>p.status===k)).forEach(k=>{
      const n=ps.filter(p=>p.status===k).length;
      const chip=document.createElement('div');
      chip.className='chip'+(wsStatSel.has(k)?' active':'');
      chip.innerHTML=`<span class="dot" style="--cc:${ST_META[k].c}"></span>${ST_META[k].label}<span class="n">${n}</span>`;
      chip.onclick=()=>{
        const only=wsStatSel.size===1 && wsStatSel.has(k);
        wsStatSel.clear();
        if(!only) wsStatSel.add(k);
        renderWsStatusChips(); renderWsProjects();
      };
      stEl.appendChild(chip);
    });
  }
  function renderWsProjects(){
    renderWsStatusChips();
    const el=document.getElementById('wsProjects');
    const list=wsProjectsFiltered();
    if(!list.length){
      el.innerHTML=`<div class="empty">${wsQuery.trim()?'ไม่พบโปรเจกต์ที่ตรงกับ "'+esc(wsQuery.trim())+'"':'ไม่มีโปรเจกต์ตามตัวกรองนี้'}</div>`;
      return;
    }
    el.innerHTML='';
    list.forEach(p=>{
      const m=ST_META[p.status]||ST_META.unknown;
      const card=document.createElement('div');
      card.className='card'; card.style.setProperty('--sc',m.c);
      card.title='เปิดรายละเอียดโปรเจกต์';
      card.innerHTML=`
        <div class="ctop">
          <span class="sdot"></span>
          <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
          ${p.tasks&&p.tasks.length?`<span class="ws-badge-task">${p.tasks.length}</span>`:''}
        </div>
        <div class="path" title="${esc(p.path)}">${esc(p.path)}</div>
        <div class="desc${p.desc?'':' none'}">${p.desc?esc(p.desc):'ยังไม่มีภาพรวม'}</div>
        <div class="foot">
          <span class="stag">${m.t}</span>
          <span class="upd">${p.updated?'↻ '+esc(p.updated):''}</span>
        </div>`;
      card.onclick=()=>{ wsProjectOpen=p.file; renderWsViewVisibility(); renderWsProjectDetail(p); };
      el.appendChild(card);
    });
  }
  // "[[Name]]" → "Name" — how lessons/refs record a project link in frontmatter
  function unwrapLink(s){ return String(s).replace(/^\[\[|\]\]$/g,''); }
  // wsProjectDetailBody เองไม่เคยเซ็ต .innerHTML ตรงๆ — สร้างเป็นลูกๆ ด้วย createElement
  // แล้ว appendChild เข้าไปทีละก้อน (header/tasks/linked-list/actions) แต่ละก้อนตั้ง .innerHTML
  // หรือ .onclick บนตัวมันเองได้อิสระ ตามแพตเทิร์นเดียวกับ renderWsStatusChips ข้างบน
  function renderWsProjectDetail(p){
    const el=document.getElementById('wsProjectDetailBody');
    el.innerHTML='';
    const linked=[...(wsData.lessons||[]),...(wsData.refs||[])]
      .filter(k=>(k.projects||[]).some(link=>unwrapLink(link)===p.name));
    const m=ST_META[p.status]||ST_META.unknown;

    const header=document.createElement('div');
    header.innerHTML=`<h3>${esc(p.name)}</h3>
      <div class="ws-detail-meta"><span class="stag">${m.t}</span><span class="upd">${p.updated?'↻ '+esc(p.updated):''}</span></div>
      <div class="desc${p.desc?'':' none'}">${p.desc?esc(p.desc):'ยังไม่มีภาพรวม'}</div>`;
    el.appendChild(header);

    if(p.tasks&&p.tasks.length){
      const tasksBox=document.createElement('div');
      tasksBox.innerHTML=`<h4>งานค้าง</h4><div class="ws-tasklist">${p.tasks.map(t=>`<div class="ws-task-item">- ${esc(t)}</div>`).join('')}</div>`;
      el.appendChild(tasksBox);
    }

    if(linked.length){
      const linkedHeading=document.createElement('h4'); linkedHeading.textContent='บทเรียน/อ้างอิงที่เกี่ยวข้อง';
      el.appendChild(linkedHeading);
      const grid=document.createElement('div'); grid.className='lgrid';
      linked.forEach(k=>{
        const card=document.createElement('div'); card.className='lcard';
        card.innerHTML=`<div class="lname">${esc(k.name)}</div>`;
        card.onclick=()=>openFile(k.file);
        grid.appendChild(card);
      });
      el.appendChild(grid);
    }

    const actions=document.createElement('div'); actions.className='ws-detail-actions';
    const openBtn=document.createElement('button'); openBtn.textContent='เปิด .md';
    openBtn.onclick=()=>openFile(p.file);
    actions.appendChild(openBtn);
    el.appendChild(actions);
  }
  const KNOW_TYPES=[['lesson','Lesson','lessons'],['ref','Ref','refs'],['rule','Rule','rules'],['playbook','Playbook','playbooks']];
  function wsAllKnow(){
    return KNOW_TYPES.flatMap(([type,,field])=>(wsData[field]||[]).map(x=>({...x,type})));
  }
  function wsAllKnowTags(){
    const set=new Set();
    wsAllKnow().forEach(k=>(k.tags||[]).forEach(t=>{ if(t.startsWith('when/')||t.startsWith('risk/')) set.add(t); }));
    return [...set].sort();
  }
  function wsKnowFiltered(){
    const terms=wsKnowQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return wsAllKnow().filter(k=>{
      const hay=(k.name+' '+(k.meta||'')).toLowerCase();
      return (wsKnowTypeSel.size===0 || wsKnowTypeSel.has(k.type)) &&
        (wsKnowTagSel.size===0 || (k.tags||[]).some(t=>wsKnowTagSel.has(t))) &&
        terms.every(t=>hay.includes(t));
    }).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  }
  // createElement + .onclick ต่อ node เดียวกับที่ Task 23/24 ทำ — ไม่ใช้ innerHTML+querySelectorAll
  function renderWsKnowChips(){
    const typeEl=document.getElementById('wsKnowType');
    typeEl.innerHTML='';
    const allChip=document.createElement('div');
    allChip.className='chip'+(wsKnowTypeSel.size===0?' active':'');
    allChip.textContent='ทั้งหมด';
    allChip.onclick=()=>{ wsKnowTypeSel.clear(); renderWsKnowChips(); renderWsKnowList(); };
    typeEl.appendChild(allChip);
    KNOW_TYPES.forEach(([type,label])=>{
      const chip=document.createElement('div');
      chip.className='chip'+(wsKnowTypeSel.has(type)?' active':'');
      chip.textContent=label;
      chip.onclick=()=>{
        const only=wsKnowTypeSel.size===1 && wsKnowTypeSel.has(type);
        wsKnowTypeSel.clear();
        if(!only) wsKnowTypeSel.add(type);
        renderWsKnowChips(); renderWsKnowList();
      };
      typeEl.appendChild(chip);
    });

    const tagEl=document.getElementById('wsKnowTag');
    tagEl.innerHTML='';
    wsAllKnowTags().forEach(tag=>{
      const chip=document.createElement('div');
      chip.className='chip'+(wsKnowTagSel.has(tag)?' active':'');
      chip.textContent=tag;
      chip.onclick=()=>{
        if(wsKnowTagSel.has(tag)) wsKnowTagSel.delete(tag); else wsKnowTagSel.add(tag);
        renderWsKnowChips(); renderWsKnowList();
      };
      tagEl.appendChild(chip);
    });
  }
  const KNOW_BADGE={lesson:'les',ref:'ref',rule:'rule',playbook:'pbk'};
  function renderWsKnowList(){
    const el=document.getElementById('wsKnow');
    const items=wsKnowFiltered();
    if(!items.length){ el.innerHTML='<div class="empty">ไม่พบความรู้ตามตัวกรองนี้</div>'; return; }
    el.innerHTML='';
    items.forEach(k=>{
      const c=document.createElement('div'); c.className='lcard '+KNOW_BADGE[k.type];
      c.title='เปิดไฟล์';
      c.innerHTML=`<div class="lt"><span class="badge ${KNOW_BADGE[k.type]}">${k.type}</span>
        <span class="ldate">${esc(k.date||'')}</span></div>
        <div class="lname">${esc(k.name)}</div>
        ${k.meta?`<div class="lmeta">${esc(k.meta)}</div>`:''}`;
      c.onclick=()=>openFile(k.file);
      el.appendChild(c);
    });
  }
  function renderWsKnow(){ renderWsKnowChips(); renderWsKnowList(); }
  function onData(payload){
    wsData=payload;
    if(!payload || payload.error){
      const notSetUp=payload && payload.error && payload.error.startsWith('ไม่พบโฟลเดอร์ A_Workspace');
      const proj=document.getElementById('wsToday');
      if(notSetUp){
        proj.innerHTML=`<div class="not-configured">
          <p>ยังไม่ได้ตั้งค่าตำแหน่ง Workspace vault</p>
          <button id="wsNotConfiguredBtn">ตั้งค่าเลย</button>
        </div>`;
        document.getElementById('wsNotConfiguredBtn').onclick=()=>shell().openSettings('cardWorkspace');
      } else {
        proj.innerHTML=`<div class="empty">โหลด Workspace ไม่สำเร็จ: ${esc((payload&&payload.error)||'ไม่ทราบสาเหตุ')}</div>`;
      }
      return;
    }
    const stats=new Set((payload.projects||[]).map(p=>p.status));
    [...wsStatSel].forEach(s=>{ if(!stats.has(s)) wsStatSel.delete(s); });
    renderWsViewVisibility();
    renderWsToday();
    if(typeof renderWsProjects==='function') renderWsProjects();      // defined in Task 24
    if(typeof renderWsKnow==='function') renderWsKnow();              // defined in Task 25
  }
  function mount(){
    const api=shell().api;
    api && api.onWorkspace && api.onWorkspace(onData);
    renderWsViewVisibility();
    document.getElementById('wsRefresh').onclick=()=>api&&api.refreshWorkspace&&api.refreshWorkspace();
    const wsSearch=document.getElementById('wsSearch');
    wsSearch.oninput=()=>{ wsQuery=wsSearch.value; renderWsProjects(); };
    document.getElementById('wsProjectBack').onclick=()=>{ wsProjectOpen=null; renderWsViewVisibility(); };
    const wsKnowSearch=document.getElementById('wsKnowSearch');
    wsKnowSearch.oninput=()=>{ wsKnowQuery=wsKnowSearch.value; renderWsKnowList(); };
  }

  // ===== การ์ดตั้งค่าของแท็บนี้ =====
  // markup ของการ์ดอยู่ใน widget.html เหมือนเดิม ที่ย้ายมาคือสายไฟ
  let setWsDir,setWsStatus,setWsSave;
  function mountSettings(){
    setWsDir=document.getElementById('setWsDir');
    setWsStatus=document.getElementById('setWsStatus');
    setWsSave=document.getElementById('setWsSave');
    setWsSave.onclick=()=>{
      const dir=setWsDir.value.trim();
      if(!dir){ setWsStatus.className='set-status err'; setWsStatus.textContent='กรอก path ก่อน'; return; }
      setWsSave.disabled=true;
      shell().api.saveWorkspaceDir(dir).then(()=>{
        setWsSave.disabled=false;
        setWsStatus.className='set-status ok';
        setWsStatus.textContent='บันทึกแล้ว';
      });
    };
  }
  function loadSettings(){
    setWsStatus.textContent=''; setWsStatus.className='set-status';
    const api=shell().api;
    api && api.getWorkspaceDir && api.getWorkspaceDir().then(dir=>{ setWsDir.value=dir||''; });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.tabs.workspace = { key:'ws', settingsCard:'cardWorkspace', mount, mountSettings, loadSettings, onData };
})(typeof window !== 'undefined' ? window : globalThis);
