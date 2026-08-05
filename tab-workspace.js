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
