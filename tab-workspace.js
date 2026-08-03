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
  const wsVisSel=new Set();     // empty = all visibilities
  const wsStatSel=new Set();    // empty = all statuses
  let wsQuery='';               // project search text
  function openFile(p){ shell().openFile(p); }

  function wsProjectsFiltered(){
    if(!wsData||!wsData.projects) return [];
    const terms=wsQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return wsData.projects.filter(p=>{
      const hay=(p.name+' '+(p.path||'')+' '+(p.desc||'')).toLowerCase();
      return (wsVisSel.size===0 || wsVisSel.has(p.visibility)) &&
        (wsStatSel.size===0 || wsStatSel.has(p.status)) &&
        terms.every(t=>hay.includes(t));   // all words must match (AND)
    });
  }
  function renderWsStats(){
    const s=wsData.stats||{};
    const cells=[
      ['โปรเจกต์',s.projects,'var(--accent)'],
      ['public',s.public,'var(--cyan)'],
      ['private',s.private,'var(--violet)'],
      ['lessons',s.lessons,'var(--amber)'],
      ['playbooks',s.playbooks,'var(--green)'],
    ];
    document.getElementById('wsStats').innerHTML=cells.map(([l,n,c])=>
      `<div class="stat" style="--sc:${c}"><div class="n">${n||0}</div><div class="l">${l}</div></div>`).join('');
  }
  function renderWsFilters(){
    const ps=wsData.projects||[];
    const visEl=document.getElementById('wsVis');
    const visList=[['Public','var(--cyan)'],['Private','var(--violet)']];
    visEl.innerHTML=`<div class="chip${wsVisSel.size===0?' active':''}" data-all="1">ทั้งหมด<span class="n">${ps.length}</span></div>`+
      visList.map(([v,c])=>{
        const n=ps.filter(p=>p.visibility===v).length;
        return `<div class="chip${wsVisSel.has(v)?' active':''}" data-vis="${v}"><span class="dot" style="--cc:${c}"></span>${v}<span class="n">${n}</span></div>`;
      }).join('');
    const stEl=document.getElementById('wsStatus');
    const order=['active','pause','done','unknown'];
    stEl.innerHTML=`<div class="chip${wsStatSel.size===0?' active':''}" data-all="1">ทั้งหมด<span class="n">${ps.length}</span></div>`+
      order.filter(k=>ps.some(p=>p.status===k)).map(k=>{
        const n=ps.filter(p=>p.status===k).length;
        return `<div class="chip${wsStatSel.has(k)?' active':''}" data-stat="${k}"><span class="dot" style="--cc:${ST_META[k].c}"></span>${ST_META[k].label}<span class="n">${n}</span></div>`;
      }).join('');
    // single-select: pick one, or click the active one again to reset to "ทั้งหมด"
    visEl.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
      const v=ch.dataset.vis;
      const only=v!==undefined && wsVisSel.size===1 && wsVisSel.has(v);
      wsVisSel.clear();
      if(v!==undefined && !only) wsVisSel.add(v);
      renderWsFilters(); renderWsProjects();
    });
    stEl.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
      const k=ch.dataset.stat;
      const only=k!==undefined && wsStatSel.size===1 && wsStatSel.has(k);
      wsStatSel.clear();
      if(k!==undefined && !only) wsStatSel.add(k);
      renderWsFilters(); renderWsProjects();
    });
  }
  function renderWsProjects(){
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
      card.title='เปิดหน้าสรุปโปรเจกต์';
      card.innerHTML=`
        <div class="ctop">
          <span class="sdot"></span>
          <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="vis ${p.visibility==='Public'?'pub':'prv'}">${p.visibility}</span>
        </div>
        <div class="path" title="${esc(p.path)}">${esc(p.path)}</div>
        <div class="desc${p.desc?'':' none'}">${p.desc?esc(p.desc):'ยังไม่มีภาพรวม'}</div>
        <div class="foot">
          <span class="stag">${m.t}</span>
          <span class="upd">${p.updated?'↻ '+esc(p.updated):''}</span>
        </div>`;
      card.onclick=()=>openFile(p.file);
      el.appendChild(card);
    });
  }
  function renderWsFeed(){
    const el=document.getElementById('wsFeed');
    const files=(wsData.daily||[]).filter(d=>d.entries&&d.entries.length);
    if(!files.length){ el.innerHTML='<div class="empty">ยังไม่มีบันทึกรายวัน</div>'; return; }
    // group by date, then by project — merges Public+Private daily files of the same day
    const byDate=new Map();
    files.forEach(d=>d.entries.forEach(e=>{
      if(!byDate.has(d.date)) byDate.set(d.date,new Map());
      const projs=byDate.get(d.date);
      if(!projs.has(e.project)) projs.set(e.project,[]);
      const arr=projs.get(e.project);
      if(!arr.some(x=>x.text===e.text)) arr.push({text:e.text,file:d.file,visibility:d.visibility});
    }));
    const dates=[...byDate.keys()].sort((a,b)=>b.localeCompare(a)).slice(0,6);
    el.innerHTML='';
    dates.forEach(date=>{
      const projs=byDate.get(date);
      const day=document.createElement('div'); day.className='day';
      day.innerHTML=`<div class="dhead"><span class="ddate">${esc(date)}</span>
        <span class="dsub">${projs.size} โปรเจกต์อัปเดต</span></div>`;
      projs.forEach((items,project)=>{
        const en=document.createElement('div'); en.className='entry';
        en.style.setProperty('--pc',hueOf(project));
        // ย่อไว้ก่อนเสมอ (2 บรรทัด) แล้วคลิกเพื่อขยายอ่านเต็ม -- อยู่ในตัวฟีดเลย ไม่ต้อง
        // เปิดไฟล์ .md ออกไปอ่านข้างนอก ซึ่งเป็นจุดที่ฟีดนี้มีไว้ตั้งแต่แรก
        const texts=items.map(it=>
          `<div class="ptext" data-file="${esc(it.file)}" title="คลิกเพื่อย่อ/ขยาย · ${esc(it.visibility)}">${esc(it.text)}</div>`).join('');
        en.innerHTML=`<div class="rail"><span class="pin"></span><span class="ln"></span></div>
          <div class="content"><div class="pname">${esc(project)}</div>${texts}</div>`;
        en.querySelectorAll('.ptext').forEach(t=>t.onclick=()=>t.classList.toggle('expanded'));
        day.appendChild(en);
      });
      el.appendChild(day);
    });
  }
  function renderWsKnow(){
    const el=document.getElementById('wsKnow');
    const items=[
      ...(wsData.lessons||[]).map(x=>({...x,type:'les'})),
      ...(wsData.playbooks||[]).map(x=>({...x,type:'pbk'})),
    ].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(!items.length){ el.innerHTML='<div class="empty">ยังไม่มีบทเรียน/แผนรับมือ (มีแต่ template)</div>'; return; }
    el.innerHTML='';
    items.forEach(k=>{
      const c=document.createElement('div'); c.className='lcard'+(k.type==='pbk'?' pb':'');
      c.title='เปิดไฟล์';
      c.innerHTML=`<div class="lt"><span class="badge ${k.type==='les'?'les':'pbk'}">${k.type==='les'?'Lesson':'Playbook'}</span>
        <span class="ldate">${esc(k.date||'')}</span></div>
        <div class="lname">${esc(k.name)}</div>
        ${k.meta?`<div class="lmeta">${esc(k.meta)}</div>`:''}`;
      c.onclick=()=>openFile(k.file);
      el.appendChild(c);
    });
  }
  function onData(payload){
    wsData=payload;
    const proj=document.getElementById('wsProjects');
    if(!payload || payload.error){
      const notSetUp=payload && payload.error && payload.error.startsWith('ไม่พบโฟลเดอร์ A_Workspace');
      if(notSetUp){
        proj.innerHTML=`<div class="not-configured">
          <p>ยังไม่ได้ตั้งค่าตำแหน่ง Workspace vault</p>
          <button id="wsNotConfiguredBtn">ตั้งค่าเลย</button>
        </div>`;
        document.getElementById('wsNotConfiguredBtn').onclick=()=>shell().openSettings('cardWorkspace');
      } else {
        proj.innerHTML=`<div class="empty">โหลด Workspace ไม่สำเร็จ: ${esc((payload&&payload.error)||'ไม่ทราบสาเหตุ')}</div>`;
      }
      document.getElementById('wsStats').innerHTML='';
      document.getElementById('wsVis').innerHTML='';
      document.getElementById('wsStatus').innerHTML='';
      document.getElementById('wsFeed').innerHTML='';
      document.getElementById('wsKnow').innerHTML='';
      return;
    }
    // drop selections no longer present
    const vises=new Set((payload.projects||[]).map(p=>p.visibility));
    const stats=new Set((payload.projects||[]).map(p=>p.status));
    [...wsVisSel].forEach(v=>{ if(!vises.has(v)) wsVisSel.delete(v); });
    [...wsStatSel].forEach(s=>{ if(!stats.has(s)) wsStatSel.delete(s); });
    renderWsStats(); renderWsFilters(); renderWsProjects(); renderWsFeed(); renderWsKnow();
  }
  function mount(){
    const api=shell().api;
    api && api.onWorkspace && api.onWorkspace(onData);
    // project search
    const wsSearch=document.getElementById('wsSearch');
    wsSearch.oninput=()=>{ wsQuery=wsSearch.value; if(wsData) renderWsProjects(); };
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
