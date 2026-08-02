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
  // ร่างคำที่จะส่งเข้า glossary + สถานะไฟล์ปลายทาง + ผลการส่งครั้งล่าสุด
  // รีเซ็ตทุกครั้งที่เปลี่ยนประชุม (mtOpenMeeting) เพราะร่างผูกกับประชุมเดียว
  // rows คีย์ด้วยเลข section (si) -- Minor 8: กันหัวข้อแบบคำสองหัวข้อในประชุมเดียวแย่งกันใช้
  // array แบนก้อนเดียว (ดูคอมเมนต์จุด mtGloss.rows[si]=glossaryDraft(words) ใน renderMeta)
  let mtGloss={rows:{}, state:null, report:null};

  function mtDate(d){
    const dt=new Date(d+'T00:00:00');
    if(!d || isNaN(dt)) return d||'ไม่ระบุวัน';
    return `${D[dt.getDay()]} ${dt.getDate()} ${M[dt.getMonth()]} ${dt.getFullYear()}`;
  }
  function mtSize(n){ return n>=1048576 ? (n/1048576).toFixed(1)+' MB' : Math.round(n/1024)+' KB'; }

  // markdown เท่าที่ summary.md ใช้จริง: หัวข้อ 1-3 ระดับ, bullet (มีระดับย่อย), **ตัวหนา**, `code`, ตาราง Action items
  function mdInline(t){
    return esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`(.+?)`/g,'<code>$1</code>');
  }
  // "| a | b |" → ['a','b'] — เอา pipe หัว-ท้ายออกก่อนค่อยตัด
  function mdSplitRow(line){
    let s=line.trim();
    if(s.startsWith('|')) s=s.slice(1);
    if(s.endsWith('|')) s=s.slice(0,-1);
    return s.split('|').map(c=>c.trim());
  }
  const mdIsTableRow=line=>/^\|.*\|$/.test(line.trim());
  // แถวคั่นหัวตาราง "|---|---|" — ทุกช่องต้องเป็น dash ล้วน (มี : ได้เผื่อ align)
  const mdIsTableSep=line=>mdIsTableRow(line)&&mdSplitRow(line).every(c=>/^:?-{1,}:?$/.test(c));
  // คอลัมน์ "ความชัดเจน" ในตาราง action items ใช้แค่สองค่านี้ — ทำเป็น badge สีให้เห็นชัดกว่าตัวหนังสือเฉย ๆ
  function mdTableCell(t){
    const v=(t||'').trim();
    if(!v||v==='-') return '<span class="md-dash">–</span>';
    if(v==='คาดเดา') return `<span class="md-badge amber">${mdInline(v)}</span>`;
    if(v==='ชัดเจน') return `<span class="md-badge accent">${mdInline(v)}</span>`;
    return mdInline(t);
  }
  function mdTable(header,rows){
    const thead=`<tr>${header.map(h=>`<th>${mdInline(h)}</th>`).join('')}</tr>`;
    const tbody=rows.map(r=>`<tr>${header.map((_,i)=>`<td>${mdTableCell(r[i])}</td>`).join('')}</tr>`).join('');
    return `<div class="md-table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
  }
  function mdRender(src){
    const out=[]; let ul=false, hn=0;
    const closeUl=()=>{ if(ul){ out.push('</ul>'); ul=false; } };
    const lines=String(src||'').replace(/\r/g,'').split('\n').map(l=>l.replace(/\s+$/,''));
    let i=0;
    while(i<lines.length){
      const line=lines[i];
      if(!line.trim()){ closeUl(); i++; continue; }
      let m;
      if((m=/^(#{1,3})\s+(.*)$/.exec(line))){
        closeUl(); hn++;
        out.push(`<h${m[1].length} id="mth${hn}">${mdInline(m[2])}</h${m[1].length}>`); i++; continue;
      }
      if(mdIsTableRow(line) && i+1<lines.length && mdIsTableSep(lines[i+1])){
        closeUl();
        const header=mdSplitRow(line);
        i+=2;
        const rows=[];
        while(i<lines.length && mdIsTableRow(lines[i])){ rows.push(mdSplitRow(lines[i])); i++; }
        out.push(mdTable(header,rows)); continue;
      }
      if((m=/^(\s*)[-*]\s+(.*)$/.exec(line))){
        if(!ul){ out.push('<ul>'); ul=true; }
        out.push(`<li${m[1].length>=2?' class="sub"':''}>${mdInline(m[2])}</li>`); i++; continue;
      }
      closeUl(); out.push(`<p>${mdInline(line)}</p>`); i++;
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
  // คำนำที่โมเดลใช้ขึ้นต้นฝั่ง "เดาว่าคือ" -- ตัดออกให้เหลือแต่ตัวคำ
  const GUESS_PREFIX=/^(?:ฟังไม่ออก\s+)?(?:เดาว่าคือ|เดาว่าเป็น|น่าจะเป็น|น่าจะคือ)\s+/;
  // ร่าง entry สำหรับส่งเข้า glossary.md จากแถว parseWords
  //
  // วัดกับประชุมจริง (Stanup 2026-07-31, 32 แถว): แปลงอัตโนมัติได้ 24 อีก 8 ฝั่งขวาเป็น
  // *ประโยค* ไม่ใช่คำ ("เดาว่าเป็นชื่อผู้ผลิต POS รายหนึ่ง สะกดยังไม่แน่") แถวพวกนั้นจึง
  // ไม่ติ๊กให้ แต่ยังโชว์คำผิดไว้ให้กรอกคำถูกเอง -- ทิ้งไปเลยจะเสียแถวที่มีค่าที่สุดบางแถว
  function glossaryDraft(words){
    return (words||[]).map(w=>{
      // วงเล็บในฝั่งซ้ายเป็นบริบทที่โมเดลใส่มา ไม่ใช่คำที่ถอดเพี้ยน
      const forms=String(w.heard||'').replace(/\s*\([^)]*\)/g,'')
        .split('/').map(s=>s.trim()).filter(Boolean);
      const guess=String(w.guess||'');
      const hasPrefix=GUESS_PREFIX.test(guess);
      const term=hasPrefix?guess.replace(GUESS_PREFIX,'').trim():'';
      // "หรือ" = โมเดลเสนอสองคำตอบ, เกิน 3 คำ = เป็นประโยคไม่ใช่คำ
      const clean=hasPrefix && !!term && !term.includes('หรือ') && term.split(/\s+/).length<=3;
      return {heard:w.heard, n:w.n, forms, term:clean?term:'', section:'exact',
              tick:clean && forms.length>0};
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
    mtGloss={rows:{}, state:null, report:null};
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
  // "อยู่ใน glossary แล้ว" — ดูจากคำผิดทุกตัวของแถวนั้น ไม่ใช่คำถูก เพราะคำถูกเดียวกัน
  // อยู่ได้หลายชั้น กฎนี้ต้องมีที่เดียว: ป้ายในแถวกับตัวเลขบนปุ่มต้องเลื่อนตามกันเสมอ
  // ถ้าแยกเขียนสองที่ วันที่แก้กฎจะเหลือที่หนึ่งที่แก้ไม่ตาม แล้วปุ่มจะโกหกเงียบ ๆ
  //
  // Important 4: ต้องดู known เฉพาะ "section เป้าหมายของแถวนั้น" เท่านั้น ไม่ใช่ union รวมทุก
  // section -- ของเดิม known เป็น Set แบนรวมทุกฟอร์มจากทุก section เข้าด้วยกัน ฟอร์ม "proof"
  // ที่มีอยู่จริงใน fuzzy (→ Kubernetes) จึงทำให้แถว exact ที่บังเอิญใช้ฟอร์ม "proof" เหมือนกัน
  // (แต่ตั้งใจชี้ไปคำถูกคนละตัว) ถูกตีว่า "อยู่ใน glossary แล้ว" ทั้งที่ planWrite จะเขียนให้
  // จริง ๆ (fuzzy กับ exact เป็นคนละบรรทัด คนละบทบาทกันโดยสิ้นเชิง) known จึงต้องเป็น
  // Map<section, Set<form>> ไม่ใช่ Set แบนเดียว
  const isDone = (row, known) => {
    const set = known.get(row.section);
    return !!set && row.forms.length > 0 && row.forms.every(f => set.has(f));
  };
  // ส่งได้เมื่อ: ติ๊กแล้ว AND ยังไม่อยู่ใน glossary (Task 7 ใช้ตัวเดียวกันตอนประกอบ payload)
  const isSendable = (row, known) => row.tick && !isDone(row, known);
  // Map<section, Set<คำผิด>> ของ glossary.md -- ที่เดียวที่คำนวณ known ใช้ร่วมกันทั้ง renderMeta
  // (วาดป้าย/ตัวเลขปุ่ม) และ sendGlossary (คัดแถวที่จะส่งจริง) กันสองที่เพี้ยนไม่ตรงกัน
  // รับพารามิเตอร์ state ได้ตรง ๆ (ไม่บังคับอ่าน mtGloss.state เสมอ) เพื่อให้ทดสอบแยกได้โดย
  // ไม่ต้องพึ่ง DOM/mtGloss -- เรียกเปล่า ๆ ใน renderMeta/sendGlossary ยังใช้ mtGloss.state ตามเดิม
  function glossKnown(state){
    const known=new Map();
    const sections=(state||mtGloss.state)&&(state||mtGloss.state).sections;
    if(sections)
      for(const [section,bucket] of Object.entries(sections)){
        const set=new Set();
        for(const forms of Object.values(bucket)) forms.forEach(f=>set.add(f));
        known.set(section,set);
      }
    return known;
  }
  // คีย์ (section, term) เดียวกับที่ planWrite ใช้จัดกลุ่ม entries -- ต่อด้วย \u0000 กัน
  // ปัญหาเดียวกับที่คอมเมนต์ groups ใน glossary.js อธิบายไว้ (ต่อ string ตรง ๆ สอง section/term
  // ต่างคู่กันอาจได้ผลลัพธ์เดียวกัน) \u0000 ไม่มีทางโผล่ในคำที่พิมพ์ผ่าน UI ปกติ
  const rowKey=r=>r.section+'\u0000'+r.term;
  // Important 3: แถวหนึ่ง "ถูกเขียนแล้ว" ก็ต่อเมื่อมี entry ใน added/merged ที่ (section,term)
  // ตรงกับแถวนั้น -- ห้ามเทียบด้วยฟอร์ม (คำผิด) เพราะสอง entries ในคอลเดียวกันแชร์ฟอร์มซ้ำกันได้
  // (เช่น row1 ['a','b'] เขียนสำเร็จ, row2 ['b','c'] ถูกปฏิเสธทั้งหมด -- 'b' ไปโผล่ใน forms
  // ของทั้งสอง entry ถ้า match ด้วยฟอร์ม row2 จะถูกเคลียร์ติ๊กทั้งที่ไม่มีอะไรของมันถูกเขียนเลย)
  // planWrite รวม entries ด้วย JSON.stringify([section,term]) มาก่อนแล้ว คู่นี้จึงไม่ซ้ำกันเองในคอลเดียว
  //
  // บริสุทธิ์ล้วน (ไม่แตะ DOM/mtGloss) เพื่อให้ทดสอบแยกได้โดยไม่ต้องพึ่ง harness ของ DOM
  function landedRows(res){
    const landed=new Set();
    // ใช้ rowKey ตัวเดียวกับฝั่งแถว -- เขียนนิพจน์คีย์แยกสองที่ วันที่แก้รูปแบบคีย์
    // จะเหลือที่หนึ่งที่แก้ไม่ตาม แล้วจะไม่มีแถวไหน match เลย ติ๊กค้างทุกแถวโดยไม่มีอะไรฟ้อง
    if(res) [...(res.added||[]), ...(res.merged||[])].forEach(e=>landed.add(rowKey(e)));
    return landed;
  }

  // แบบ B (ตารางตรวจงาน) ที่เลือกจาก summarymeta-mock.html — แถบ key:value บนสุด แล้วต่อด้วย
  // ทุกหัวข้อ ## ที่ parseMeta เจอ แยกเลย์เอาต์ตามว่า bullet ส่วนใหญ่ในหัวข้อนั้นมี "→" หรือไม่
  function renderMeta(meta){
    const row=(k,v,cls)=>v?`<dt>${esc(k)}</dt><dd class="${cls||''}">${v}</dd>`:'';
    const counts=a=>a.map(i=>esc(i.term)+(i.n?` <span style="color:var(--dim)">${esc(i.n)}</span>`:'')).join(' · ');
    const SECTIONS=['exact','fuzzy','project-names','aliases'];
    // คำที่อยู่ใน glossary แล้ว -- ดูจาก "คำผิด" ไม่ใช่คำถูก เพราะคำถูกเดียวกันอยู่ได้หลายชั้น
    const known=glossKnown();
    const sec=(s,si)=>{
      const words=parseWords(s.body), spots=parseSpots(s.body);
      const looksLikeWords=words.filter(w=>w.heard).length>words.length/2;
      if(!looksLikeWords){
        const rows=spots.map(p=>`<div class="mtq-spot">
              <span class="ts">${esc(p.ts||'—')}</span><span class="tx">${esc(p.tx)}</span></div>`).join('');
        return `<div class="mtq-sec"><h4><span>${esc(s.title)}</span><span class="n">${spots.length}</span></h4>${rows}</div>`;
      }
      // หัวข้อแบบ "คำ" เท่านั้นที่ส่งเข้า glossary ได้
      //
      // Minor 8: มี key ตาม si (เลข section) ไม่ใช่ array แบนก้อนเดียว -- ของเดิม mtGloss.rows
      // เป็น array เดียวใช้ร่วมกับ "if(!mtGloss.rows)" (ธงตั้งครั้งเดียว) ถ้าประชุมหนึ่งมี
      // หัวข้อแบบคำสองหัวข้อ หัวข้อที่สองจะเห็นธงตั้งแล้วจากหัวข้อแรก แล้วเอาแถวของหัวข้อแรก
      // มาวาดซ้ำใต้หัวของตัวเอง (ข้อมูลผิดที่) วันนี้ไม่มีไฟล์จริงที่มีสองหัวข้อแบบนี้ แต่การ key
      // แยกตาม si ไว้ตั้งแต่ตอนนี้ราคาถูกกว่าการตามแก้บั๊กทีหลัง
      if(!mtGloss.rows[si]) mtGloss.rows[si]=glossaryDraft(words);
      const secRows=mtGloss.rows[si];
      // คำนวณครั้งเดียวต่อแถว แล้วใช้ร่วมกับ isSendable ที่เรียก isDone ตัวเดียวกัน
      const rowDone=secRows.map(r=>isDone(r,known));
      const rows=secRows.map((r,i)=>{
        const done=rowDone[i];
        return `<div class="mtq-word pick${done?' done':''}" data-gsi="${si}" data-gi="${i}">
          ${done
            ? `<span class="gdone">✓ อยู่ใน glossary แล้ว</span>`
            : `<input type="checkbox" class="gk" ${r.tick?'checked':''} title="เลือกส่งเข้า glossary">`}
          <input class="gin wrong" value="${esc(r.forms.join(', '))}" placeholder="คำผิด1, คำผิด2"${done?' disabled':''}>
          <span class="ar">→</span>
          <input class="gin right" value="${esc(r.term)}" placeholder="พิมพ์คำถูก"${done?' disabled':''}>
          <select class="gsec"${done?' disabled':''}>
            ${SECTIONS.map(x=>`<option value="${x}"${r.section===x?' selected':''}>${x}</option>`).join('')}
          </select>
          ${r.n?`<span class="n">${esc(r.n)}</span>`:''}</div>`;
      }).join('');
      const n=secRows.filter(r=>isSendable(r,known)).length;
      // Important 2: mtGloss.sending ต้องเช็คตรงนี้ด้วย ไม่ใช่แค่ตอน onclick -- ปุ่มนี้ถูกสร้างใหม่
      // ทุกครั้งที่ renderMtReader() รัน (เช่นตอนติ๊ก checkbox มือ) ถ้าไม่เช็ค DOM node ใหม่จะ
      // enabled เสมอไม่ว่า request เดิมจะยังค้างอยู่หรือเปล่า ปุ่มเดิมที่ disabled ไว้ตอน onclick
      // ใช้ไม่ได้อีกแล้วเพราะถูก innerHTML ทับไปแล้ว
      const sending=!!mtGloss.sending;
      return `<div class="mtq-sec" data-gsec="${si}">
        <h4><span>${esc(s.title)}</span>
          <button class="gsend"${(n&&!sending)?'':' disabled'}>${sending?'กำลังส่ง…':`ส่งเข้า glossary (${n})`}</button></h4>
        ${renderGlossReport()}${rows}</div>`;
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
  // ผลการส่งครั้งล่าสุด -- สตริงว่างเมื่อยังไม่เคยกด (Task 7 เป็นคนตั้งค่า mtGloss.report)
  function renderGlossReport(){
    const rep=mtGloss.report;
    if(!rep) return '';
    if(rep.error) return `<div class="mtq-report"><div class="err">⚠ ${esc(rep.error)}</div></div>`;
    const line=(tag,cls,txt,why)=>`<div class="row"><span class="tag ${cls}">${tag}</span>
      <span class="why"><strong>${esc(txt)}</strong>${why?' — '+esc(why):''}</span></div>`;
    const body=[
      ...rep.added.map(e=>line('เพิ่มใหม่','add',`${e.section}  ${e.term} ← ${e.forms.join(', ')}`,'')),
      ...rep.merged.map(e=>line('รวมบรรทัดเดิม','mrg',`${e.section}  ${e.term} ← ${e.forms.join(', ')}`,`บรรทัด ${e.line}`)),
      ...rep.skipped.map(e=>line('ข้าม','skp',`${e.section}  ${e.term}`,e.reason)),
      ...rep.warnings.map(e=>line('เตือน','wrn',`${e.section}  ${e.term} ← ${e.form}`,e.reason)),
      ...rep.conflicts.map(e=>line('ชน · ไม่เขียน','cfl',`${e.section}  ${e.term} ← ${e.form}`,e.reason)),
    ].join('');
    const sum=`เพิ่มใหม่ ${rep.added.length} · รวมเข้าบรรทัดเดิม ${rep.merged.length} · `+
      `ข้าม ${rep.skipped.length} · เตือน ${rep.warnings.length} · ชน ${rep.conflicts.length}`;
    return `<div class="mtq-report"><div class="sum">${esc(sum)}</div>${body}</div>`;
  }
  // ส่งแถวที่ "ส่งได้" จริงเข้า glossary.md แล้ววาดผลกลับที่เดิม
  //
  // ใช้ isSendable+known ตัวเดียวกับปุ่ม ไม่ใช่แค่ r.tick -- แถวที่อยู่ใน glossary แล้วไม่มี
  // checkbox ให้ติ๊กใหม่ แต่ยังอาจมี tick:true ค้างมาจาก glossaryDraft() ถ้าส่งแถวนั้นไปด้วย
  // จะได้รายงาน "ข้าม" ที่ไม่มีความหมายอะไรกับผู้ใช้
  //
  // แถวที่ติ๊กแต่ยังไม่มีคำถูกถือเป็น error ฝั่ง UI ไม่ส่งไปให้ main ตัดสิน -- ผู้ใช้ต้อง
  // เห็นว่าแถวไหนขาด ไม่ใช่ได้รายงาน "ข้าม" กลับมาทีหลังโดยไม่รู้ว่าต้องทำอะไร
  function sendGlossary(m, btn){
    const api=shell().api;
    if(!api||!api.appendGlossary) return;
    // gloss = ก้อน mtGloss ของประชุม m ตัวจริง capture ไว้ ณ ตอนกดปุ่ม -- ห้ามอ้าง mtGloss สด
    // ใน callback ข้างล่าง เพราะ mtGloss เป็น module-level binding เดี่ยว ถ้าผู้ใช้เปลี่ยนไปเปิด
    // ประชุมอื่นก่อนคำตอบ IPC จะมาถึง mtOpenMeeting จะสลับ mtGloss ไปชี้ก้อนใหม่ของประชุมอื่นแล้ว
    // แม้แต่ mtGloss.sending=false ก็ต้องเขียนลง gloss (ก้อนเดิม) ไม่ใช่ mtGloss สด — ไม่งั้นถ้า
    // ประชุมใหม่กำลังส่งอยู่พอดี คำตอบเก่าของประชุม A จะไปเคลียร์ธง sending ของประชุม B แทน
    const gloss=mtGloss;
    // Important 2: gloss.sending คือธงกันกดซ้ำตัวจริง -- ต้องอยู่บนก้อน mtGloss (รอด re-render)
    // ไม่ใช่ local variable หรือ btn.disabled อย่างเดียว เพราะติ๊ก checkbox ระหว่างรอผลจะเรียก
    // renderMtReader() ซึ่งสร้างปุ่ม .gsend ตัวใหม่ที่ enabled เสมอ (ปุ่มเดิมที่ disabled ไว้
    // ถูก innerHTML ทับไปแล้ว) ธงนี้ต้องถูกเช็คทั้งตรงนี้ (กันคลิกซ้ำ) และในการวาดปุ่มที่ renderMeta
    if(gloss.sending) return;
    const known=glossKnown();
    // Minor 8: gloss.rows คีย์ตาม section index (si) แล้ว -- แบนรวมทุก section เป็น array
    // เดียวก่อนคัดแถวที่ส่งได้ ไม่งั้นแถวของหัวข้อที่สองเป็นต้นไปจะหายไปจากการส่งทั้งหมด
    const allRows=Object.values(gloss.rows||{}).flat();
    const picked=allRows.filter(r=>isSendable(r,known));
    const blank=picked.filter(r=>!r.term||!r.forms.length);
    if(blank.length){
      gloss.report={error:`มี ${blank.length} แถวที่ติ๊กไว้แต่ยังกรอกไม่ครบ — ต้องมีทั้งคำผิดและคำถูก`,
        added:[],merged:[],skipped:[],warnings:[],conflicts:[]};
      renderMtReader(); return;
    }
    if(!picked.length) return;
    gloss.sending=true;
    btn.disabled=true; btn.textContent='กำลังส่ง…';
    const entries=picked.map(r=>({term:r.term, forms:r.forms, section:r.section}));
    // Critical 1: m คือประชุมที่ถืออยู่ตอนกด capture ไว้ในพารามิเตอร์ของฟังก์ชันนี้แล้ว (ไม่ใช่
    // อ่าน mtOpen สดตอน .then รัน) — คำตอบ IPC นี้อาจมาถึงหลังผู้ใช้กลับไปหน้ารายการแล้วเปิด
    // ประชุมอื่น ทุก branch ข้างล่างนี้ (สำเร็จ / {ok:false} / reject) ต้องเช็ค mtOpen===m &&
    // mtTab==='q' ก่อนเขียน gloss.report/rows/state หรือวาดหน้าใหม่ทุกครั้ง ไม่งั้นผลของประชุม A
    // จะไปเขียนทับ/โผล่บนจอของประชุม B ที่ผู้ใช้เพิ่งเปิด (เขียนลง gloss เสมอ ไม่ใช่ mtGloss สด
    // เพราะ mtOpen===m แปลว่า mtGloss ยังชี้ก้อนเดียวกับ gloss อยู่ -- mtOpenMeeting สลับทั้งคู่
    // พร้อมกันเสมอ ไม่มีทางที่ mtOpen จะยังเป็น m แต่ mtGloss สลับไปแล้ว)
    api.appendGlossary(entries, {title:m.title, date:m.date}).then(res=>{
      gloss.sending=false;
      if(mtOpen!==m || mtTab!=='q') return;
      if(!res||!res.ok){
        gloss.report={error:(res&&res.error)||'ส่งไม่สำเร็จ',
          added:[],merged:[],skipped:[],warnings:[],conflicts:[]};
        renderMtReader(); return;
      }
      gloss.report=res;
      // Important 3: เคลียร์ติ๊กเฉพาะแถวที่มี entry ใน added/merged ตรง (section,term) ของแถวนั้น
      // จริง ๆ ไม่ใช่จับคู่ด้วยฟอร์ม -- สอง entries ในคอลเดียวกันแชร์ฟอร์มซ้ำกันได้ (row1 ['a','b']
      // เขียนสำเร็จ, row2 ['b','c'] ถูกปฏิเสธทั้งหมด) จับด้วยฟอร์มจะไปเคลียร์ติ๊ก row2 ทั้งที่ไม่มี
      // อะไรของมันถูกเขียนเลย ดูรายละเอียดที่คอมเมนต์ landedRows() ด้านบน
      const landed=landedRows(res);
      allRows.forEach(r=>{ if(r.tick && landed.has(rowKey(r))) r.tick=false; });
      // อ่านสถานะไฟล์ใหม่ ป้าย "อยู่ใน glossary แล้ว" จะได้ตรงกับไฟล์จริงหลังเขียน
      api.getGlossaryState().then(st=>{
        if(mtOpen!==m || mtTab!=='q') return;   // Critical 1: เช็คซ้ำ -- คำตอบรอบนี้มาช้าได้เหมือนกัน
        gloss.state=st||{sections:{}};
        renderMtReader();
      });
    }, ()=>{
      // Important 2: promise reject (เช่น IPC ล่ม) ก็ต้องเคลียร์ธงเหมือนกัน ไม่งั้นปุ่มค้าง
      // "กำลังส่ง…" ถาวร ผู้ใช้ retry ไม่ได้อีกเลยจนกว่าจะรีสตาร์ตแอป
      gloss.sending=false;
      if(mtOpen!==m || mtTab!=='q') return;
      gloss.report={error:'ส่งไม่สำเร็จ', added:[],merged:[],skipped:[],warnings:[],conflicts:[]};
      renderMtReader();
    });
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
      // อินพุตทุกช่องเขียนกลับเข้า mtGloss.rows ทันที -- ไม่ re-render ระหว่างพิมพ์
      // (จะเด้ง cursor) วาดใหม่เฉพาะตอนติ๊กหรือเปลี่ยน section เพราะตัวเลขบนปุ่ม/ป้าย "อยู่ใน
      // glossary แล้ว" ต้องเปลี่ยนตาม -- Minor 8: อ่านจาก mtGloss.rows[si] (คีย์ตาม section)
      body.querySelectorAll('[data-gi]').forEach(el=>{
        const si=Number(el.dataset.gsi);
        const r=(mtGloss.rows[si]||[])[Number(el.dataset.gi)];
        if(!r) return;
        const wrong=el.querySelector('.gin.wrong');
        const right=el.querySelector('.gin.right');
        const sel=el.querySelector('.gsec');
        const box=el.querySelector('.gk');
        if(wrong) wrong.oninput=()=>{ r.forms=wrong.value.split(',').map(s=>s.trim()).filter(Boolean); };
        if(right) right.oninput=()=>{ r.term=right.value.trim(); };
        // Important 4: section ที่เลือกกำหนดว่า known ของแถวนี้ต้องดูชุดไหน (isDone ตรวจแค่
        // known.get(row.section)) เปลี่ยน section แล้วป้าย "อยู่ใน glossary แล้ว"/ตัวเลขบนปุ่ม
        // อาจเปลี่ยนตาม จึงต้อง re-render ตรงนี้ (ต่างจาก wrong/right ที่พิมพ์แล้วห้ามเด้ง cursor)
        if(sel) sel.onchange=()=>{ r.section=sel.value; renderMtReader(); };
        if(box) box.onchange=()=>{ r.tick=box.checked; renderMtReader(); };
      });
      const send=body.querySelector('.gsend');
      if(send) send.onclick=()=>sendGlossary(m, send);
      const api=shell().api;
      // โหลดครั้งเดียวต่อประชุม แล้ววาดใหม่ให้แถวที่อยู่ใน glossary แล้วขึ้นป้าย
      if(meta && !mtGloss.state && api && api.getGlossaryState){
        api.getGlossaryState().then(st=>{
          mtGloss.state=st||{sections:{}};
          if(mtOpen===m && mtTab==='q') renderMtReader();
        });
      }
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
    module.exports = { parseMeta, splitCounts, parseWords, parseSpots, mdRender, glossaryDraft, landedRows,
      isDone, glossKnown, renderMeta };
  }
})(typeof window !== 'undefined' ? window : globalThis);
