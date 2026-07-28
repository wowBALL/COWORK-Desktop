// ===== ตัวกรอง ปี / เดือน / วัน (ใช้ร่วมกันทั้ง Meeting และ QA test) =====
// รับลิสต์ที่ "หักตัวกรองแถวอื่นของแท็บนั้นแล้ว" + ตัวดึงวันที่รูปแบบ YYYY-MM-DD + sel={y,m,d}
// แล้วคืน HTML ของแถวชิปเท่าที่ควรโชว์ (0–3 แถว)
//
// กฎที่ตกลงไว้: ชั้นไหนมีค่าเดียวให้ข้ามไปเลย ตอนข้อมูลยังอยู่ปีเดียวเดือนเดียวจะได้กดวันได้ทันที
// เหมือนเดิม แล้วค่อยงอกแถวเดือน/ปีขึ้นมาเองเมื่อข้อมูลสะสมข้ามเดือนข้ามปีจริง
//
// อีกกฎที่ห้ามพลาด: ชั้นล่างจะโชว์ได้ก็ต่อเมื่อชั้นบนถูกจำกัดเหลือค่าเดียวแล้ว (เลือกเอง หรือมีค่าเดียวอยู่แล้ว)
// ไม่งั้นป้ายมันกำกวม — เลข 18 จะหมายถึงทั้ง 18 มิ.ย. และ 18 ก.ค. พร้อมกัน แยกไม่ออก
//
// ตัว HTML ที่คืนมาใช้คลาสกลาง (.row-label / .chips / .chip) ที่นิยามไว้ใน widget.html
// ไม่มี CSS เป็นของตัวเอง เพราะชิปหน้าตาเดียวกันนี้ถูกใช้ในตัวกรองอื่นของทุกแท็บอยู่แล้ว
(function (global) {
  'use strict';
  // ใต้ node (ตอนเขียนเทส) ไม่มี window.COWORK ให้ require เอาเอง — แต่ที่นั่นจะได้แค่ M
  // เพราะ esc ต้องใช้ document ฝั่ง util.js เลยไม่ export ออกมา · dateMatch ใช้ได้ปกติ
  const util = (global.COWORK && global.COWORK.util) ||
    (typeof require !== 'undefined' ? require('./util.js') : {});
  const {M, esc} = util;

  const DF_ORDER=['y','m','d'];
  const DF_CUT={y:d=>d.slice(0,4), m:d=>d.slice(0,7), d:d=>d};
  function dateMatch(sel,d){
    if(!sel.y&&!sel.m&&!sel.d) return true;      // ไม่ได้กรอง — รายการที่ไม่มีวันที่ก็ต้องเห็น
    if(!d) return false;
    return (!sel.y||d.slice(0,4)===sel.y)&&(!sel.m||d.slice(0,7)===sel.m)&&(!sel.d||d===sel.d);
  }
  // แก้ sel ในตัวมันเอง (mutate) ให้เหลือแต่ค่าที่ยังเลือกได้จริง — ต้องล้างตรงนี้ก่อนที่ผู้เรียก
  // จะเอา sel ไปนับเลขชิปแถวอื่น ไม่ใช่ล้างทีหลัง (เคยพลาดมาแล้วตอนลบ source: เลขขึ้น 0 ทั้งแถวทั้งที่ลิสต์ยังมีของ)
  function dateFilterHtml(list,getDate,sel){
    const dates=list.map(getDate).filter(Boolean);
    const mth=v=>M[+v.slice(5,7)-1];   // M มาจาก util.js นาฬิกาหัวหน้าต่างกับ mtDate() ใช้ตัวเดียวกันนี้
    // ป้ายวันเป็นเลขเปล่าได้ก็ต่อเมื่อแถวเดือนโชว์อยู่ ถ้าแถวเดือนถูกข้ามไป (ข้อมูลมีเดือนเดียว)
    // ต้องแปะชื่อเดือนไว้กับวันแทน ไม่งั้นเหลือ "27" ลอยๆ ไม่รู้เดือนอะไร
    const fmt={y:v=>v, m:mth, d:v=>+v.slice(8,10)+(mRowShown?'':' '+mth(v))};
    const allLabel={y:'ทุกปี', m:'ทั้งปี', d:'ทั้งเดือน'};
    const rowLabel={y:'ปี', m:'เดือน', d:'วัน'};
    let pool=dates, html='', confined=true, mRowShown=false;
    DF_ORDER.forEach((k,i)=>{
      const cut=DF_CUT[k];
      const vals=[...new Set(pool.map(cut))].sort().reverse();
      const show=confined&&vals.length>1;
      // ล้างค่าที่ค้างเมื่อ (ก) หายไปจากข้อมูลแล้ว หรือ (ข) แถวนี้ไม่ได้โชว์ทั้งที่มีให้เลือกหลายค่า
      // ปล่อยค้างไว้จะกลายเป็นตัวกรองล่องหน — รายการหายไปเฉยๆ โดยไม่มีชิปไหนติดไฟให้กดออก
      //
      // เงื่อนไข (ก) ห้ามมี vals.length>1 มาคร่อม! ถ้าคร่อมจะพังตอนข้อมูลใหม่เหลือค่าเดียว
      // และค่าที่ค้างไม่ใช่ค่านั้น (เช่นค้าง 2025 แต่ข้อมูลใหม่มีแต่ 2026) — แถวถูกข้ามเพราะมีค่าเดียว
      // ค่าค้างเลยไม่ถูกล้าง แล้วกรองจนเหลือ 0 รายการแบบไม่มีชิปให้กดออก
      // ส่วน (ข) ต้องมี vals.length>1 จริง เพราะถ้ามีค่าเดียวและค้างค่านั้นพอดี กรองไปก็ได้ผลเท่าเดิม
      if(sel[k]&&(!vals.includes(sel[k])||(!show&&vals.length>1)))
        DF_ORDER.slice(i).forEach(x=>sel[x]=null);
      if(show){
        if(k==='m') mRowShown=true;
        html+=`<div class="row-label">${rowLabel[k]}</div><div class="chips" data-df="${k}">`+
          `<div class="chip${sel[k]?'':' active'}" data-v="">${allLabel[k]}<span class="n">${pool.length}</span></div>`+
          vals.map(v=>`<div class="chip${sel[k]===v?' active':''}" data-v="${esc(v)}">${fmt[k](v)}`+
            `<span class="n">${pool.filter(x=>cut(x)===v).length}</span></div>`).join('')+
          `</div>`;
      }
      if(sel[k]) pool=pool.filter(x=>cut(x)===sel[k]);
      confined=confined&&(vals.length<=1||!!sel[k]);
    });
    return html;
  }
  function wireDateFilter(el,sel,onChange){
    el.querySelectorAll('.chips[data-df]').forEach(row=>{
      const k=row.dataset.df, from=DF_ORDER.indexOf(k);
      row.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
        DF_ORDER.slice(from).forEach(x=>sel[x]=null);   // เลือกชั้นบนใหม่ = ล้างชั้นล่างเสมอ
        sel[k]=c.dataset.v||null;
        onChange();
      });
    });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.dateFilter = {dateMatch, dateFilterHtml, wireDateFilter};

  // เปิดทาง node --test แบบเดียวกับ meetingrun.js
  if (typeof module !== 'undefined' && module.exports)
    module.exports = {dateMatch, dateFilterHtml, wireDateFilter};
})(typeof window !== 'undefined' ? window : globalThis);
