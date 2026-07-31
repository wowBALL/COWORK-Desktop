// แท็บ Meeting — รายการประชุมจัดกลุ่มตามวัน + หน้าอ่าน (สรุป / ถอดเสียง / ไฟล์)
//
// payload = { meetings:[{id,date,time,title,summary,topics,actions,...}], stats, error }
// summary มาพร้อมรายการเลย ส่วน transcript โหลดทีละประชุมตอนกดเข้าไปอ่าน
//
// ต่อกับ meetingrun.js (แถบควบคุมการอัด) ที่แยกไฟล์อยู่แล้ว — ไม่ยุบรวมกัน โมดูลนี้เป็นคนถือมัน
// CSS อยู่ใน tab-meeting.css ยกเว้น .mt-back กับ .sp0-7 ที่แท็บ QA ใช้ร่วม เลยค้างไว้ใน widget.html
(function (global) {
  'use strict';
  const {D, M, esc} = global.COWORK.util;
  const {dateMatch, dateFilterHtml, wireDateFilter} = global.COWORK.dateFilter;
  const shell = () => global.COWORK.shell;   // เปลือกสร้างทีหลังไฟล์นี้ ต้องหยิบตอนเรียกใช้
  const openFile = p => shell().openFile(p);

  let mtData=null;
  let mtQuery='', mtTopic=null;
  const mtDateSel={y:null,m:null,d:null};   // ชื่อห้ามเป็น mtDate — ชนกับฟังก์ชันจัดรูปแบบวันที่ข้างล่าง
  let mtOpen=null;                 // ประชุมที่กำลังอ่านอยู่ (null = อยู่หน้ารายการ)
  let mtTab='s';                   // s=สรุป t=ถอดเสียง f=ไฟล์
  let mtTq='', mtSpk=null;         // ค้นหา / กรองผู้พูด ในหน้าถอดเสียง
  const mtCache=new Map();         // id → { speakers, utterances }

  function mtDate(d){
    const dt=new Date(d+'T00:00:00');
    if(!d || isNaN(dt)) return d||'ไม่ระบุวัน';
    return `${D[dt.getDay()]} ${dt.getDate()} ${M[dt.getMonth()]} ${dt.getFullYear()}`;
  }
  function mtSize(n){ return n>=1048576 ? (n/1048576).toFixed(1)+' MB' : Math.round(n/1024)+' KB'; }

  // markdown เท่าที่ summary.md ใช้จริง: หัวข้อ 1-3 ระดับ, bullet (มีระดับย่อย), **ตัวหนา**, `code`
  function mdInline(t){
    return esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`(.+?)`/g,'<code>$1</code>');
  }
  function mdRender(src){
    const out=[]; let ul=false, hn=0;
    const closeUl=()=>{ if(ul){ out.push('</ul>'); ul=false; } };
    for(const raw of String(src||'').replace(/\r/g,'').split('\n')){
      const line=raw.replace(/\s+$/,'');
      if(!line.trim()){ closeUl(); continue; }
      let m;
      if((m=/^(#{1,3})\s+(.*)$/.exec(line))){
        closeUl(); hn++;
        out.push(`<h${m[1].length} id="mth${hn}">${mdInline(m[2])}</h${m[1].length}>`); continue;
      }
      if((m=/^(\s*)[-*]\s+(.*)$/.exec(line))){
        if(!ul){ out.push('<ul>'); ul=true; }
        out.push(`<li${m[1].length>=2?' class="sub"':''}>${mdInline(m[2])}</li>`); continue;
      }
      closeUl(); out.push(`<p>${mdInline(line)}</p>`);
    }
    closeUl(); return out.join('');
  }
  // สารบัญ — ต้องนับหัวข้อแบบเดียวกับ mdRender เป๊ะ ๆ id จะได้ตรงกัน
  function mdHeadings(src){
    const hs=[]; let hn=0;
    for(const raw of String(src||'').replace(/\r/g,'').split('\n')){
      const m=/^(#{1,3})\s+(.*)$/.exec(raw.replace(/\s+$/,''));
      if(m){ hn++; hs.push({lvl:m[1].length, txt:m[2].replace(/\*\*/g,''), id:'mth'+hn}); }
    }
    return hs;
  }
  // ตัวอย่างสรุป 2 บรรทัดในรายการ = bullet แรก
  function mtSnippet(s){
    const lines=String(s||'').replace(/\r/g,'').split('\n');
    const b=lines.find(l=>/^\s*[-*]\s+\S/.test(l));
    const t=b || lines.find(l=>l.trim() && !l.trim().startsWith('#')) || '';
    return t.replace(/^\s*[-*]\s+/,'').replace(/\*\*/g,'').trim();
  }
  // summary.meta.md — เขียนโดย meeting-notes/src/storage.py:save_summary()
  // สองส่วน: บรรทัด "key: value" 1-4 บรรทัดแรก แล้วตามด้วยหัวข้อ ## กี่หัวก็ได้
  // (ชื่อหัวข้อไม่ตายตัว — TRANSCRIPT_QUALITY_HEADINGS ฝั่ง Python แก้ได้ทีหลัง
  // parser นี้จึงเก็บทุกหัวข้อ ## แบบทั่วไป ไม่ผูกชื่อ กันไม่ให้เงียบหายทั้งหัวข้อ
  // เมื่อฝั่งนั้นเปลี่ยนชื่อ)
  function parseMeta(raw){
    const text=String(raw||'').replace(/\r\n/g,'\n').trim();
    if(!text) return null;
    const lines=text.split('\n');
    const head=[]; const secs=[]; let cur=null;
    for(const line of lines){
      const h=/^##\s+(.*)$/.exec(line.trim());
      if(h){ cur={title:h[1].trim(),body:[]}; secs.push(cur); continue; }
      if(cur) cur.body.push(line);
      else if(line.trim()) head.push(line.trim());
    }
    const meta={model:'',modelNote:'',profile:'',glossary:[],fuzzy:[],other:[]};
    for(const l of head){
      let m;
      if((m=/^สรุปด้วย\s+(.+)$/.exec(l))){
        const v=m[1].trim();
        const p=/^(\S+)\s*\((.*)\)$/.exec(v);
        if(p){ meta.model=p[1]; meta.modelNote=p[2]; } else meta.model=v;
      }
      else if((m=/^ประเภทประชุม:\s*(.+)$/.exec(l))) meta.profile=m[1].trim();
      else if((m=/^แก้คำตาม glossary:\s*(.+)$/.exec(l))) meta.glossary=splitCounts(m[1]);
      else if((m=/^คำ fuzzy ที่เจอในห้อง:\s*(.+)$/.exec(l))) meta.fuzzy=splitCounts(m[1]);
      else meta.other.push(l);   // บรรทัดที่ยังไม่รู้จัก — โผล่เป็นแถว "อื่น ๆ" ไม่ทิ้ง
    }
    meta.sections=secs.map(s=>({title:s.title,body:s.body.join('\n').trim()})).filter(s=>s.body);
    return meta;
  }
  // "rollback 6 จุด, Zitadel 4 จุด" → [{term:'rollback',n:'6 จุด'}, …]
  function splitCounts(s){
    return s.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{
      const m=/^(.*?)\s+(\d+\s*(?:จุด|ครั้ง))$/.exec(x);
      return m?{term:m[1],n:m[2]}:{term:x,n:''};
    });
  }
  // bullet "- ได้ยิน → เดาว่า… (ได้ยิน N ครั้ง)" → {heard,guess,n}
  function parseWords(body){
    return body.split('\n').map(l=>/^\s*[-*]\s+(.*)$/.exec(l.trim())).filter(Boolean).map(m=>{
      const t=m[1];
      const i=t.indexOf('→');
      const n=/\((ได้ยิน[^)]*)\)\s*$/.exec(t);
      const rest=n?t.slice(0,n.index).trim():t;
      if(i===-1) return {heard:'',guess:rest,n:n?n[1]:''};
      return {heard:t.slice(0,i).trim(),guess:rest.slice(i+1).trim(),n:n?n[1]:''};
    });
  }
  // bullet "- 08:00–16:20 (…): เนื้อหา" → {ts,tx}  (ป้ายเวลาเป็น optional)
  function parseSpots(body){
    return body.split('\n').map(l=>/^\s*[-*]\s+(.*)$/.exec(l.trim())).filter(Boolean).map(m=>{
      const t=m[1];
      const ts=/^(?:ช่วง\s*)?(\d{1,3}:\d{2}\s*[–-]\s*\d{1,3}:\d{2})/.exec(t);
      if(ts) return {ts:ts[1].replace(/\s/g,''),tx:t.slice(ts[0].length).replace(/^[\s:：]+/,'')};
      const all=/^(ทั้งไฟล์)\s*[:：]\s*/.exec(t);
      if(all) return {ts:all[1],tx:t.slice(all[0].length)};
      return {ts:'',tx:t};
    });
  }
  function mtRailColor(m){
    if(!m.usable) return 'var(--dim)';
    return m.actions ? 'var(--amber)' : 'var(--accent)';
  }
  function mtPills(m){
    const p=[];
    if(m.time) p.push(`<span class="mt-pill mono">🕘 ${m.time}</span>`);
    if(m.speakers) p.push(`<span class="mt-pill c">👥 ${m.speakers} คน</span>`);
    p.push(`<span class="mt-pill mono">💬 ${m.lines}${m.lastStamp?' · '+m.lastStamp:''}</span>`);
    if(m.actions) p.push(`<span class="mt-pill a">✅ ${m.actions} action</span>`);
    if(m.audio) p.push(`<span class="mt-pill v">🎙 ${mtSize(m.audio.size)}</span>`);
    if(!m.usable) p.push(`<span class="mt-pill r">⚠ สรุปไม่ได้</span>`);
    return `<div class="mt-pills">${p.join('')}</div>`;
  }
  function mtList(){
    if(!mtData||!mtData.meetings) return [];
    const terms=mtQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return mtData.meetings.filter(m=>{
      const hay=(m.title+' '+m.summary+' '+m.topics.join(' ')).toLowerCase();
      return dateMatch(mtDateSel,m.date) &&
        (!mtTopic||m.topics.includes(mtTopic)) &&
        terms.every(t=>hay.includes(t));
    });
  }
  function renderMtStats(){
    const s=(mtData&&mtData.stats)||{};
    const cells=[['ประชุม',s.total,'var(--accent)'],['action',s.actions,'var(--amber)'],
                 ['ประโยค',s.lines,'var(--cyan)'],['มีไฟล์เสียง',s.audio,'var(--violet)']];
    document.getElementById('mtStats').innerHTML=cells.map(([l,n,c])=>
      `<div class="stat" style="--sc:${c}"><div class="n">${n||0}</div><div class="l">${l}</div></div>`).join('');
  }
  function renderMtFilters(){
    const ms=mtData.meetings||[];
    const terms=mtQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit=m=>{
      const hay=(m.title+' '+m.summary+' '+m.topics.join(' ')).toLowerCase();
      return terms.every(t=>hay.includes(t));
    };
    // เลขบนชิปแต่ละแถวต้องนับ "หลังหักตัวกรองแถวอื่น + คำค้นแล้ว" ไม่งั้นเลขโกหก —
    // ของเดิมนับจาก ms ทั้งก้อนตลอด เลือกวันแล้วชิปหัวข้อยังขึ้นเลขรวมทั้งหมดอยู่ดี
    const forDate=ms.filter(m=>hit(m)&&(!mtTopic||m.topics.includes(mtTopic)));
    const dEl=document.getElementById('mtDays');
    dEl.innerHTML=dateFilterHtml(forDate,m=>m.date,mtDateSel);   // ล้าง mtDateSel ที่ค้างให้ด้วย ต้องมาก่อนบรรทัดล่าง
    wireDateFilter(dEl,mtDateSel,()=>{ renderMtFilters(); renderMtRows(); });

    const forTopic=ms.filter(m=>hit(m)&&dateMatch(mtDateSel,m.date));
    const counts={};
    forTopic.forEach(m=>m.topics.forEach(t=>counts[t]=(counts[t]||0)+1));
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10);
    // หัวข้อที่กรองอยู่ต้องอยู่ในแถวเสมอ ถึงจะหล่นออกจาก top 10 หรือเหลือ 0 หลังกรองวัน —
    // ไม่งั้นกลายเป็นตัวกรองล่องหนที่กดปิดไม่ได้
    if(mtTopic&&!top.some(([t])=>t===mtTopic)) top.push([mtTopic,counts[mtTopic]||0]);
    const tEl=document.getElementById('mtTopics');
    tEl.innerHTML=top.length
      ? `<div class="chip${!mtTopic?' active':''}" data-g="">ทั้งหมด<span class="n">${forTopic.length}</span></div>`+
        top.map(([t,n])=>`<div class="chip${mtTopic===t?' active':''}" data-g="${esc(t)}" title="${esc(t)}">${esc(t.length>24?t.slice(0,24)+'…':t)}<span class="n">${n}</span></div>`).join('')
      : `<div class="hint" style="padding:0 0 6px">ยังไม่มีหัวข้อย่อยในสรุป</div>`;
    tEl.querySelectorAll('.chip').forEach(el=>
      el.onclick=()=>{ mtTopic=el.dataset.g||null; renderMtFilters(); renderMtRows(); });
  }
  function renderMtRows(){
    const el=document.getElementById('mtRows');
    const list=mtList();
    if(!list.length){ el.innerHTML='<div class="empty">ไม่พบประชุมที่ตรงกับตัวกรอง</div>'; return; }
    const byDay={};
    list.forEach(m=>{ (byDay[m.date]=byDay[m.date]||[]).push(m); });
    el.innerHTML=Object.keys(byDay).sort().reverse().map(d=>`
      <div class="mt-daybar"><span class="d">${esc(mtDate(d))}</span><span class="ln"></span><span class="n">${byDay[d].length} ประชุม</span></div>
      <div class="mt-grid">${byDay[d].map(m=>`
        <div class="mt-row${m.usable?'':' faded'}" data-id="${esc(m.id)}">
          <div class="rail" style="--sc:${mtRailColor(m)}"></div>
          <div class="mid">
            <div class="top"><span class="nm">${esc(m.title)}</span><span class="tm">${esc(m.time||'')}</span></div>
            <div class="snip">${esc(mtSnippet(m.summary))||'<span style="color:var(--dim)">ไม่มีสรุป</span>'}</div>
            ${m.topics.length?`<div class="mt-tags">${m.topics.slice(0,3).map(t=>`<span class="mt-tag">${esc(t.length>28?t.slice(0,28)+'…':t)}</span>`).join('')}</div>`:''}
            ${mtPills(m)}
          </div>
        </div>`).join('')}</div>`).join('');
    el.querySelectorAll('.mt-row').forEach(row=>row.onclick=()=>{
      const m=mtData.meetings.find(x=>x.id===row.dataset.id);
      if(m) mtOpenMeeting(m);
    });
  }
  function mtOpenMeeting(m){
    mtOpen=m; mtTab='s'; mtTq=''; mtSpk=null;
    document.getElementById('mtList').classList.add('hidden');
    document.getElementById('mtReader').classList.remove('hidden');
    renderMtReader();
    document.querySelector('.body').scrollTop=0;
  }
  function mtBackToList(){
    mtOpen=null;
    document.getElementById('mtReader').classList.add('hidden');
    document.getElementById('mtList').classList.remove('hidden');
  }
  // แบบ B (ตารางตรวจงาน) ที่เลือกจาก summarymeta-mock.html — แถบ key:value บนสุด แล้วต่อด้วย
  // ทุกหัวข้อ ## ที่ parseMeta เจอ แยกเลย์เอาต์ตามว่า bullet ส่วนใหญ่ในหัวข้อนั้นมี "→" หรือไม่
  function renderMeta(meta){
    const row=(k,v,cls)=>v?`<dt>${esc(k)}</dt><dd class="${cls||''}">${v}</dd>`:'';
    const counts=a=>a.map(i=>esc(i.term)+(i.n?` <span style="color:var(--dim)">${esc(i.n)}</span>`:'')).join(' · ');
    const sec=s=>{
      const words=parseWords(s.body), spots=parseSpots(s.body);
      const looksLikeWords=words.filter(w=>w.heard).length>words.length/2;
      const rows=looksLikeWords
        ? words.map(w=>`<div class="mtq-word">
              <span class="heard">${esc(w.heard)}</span><span class="ar">→</span>
              <span class="guess">${esc(w.guess)}</span>
              ${w.n?`<span class="n">${esc(w.n)}</span>`:''}</div>`).join('')
        : spots.map(p=>`<div class="mtq-spot">
              <span class="ts">${esc(p.ts||'—')}</span><span class="tx">${esc(p.tx)}</span></div>`).join('');
      const n=looksLikeWords?words.length:spots.length;
      return `<div class="mtq-sec"><h4><span>${esc(s.title)}</span><span class="n">${n}</span></h4>${rows}</div>`;
    };
    return `<div class="mtq">
      <dl class="mtq-strip">
        ${row('สรุปด้วย',esc(meta.model),'mono')}
        ${meta.modelNote?row('หมายเหตุ',esc(meta.modelNote)):''}
        ${row('ประเภทประชุม',esc(meta.profile))}
        ${row('แก้ตาม glossary',counts(meta.glossary))}
        ${row('fuzzy ที่เจอ',counts(meta.fuzzy))}
        ${meta.other.map(l=>row('อื่น ๆ',esc(l))).join('')}
      </dl>
      ${meta.sections.map(sec).join('')}
    </div>`;
  }
  function renderTranscript(tr){
    if(!tr) return '<div class="hint">กำลังโหลดบทถอดเสียง...</div>';
    if(tr.error) return `<div class="empty">อ่าน transcript ไม่สำเร็จ: ${esc(tr.error)}</div>`;
    if(!tr.utterances.length) return '<div class="empty">ไฟล์ transcript ว่าง</div>';
    const q=mtTq.trim().toLowerCase();
    const hl=t=>{
      const s=esc(t);
      if(!q) return s;
      return s.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark>$1</mark>');
    };
    const rows=tr.utterances.filter(u=>
      (mtSpk===null||u.speaker===mtSpk) && (!q||u.text.toLowerCase().includes(q)));
    const chips=`<div class="chips">
      <div class="chip${mtSpk===null?' active':''}" data-sp="">ทุกคน<span class="n">${tr.utterances.length}</span></div>
      ${tr.speakers.map((nm,i)=>`<div class="chip spk sp${i%8}${mtSpk===i?' active':''}" data-sp="${i}">${esc(nm)}<span class="n">${tr.utterances.filter(u=>u.speaker===i).length}</span></div>`).join('')}
    </div>`;
    const body=rows.length
      ? `<div class="tr">${rows.map(u=>`
          <div class="utt sp${u.speaker%8}">
            <div class="av">${esc(String(u.who).replace(/[^0-9]/g,'')||'•')}</div>
            <div class="bub">
              <div class="who"><span class="nm">${esc(u.who)}</span><span class="ts">${esc(u.ts)}</span></div>
              <div class="tx">${hl(u.text)}</div>
            </div>
          </div>`).join('')}</div>`
      : '<div class="empty">ไม่พบข้อความที่ค้นหา</div>';
    return chips+body;
  }
  function renderMtReader(){
    const m=mtOpen; if(!m) return;
    const hasMeta=!!(m.meta&&m.meta.trim());
    // ประชุมนี้ไม่มี summary.meta.md (หรือเพิ่งหายไปตอน refresh) แต่ mtTab ค้างเป็น 'q'
    // มาจากประชุมก่อนหน้า — ตกกลับไปแท็บ "สรุป" แทนที่จะเจอหน้าว่าง
    if(mtTab==='q'&&!hasMeta) mtTab='s';
    const el=document.getElementById('mtReader');
    el.innerHTML=`
      <button class="mt-back" id="mtBack">← กลับไปรายการประชุม</button>
      <div class="mt-title">${esc(m.title)}</div>
      <div class="mt-sub">${esc(mtDate(m.date))}${m.time?' · '+esc(m.time):''} · ${esc(m.id)}</div>
      ${mtPills(m)}
      <div class="mt-seg">
        <button data-tb="s" class="${mtTab==='s'?'on':''}">📄 สรุป</button>
        ${hasMeta?`<button data-tb="q" class="${mtTab==='q'?'on':''}">⚠ ที่ต้องเช็ก</button>`:''}
        <button data-tb="t" class="${mtTab==='t'?'on':''}">🗒 ถอดเสียง</button>
        <button data-tb="f" class="${mtTab==='f'?'on':''}">📁 ไฟล์ (${m.files.length})</button>
      </div>
      ${mtTab==='t'?`<input id="mtTq" class="search" type="text" placeholder="🔍 ค้นในบทถอดเสียง" value="${esc(mtTq)}" autocomplete="off">`:''}
      <div id="mtBody"></div>`;
    const body=document.getElementById('mtBody');
    if(mtTab==='s'){
      const hs=mdHeadings(m.summary).filter(h=>h.lvl>=2);
      // จอกว้างพอ (CSS media query) สารบัญจะย้ายไปเป็นแถบข้างที่ค้างตามหน้าจอ แทนที่จะกินที่ด้านบน
      body.className=hs.length>1?'two-col':'';
      body.innerHTML=(hs.length>1?`<div class="mt-outline"><div class="ot">สารบัญ · คลิกเพื่อกระโดด</div>
          ${hs.map(h=>`<a data-go="${h.id}"${h.lvl===3?' class="l3"':''}>${esc(h.txt)}</a>`).join('')}</div>`:'')+
        (m.summary.trim()?`<div class="md">${mdRender(m.summary)}</div>`:'<div class="empty">ไม่มีไฟล์ summary.md</div>');
      body.querySelectorAll('[data-go]').forEach(a=>a.onclick=()=>{
        const t=document.getElementById(a.dataset.go);
        if(t) t.scrollIntoView({behavior:'smooth',block:'start'});
      });
    } else if(mtTab==='t'){
      body.innerHTML=renderTranscript(mtCache.get(m.id));
      const api=shell().api;
      if(!mtCache.has(m.id) && api && api.getMeetingTranscript){
        api.getMeetingTranscript(m.id).then(tr=>{
          mtCache.set(m.id,tr);
          if(mtOpen===m && mtTab==='t') renderMtReader();
        });
      }
      body.querySelectorAll('[data-sp]').forEach(c=>c.onclick=()=>{
        mtSpk=c.dataset.sp===''?null:Number(c.dataset.sp); renderMtReader();
      });
      const tq=document.getElementById('mtTq');
      if(tq) tq.oninput=()=>{
        mtTq=tq.value; const pos=tq.selectionStart;
        renderMtReader();
        const n=document.getElementById('mtTq'); if(n){ n.focus(); n.setSelectionRange(pos,pos); }
      };
    } else if(mtTab==='q'){
      const meta=parseMeta(m.meta);
      body.innerHTML=meta?renderMeta(meta):'<div class="empty">ไม่มีไฟล์ summary.meta.md</div>';
    } else {
      body.innerHTML=`<div class="mt-files">${m.files.map(f=>`
        <div class="mt-file" data-p="${esc(f.path)}">
          <span>${/\.(ogg|mp3|wav|m4a|webm)$/i.test(f.name)?'🎙':'📄'}</span>
          <span class="fn">${esc(f.name)}</span>
          <span class="fs">${f.name===((m.audio&&m.audio.name)||'')?mtSize(m.audio.size):''}</span>
        </div>`).join('')}</div>
        <div class="hint">คลิกเพื่อเปิดด้วยโปรแกรมของเครื่อง</div>`;
      body.querySelectorAll('.mt-file').forEach(f=>f.onclick=()=>openFile(f.dataset.p));
    }
    document.getElementById('mtBack').onclick=mtBackToList;
    el.querySelectorAll('[data-tb]').forEach(b=>b.onclick=()=>{ mtTab=b.dataset.tb; renderMtReader(); });
  }
  function onData(payload){
    const rows=document.getElementById('mtRows');
    if(!payload || payload.error){
      mtData=null; mtBackToList();
      document.getElementById('mtStats').innerHTML='';
      document.getElementById('mtDays').innerHTML='';
      document.getElementById('mtTopics').innerHTML='';
      const notSetUp=payload && payload.error && payload.error.startsWith('ไม่พบโฟลเดอร์ meetings');
      if(notSetUp){
        rows.innerHTML=`<div class="not-configured">
          <p>ยังไม่ได้ตั้งค่าโฟลเดอร์บันทึกประชุม</p>
          <button id="mtNotConfiguredBtn">ตั้งค่าเลย</button>
        </div>`;
        document.getElementById('mtNotConfiguredBtn').onclick=()=>shell().openSettings('cardMeetings');
      } else {
        rows.innerHTML=`<div class="empty">โหลดรายการประชุมไม่สำเร็จ: ${esc((payload&&payload.error)||'ไม่ทราบสาเหตุ')}</div>`;
      }
      return;
    }
    mtData=payload;
    mtCache.clear();                                   // ไฟล์อาจถูกเขียนใหม่ระหว่างรอบ refresh
    // ไม่ต้องล้าง mtDateSel ตรงนี้ — dateFilterHtml ล้างค่าที่หายไปให้เองตอน renderMtFilters
    const tops=new Set(payload.meetings.flatMap(m=>m.topics));
    if(mtTopic && !tops.has(mtTopic)) mtTopic=null;
    if(mtOpen){                                        // ยังอ่านค้างอยู่ — เอาข้อมูลก้อนใหม่มาแทน
      const fresh=payload.meetings.find(m=>m.id===mtOpen.id);
      if(fresh){ mtOpen=fresh; renderMtReader(); } else mtBackToList();
    }
    renderMtStats(); renderMtFilters(); renderMtRows();
  }

  // แถบควบคุมการอัด — โมดูลแยกไฟล์ ที่นี่รู้จักแค่สัญญาสี่เมธอด
  const mtRunner = global.COWORK.tabs.meetingRunner;

  function mount(){
    const api=shell().api;
    api && api.onMeetings && api.onMeetings(onData);
    if(mtRunner){
      mtRunner.mount(document.getElementById("mtRunSlot"));
      mtRunner.mountBar(document.getElementById("mrunLive"), ()=>shell().showTab("mt"));
      mtRunner.mountRead(id=>{
        // โฟลเดอร์เพิ่งถูกสร้าง รายการที่ถืออยู่จึงยังไม่มีมัน — ขอก้อนใหม่ก่อน
        api && api.refreshMeetings && api.refreshMeetings();
        if(!id) return;
        // ปุ่มที่พาไปผิดที่แย่กว่าปุ่มที่ไม่พาไปไหน: หาไม่เจอให้อยู่หน้ารายการเฉย ๆ
        // ไม่ขึ้น error เพราะรายการที่รีเฟรชแล้วก็ตอบคำถามผู้ใช้ได้อยู่ดี
        setTimeout(()=>{
          if(!mtData || !mtData.meetings) return;
          const hit=mtData.meetings.find(m=>m.id===id);
          if(hit) mtOpenMeeting(hit);
        }, 400);
      });
      api && api.onRunnerState && api.onRunnerState(s=>mtRunner.onData(s));
      api && api.getRunnerState && api.getRunnerState().then(s=>mtRunner.onData(s));
    }
    document.getElementById("mtSearch").oninput=e=>{
      // ต้องวาดแถวตัวกรองใหม่ด้วย เพราะเลขบนชิปนับหลังหักคำค้นแล้ว
      mtQuery=e.target.value; if(mtData){ renderMtFilters(); renderMtRows(); }
    };
    document.getElementById("mtRefresh").onclick=()=>api&&api.refreshMeetings&&api.refreshMeetings();
  }
  // ถามสถานะตัวรันทันทีที่เข้าแท็บ ไม่ต้องรอรอบ poll (นานได้ถึง 30 วิตอนที่ยังติดต่อไม่ได้)
  // — เปิด start-ui.bat ทีหลังแล้วต้องนั่งรอคือของจริงที่เจอ
  function onShow(){ if(mtRunner && mtRunner.onShow) mtRunner.onShow(); }

  // ===== การ์ดตั้งค่าของแท็บนี้ =====
  // markup ของการ์ดอยู่ใน widget.html เหมือนเดิม ที่ย้ายมาคือสายไฟ
  // การ์ดนี้เก็บสองอย่าง: โฟลเดอร์บันทึกประชุม (main process อ่าน) และพอร์ตของตัวรัน (meetingrun.js ใช้)
  let setMtDir,setMtStatus,setMtPort,setMtSave;
  function mountSettings(){
    setMtDir=document.getElementById('setMtDir'); setMtStatus=document.getElementById('setMtStatus');
    setMtPort=document.getElementById('setMtPort'); setMtSave=document.getElementById('setMtSave');
    setMtSave.onclick=()=>{
      const api=shell().api;
      const dir=setMtDir.value.trim();
      if(!dir){ setMtStatus.className='set-status err'; setMtStatus.textContent='กรอก path ก่อน'; return; }
      // พอร์ตว่าง = กลับไปใช้ 8765 ไม่ใช่ error — คนส่วนใหญ่ไม่เคยแก้ UI_PORT
      const portRaw=setMtPort.value.trim();
      const port=portRaw===''?8765:Number(portRaw);
      if(!Number.isInteger(port)||port<1||port>65535){
        setMtStatus.className='set-status err'; setMtStatus.textContent='พอร์ตต้องเป็นเลข 1-65535'; return;
      }
      api && api.saveRunnerConfig && api.saveRunnerConfig({port});
      setMtSave.disabled=true;
      api.saveMeetingsDir(dir).then(()=>{
        setMtSave.disabled=false;
        setMtStatus.className='set-status ok';
        setMtStatus.textContent='บันทึกแล้ว';
      });
    };
  }
  function loadSettings(){
    setMtStatus.textContent=''; setMtStatus.className='set-status';
    const api=shell().api;
    api && api.getMeetingsDir && api.getMeetingsDir().then(dir=>{ setMtDir.value=dir||''; });
    api && api.getRunnerConfig && api.getRunnerConfig().then(cfg=>{ setMtPort.value=(cfg&&cfg.port)||''; });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.tabs.meeting = { key:"mt", settingsCard:'cardMeetings', mount, mountSettings, loadSettings, onData, onShow };

  // เปิดทาง node --test แบบเดียวกับ tab-grafana.js — เฉพาะ parser ของ summary.meta.md
  // ที่ไม่ต้องใช้ DOM (renderMeta ใช้ esc จาก global.COWORK.util เลยไม่ export)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseMeta, splitCounts, parseWords, parseSpots };
  }
})(typeof window !== 'undefined' ? window : globalThis);
