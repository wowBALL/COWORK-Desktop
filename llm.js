'use strict';

// พอร์ตตรรกะจาก meeting-notes/src/llm.py (_openai_compat_completer) มาเป็น JS สำหรับ
// main process ของ COWORK Desktop — ไม่มี Electron import (เหมือน grafana.js/qatest.js)
// จึงรันผ่าน node --test ได้ตรง โดยฉีด fetchImpl ปลอมแทนการยิงเน็ตจริง
// ดู docs/superpowers/specs/2026-08-04-qa-create-issue-design.md

// vision = ยิงจริงเข้า endpoint แล้ววัดมา ไม่ได้อนุมานจากชื่อรุ่น (ดู spec 2026-08-05):
// Qwen ตอบภาพคุมสองสีถูก 3/3 และถอดข้อความไทย+อังกฤษในสกรีนช็อต 1280×800 ได้ครบ
// ส่วน GLM ยังไม่เคยวัดได้สักครั้ง จึงถือว่าไม่รับรูปไว้ก่อน — ปลอดภัยกว่าเดาว่ารับได้
// (ไม่ใช่ของพัง: แจ้ง infra 2026-08-05 แล้วได้คำตอบว่าเครื่องถูกยืมไปรันเทสอื่นอยู่ ต่อไม่ติด
//  เป็นช่วง ๆ เป็นเรื่องปกติของ endpoint ที่แชร์กันทั้งองค์กร ถ้าวันไหนว่างค่อยยิงวัดจริง)
const PROVIDERS = {
  // ไม่ใช่ reasoning model — budget เล็กพอสำหรับร่าง issue สั้น ๆ
  'Qwen/Qwen3.6-35B-A3B': { maxTokens: 2048, vision: true },
  // reasoning model — max_tokens คุมผลรวมของ reasoning + คำตอบ ไม่ใช่คำตอบอย่างเดียว
  // ต้องกว้างกว่า Qwen มาก ไม่งั้น content ว่างเปล่าบ่อย (ดู meeting-notes/src/llm.py บรรทัด 24-29)
  'GLM-5.2': { maxTokens: 8192, vision: false },
  // ไม่ใช่ reasoning model เหมือน Qwen (ดู meeting-notes/src/llm.py บรรทัด 42-49)
  //
  // vision: false ที่นี่คือผลวัด ไม่ใช่การกันไว้ก่อน (2026-08-05) — ยิงภาพคุมสองสีเข้าไปจริง
  // ได้ HTTP 400 ใน 0.1 วินาที: "LilaRest/gemma-4-31B-it-NVFP4-turbo is not a multimodal
  // model" (ภาพเดียวกัน Qwen ตอบถูกใน 0.5 วินาที) สาเหตุไม่ใช่ข้อจำกัดของ Gemma 4 ซึ่งตัวจริง
  // เป็น multimodal — แต่ endpoint รัน build ที่ model card เขียนไว้เองว่าถอด vision/audio
  // encoder ออก แก้ที่โค้ดไม่ได้ ต้องให้เจ้าของ endpoint สลับ build
  //
  // budget กว้างกว่า Qwen เพราะไม่มีเหตุให้บีบ: meeting-notes วัดจริง 2026-08-05 แล้ว gemma4
  // ไม่เคยถูกตัดสักครั้ง (ทั้ง map ก้อนเล็กและ single-call ทั้งประชุม 84 นาที) และรับ input
  // ได้เกิน 100K token — 4096 คือค่าเดียวกับ GEMMA_MAP_MAX_TOKENS ที่นั่นใช้อยู่จริง
  // max_tokens เป็นเพดาน ไม่ใช่เป้า ตั้งกว้างไว้ไม่ได้ทำให้คำตอบสั้น ๆ แพงขึ้น
  'litellm/gemma4': { maxTokens: 4096, vision: false },
};
const DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B';
const REQUEST_TIMEOUT_MS = 30000;

function stripJsonFence(text) {
  const t = String(text || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1].trim() : t;
}

// tracker เป็น input ที่กำหนดโครงร่าง ไม่ใช่สิ่งที่ LLM ทาย (ผู้ใช้เลือก tracker ไว้ก่อนแล้ว)
//
// ── BMAD (2026-08-05) ──
// tracker หนึ่ง = งานคนละชนิด ที่คนคนละบทบาทเป็นคนเขียน และต้องการรายละเอียดคนละชุด
// ของเดิมให้แค่ "โครง" เหมือนกันหมดทุก tracker โมเดลเลยเติมหัวข้อครบแต่เนื้อในตื้น
// ตารางนี้เพิ่มอีกสองอย่างต่อ tracker: บทบาทที่ให้โมเดลสวม (role) และหลักตัดสินว่า
// "เขียนดีแล้ว" แปลว่าอะไรสำหรับงานชนิดนี้ (principle) กับคำถามที่คนทำงานชนิดนี้
// มักต้องถามกลับ (gaps -> ไปโผล่ที่ missing_info)
//
// เพิ่ม tracker ใหม่ = เพิ่ม key เดียวที่นี่ ค่าที่ไม่มี key ใช้ DEFAULT_PROFILE
const TRACKER_PROFILE = {
  Bug: {
    role: 'วิศวกร QA',
    structure: 'อาการ / ขั้นตอนที่ทำให้เกิด / ผลที่คาดว่าจะได้ / ผลที่ได้จริง / Environment / การประเมินความเสี่ยง',
    principle: 'เขียนให้ dev ทำซ้ำได้จริง แยกผลที่คาดกับผลจริงให้ขาด และประเมินความรุนแรงจากผลกระทบจริง',
    gaps: 'หน้าจอหรือ route ไหน ขนาดจอ/browser/OS ข้อมูลที่ใช้ทดสอบ เกิดทุกครั้งหรือบางครั้ง และผลที่ถูกต้องควรเป็นอย่างไร',
  },
  Feature: {
    role: 'Product Owner',
    structure: 'เป้าหมายและคุณค่า (ในฐานะ<ใคร> ต้องการ<อะไร> เพื่อ<ผลลัพธ์>) / เกณฑ์การยอมรับแบบ กำหนดว่า–เมื่อ–แล้วจะได้ (ต้องทดสอบได้) / ผลกระทบถ้าไม่ทำ / ขอบเขต / การประเมินความเสี่ยง',
    principle: 'ยึดหลัก INVEST — งานเล็กพอ มีคุณค่าชัด และเกณฑ์การยอมรับต้องวัดผลได้ ไม่ใช่พูดลอย ๆ',
    gaps: 'ใครคือผู้ใช้ เกณฑ์สำเร็จวัดอย่างไร ขอบเขตแค่ไหน มี business rule หรือเงื่อนไขพิเศษไหม และกระทบระบบหรือ integration ใด',
  },
  // Epic/Support คงดีไซน์เดิมคือโครงอิสระ (ตัดสินใจไว้ใน spec 2026-08-04) — งานสองชนิดนี้
  // รูปร่างต่างกันเกินกว่าจะบังคับหัวข้อได้ แต่ยังได้ชั้นบทบาท/หลักการ/คำถามเหมือน tracker อื่น
  Epic: {
    role: 'Product Owner ระดับ epic',
    structure: 'สรุปตามเนื้อหาที่ให้มา ไม่บังคับหัวข้อย่อย แต่ต้องมีย่อหน้าการประเมินความเสี่ยงเสมอ',
    principle: 'มองภาพใหญ่แล้วแตกเป็นเรื่องย่อยที่ทีมหยิบไปทำได้ พร้อมตัวชี้วัดความสำเร็จที่วัดได้',
    gaps: 'ตัวชี้วัดความสำเร็จคืออะไร อะไรอยู่นอกขอบเขต ลำดับความสำคัญของเรื่องย่อย และมี dependency กับทีมหรืองานอื่นไหม',
  },
  Support: {
    role: 'วิศวกร Support/Ops',
    structure: 'สรุปตามเนื้อหาที่ให้มา ไม่บังคับหัวข้อย่อย แต่ต้องมีย่อหน้าการประเมินความเสี่ยงเสมอ',
    principle: 'ระบุให้ชัดว่าใครกระทบและต้องทำอะไร ถ้าเป็นการเปลี่ยนระบบต้องมีแผนย้อนกลับเสมอ',
    gaps: 'ระบบหรือสาขาไหน จำนวนผู้กระทบ ความเร่งด่วน และเป็นเรื่องครั้งเดียวหรือการเปลี่ยนถาวร',
  },
};

// tracker ที่ไม่มีโปรไฟล์ — ปัจจุบัน UI มีแค่สี่ค่าใน TRACKER_PROFILE (widget.html:345-350)
// แต่ค่าเริ่มต้นของ draftIssue คือ 'Bug' และ Redmine ฝั่งอื่นเพิ่ม tracker ได้โดยไม่ผ่านที่นี่
// ตัวสำรองจึงต้องมีจริง ไม่ใช่ปล่อย undefined หลุดเข้าไปในพรอมป์
const DEFAULT_PROFILE = {
  role: 'นักวิเคราะห์ระบบ',
  structure: 'สรุปตามเนื้อหาที่ให้มา ไม่บังคับหัวข้อย่อย แต่ต้องมีย่อหน้าการประเมินความเสี่ยงเสมอ',
  principle: 'เรียบเรียงให้ทีม dev หยิบไปทำต่อได้ทันที ทุกข้อสรุปต้องอ้างอิงจากโน้ต ไม่แต่งเติมเอง',
  gaps: 'ข้อมูลสำคัญที่โน้ตยังไม่ได้บอกและ dev น่าจะต้องถามกลับ',
};

function profileFor(tracker) {
  return TRACKER_PROFILE[tracker] || DEFAULT_PROFILE;
}

function structureFor(tracker) {
  return profileFor(tracker).structure;
}

const RISK_LEVELS = ['Low', 'Fairly Low', 'Moderate', 'High', 'Very High'];

// ฟิลด์ที่ต้องมีในคำตอบ แยกตามภาษาที่เลือก — ชุดเดียวกับที่ schemaFieldsFor บอกในพรอมป์
function fieldsFor(language) {
  if (language === 'th') return ['subject_th', 'description_th'];
  if (language === 'en') return ['subject_en', 'description_en'];
  return ['subject_en', 'subject_th', 'description_en', 'description_th'];
}

// JSON Schema ที่ส่งไปให้ decoder บังคับ ไม่ใช่แค่ขอในพรอมป์
//
// ทำไมต้องเป็น json_schema ไม่ใช่ json_object (วัด 2026-08-05): json_object บังคับแค่ว่า
// ผลลัพธ์ต้องเป็น JSON ที่ถูกไวยากรณ์ ไม่ได้บังคับว่าต้องมีฟิลด์ไหนบ้าง — Qwen จึงปิดวงเล็บ
// ตั้งแต่ยังไม่เขียน suggested_risk_level กับ missing_info ได้ (5 ใน 12 เคส) โดย
// finish_reason ยังเป็น "stop" และใช้ไปแค่ 500 จาก 2048 token คือไม่ได้ถูกตัด แต่เลือก
// จบเอง ผลคือได้ JSON ที่ parse ผ่านแต่ข้อมูลหายเงียบ ๆ ซึ่งแย่กว่า parse พังที่มองเห็นได้
// required ใน schema ปิดช่องนี้ และ enum ยังกัน suggested_risk_level เพี้ยนไปในตัว
function responseSchemaFor(language) {
  const properties = {};
  for (const f of fieldsFor(language)) properties[f] = { type: 'string' };
  properties.suggested_risk_level = { type: 'string', enum: RISK_LEVELS };
  properties.missing_info = { type: 'array', items: { type: 'string' } };
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function schemaFieldsFor(language) {
  const risk = '"suggested_risk_level":"Low|Fairly Low|Moderate|High|Very High"';
  // missing_info ไม่ขึ้น Redmine — โชว์ในฟอร์มให้ผู้ใช้เติมก่อนส่งเท่านั้น จึงเป็นไทยเสมอ
  // ไม่ผูกกับ language ที่เลือก (ต่างจาก subject/description)
  const gaps = '"missing_info":["..."]';
  if (language === 'th') return `{"subject_th":"...","description_th":"...",${risk},${gaps}}`;
  if (language === 'en') return `{"subject_en":"...","description_en":"...",${risk},${gaps}}`;
  return `{"subject_en":"...","subject_th":"...","description_en":"...","description_th":"...",${risk},${gaps}}`;
}

// กฎชุดนี้มาจากการวัดจริง ไม่ใช่การเดา (ดู spec 2026-08-05): ตอนสั่งกว้าง ๆ ว่า "บรรยายทุกอย่าง
// ในภาพ" โมเดลอ่านข้อความไทยเพี้ยนโดยไม่ส่งสัญญาณ (กรอกข้อมูลให้ครบ → กรุณารอข้อมูลให้ครบ)
// นับปุ่มในกรอบสีแดงไม่ครบ และเติมคำขยายที่ภาพไม่ได้บอก พอสั่งแคบ + ห้ามเติมความเห็น วัดซ้ำ
// 5 รอบได้ถูก 5/5 — โน้ตของผู้ใช้จึงต้องเป็นข้อมูลหลัก ภาพเป็นแค่หลักฐานประกอบ
function imageRulesFor(images) {
  const list = images.map((im, i) => `ภาพที่ ${i + 1} = ${im.filename}`).join(' · ');
  return `\nผู้ใช้แนบสกรีนช็อตของ UI ที่มีปัญหามาด้วย ${images.length} ภาพ เรียงตามลำดับนี้: ${list}\n` +
    'โน้ตที่ผู้ใช้พิมพ์คือข้อมูลหลัก ภาพเป็นหลักฐานประกอบเท่านั้น ถ้าสิ่งที่เห็นในภาพขัดกับโน้ต ' +
    'ให้ยึดโน้ตเป็นหลัก แล้วเขียนข้อขัดแย้งนั้นลงใน missing_info\n' +
    'บรรยายเฉพาะสิ่งที่มองเห็นจริงในภาพ ห้ามเดาสาเหตุทาง code หรือ CSS ' +
    'ห้ามเติมคำขยายหรือความเห็นที่ภาพไม่ได้บอก ถ้าอ่านข้อความในภาพไม่ชัดให้เขียนว่า "ไม่แน่ใจ" ห้ามเดาคำ\n' +
    'อ้างถึงภาพในเนื้อหาด้วยคำว่า "ภาพที่ 1" เท่านั้น ห้ามเขียนชื่อไฟล์รูปและห้ามใส่แท็ก <img> ' +
    'ลงใน description เด็ดขาด ระบบจะแปะรูปให้เองตอนสร้าง issue ' +
    'ถ้าเขียนชื่อไฟล์ลงไปรูปใบนั้นจะหายจากเนื้อ issue';
}

// ── PCI DSS (2026-08-06) ──
// เพิ่มมุมข้อมูลบัตรชำระเงินเข้าในหัวข้อ "การประเมินความเสี่ยง" ที่ทุก tracker มีอยู่แล้ว
// ทำเป็น block เดี่ยวเหมือน languageRulesFor/imageRulesFor แทนการยัดเข้า TRACKER_PROFILE
// เพราะแบบนั้นต้องแก้ 5 ที่ (Bug/Feature/Epic/Support/DEFAULT) = บั๊กคลาส "แก้ไม่ครบ"
// วิธีนี้ครอบคลุม tracker ที่ Redmine เพิ่มมาทีหลังโดยอัตโนมัติด้วย
//
// ทำไมห้ามอ้างเลขข้อ requirement (สำคัญ อย่าเอาออก): วัดจริง 2026-08-06 แล้วโมเดลบน endpoint นี้
// ยกสิ่งที่ดูผิดปกติขึ้นเป็นบั๊กหลักทั้งที่ของจริงไม่ผิด 3 ใน 4 ครั้ง การอ้างเลขข้อคือการอ้าง
// ข้อเท็จจริงภายนอกที่มันตรวจสอบไม่ได้ ผลคือได้ "หลักฐานการประเมิน compliance" ที่เลขข้อผิด
// ซึ่งอันตรายกว่าไม่มีเลยเพราะดูน่าเชื่อถือ — ให้ประเมินผลกระทบได้ แต่ห้ามอ้างตัวบท
//
// สถานะที่สาม "ยืนยันไม่ได้จากโน้ต" ก็มาจากผลวัดเดียวกัน: ถ้าให้เลือกแค่ อยู่/ไม่อยู่
// ตอนโน้ตไม่พูดถึงบัตรเลย โมเดลจะถูกบีบให้ฟันธง "ไม่อยู่ในขอบเขต" = ยืนยันสิ่งที่มันไม่รู้
function pciRulesFor() {
  return '\nนอกจากเกณฑ์ข้างต้น ให้ประเมินมุมข้อมูลบัตรชำระเงิน (PCI DSS) ด้วยเสมอ\n' +
    'ข้อมูลที่นับว่าอยู่ในขอบเขต: ข้อมูลบัตร (เลขบัตร ชื่อผู้ถือบัตร วันหมดอายุ service code) ' +
    'และข้อมูลยืนยันตัวตน (track data เต็มแถบ CVV/CVC/CID PIN และ PIN block) — ' +
    'ถือว่าอยู่ในขอบเขตเมื่อหน้าจอ API log ฐานข้อมูล ไฟล์ export หรือข้อความ error ' +
    'รับ ส่ง เก็บ แสดง หรือประมวลผลข้อมูลเหล่านี้ รวมถึงส่วนที่เชื่อมต่อโดยตรงกับส่วนนั้น\n' +
    // ห้ามเขียนคำสั่งเป็น 'ให้เขียน "<คำ>"' — วัดแล้วโมเดลพิมพ์คำในเครื่องหมายคำพูดออกมาเป็น
    // บรรทัดจริง ๆ (เจอ "เพิ่ม" โผล่ท้าย description) และการอัดข้อห้ามซ้อนกันหลายชั้นในย่อหน้าเดียว
    // ทำให้ภาษาไทยที่ออกมาแตก สระ/วรรณยุกต์หายทั้งคำตอบ วัดได้ 0/3 ทันทีที่ใส่เข้าไป
    // ข้อห้ามเรื่องขอบเขตของสองส่วนย้ายไปอยู่กับกฎผลกระทบใน systemPromptFor แทน
    'ในหัวข้อ "การประเมินความเสี่ยง" ให้ต่อท้ายเป็นบรรทัดสุดท้ายของหัวข้อเสมอ แม้เคสจะไม่เกี่ยวกับบัตรเลย ' +
    'โดยไม่แทนที่หรือย่อการประเมินผลกระทบที่อยู่ก่อนหน้า และเลือกหนึ่งในสามรูปแบบนี้:\n' +
    '"PCI DSS: อยู่ในขอบเขต — <ข้อมูลชนิดไหนที่เกี่ยวข้อง> · ระดับ <Low|Fairly Low|Moderate|High|Very High> เพราะ <เหตุผล>"\n' +
    '"PCI DSS: ไม่อยู่ในขอบเขต — <เหตุผลสั้น ๆ ว่าทำไม>"\n' +
    '"PCI DSS: ยืนยันไม่ได้จากโน้ต — <สิ่งที่ต้องรู้เพิ่ม>" ใช้เมื่อโน้ตให้ข้อมูลไม่พอจะตัดสิน ' +
    'ห้ามเดาเองว่าไม่เกี่ยว และต้องเขียนคำถามที่ต้องถามกลับลงใน missing_info ด้วย\n' +
    'เกณฑ์เลือกสถานะ: ตอบ "ไม่อยู่ในขอบเขต" ได้เฉพาะเมื่อหน้าจอหรือฟีเจอร์นั้นไม่เกี่ยวกับการเงินเลย ' +
    'ถ้าเป็นงานในระบบที่เกี่ยวกับการเงิน ต้องนับทั้งชื่อไทยและชื่ออังกฤษที่ผู้ใช้อาจเขียนมาตรงตามที่เห็นบนหน้าจอ — ' +
    'โอนเงิน/transfer ชำระเงิน/payment/checkout/pay คืนเงิน/refund เรียกเก็บเงิน/billing ' +
    'จัดการบัตร/card wallet/top-up และการยืนยันตัวตนก่อนจ่าย — ' +
    'แต่โน้ตไม่ได้บอกว่าขั้นตอนนั้นแตะข้อมูลบัตรหรือไม่ ต้องตอบ "ยืนยันไม่ได้จากโน้ต" ' +
    'ห้ามสรุปว่าไม่อยู่ในขอบเขตเพียงเพราะโน้ตไม่ได้พูดถึงข้อมูลบัตร — การไม่พูดถึงไม่ใช่หลักฐานว่าไม่มี\n' +
    'ถ้าอยู่ในขอบเขต ให้ตอบ suggested_risk_level เป็นค่าที่สูงกว่า ระหว่างระดับ PCI กับระดับผลกระทบตามเกณฑ์ปกติ ' +
    'PCI ดันระดับขึ้นได้อย่างเดียว ห้ามใช้ระดับ PCI ที่ต่ำกว่ามาลดระดับที่ประเมินจากผลกระทบปกติ ' +
    '(เช่นบั๊กที่ทำให้ระบบชำระเงินล่มทั้งระบบแต่ข้อมูลบัตรไม่รั่ว ยังต้องเป็นระดับสูงตามผลกระทบ) ' +
    'ถ้าไม่อยู่ในขอบเขตหรือยืนยันไม่ได้ ให้ใช้เกณฑ์ปกติอย่างเดียว\n' +
    'ข้อห้ามของหัวข้อนี้: ถ้าจะอ้างถึงข้อกำหนดของ PCI DSS ให้เขียนแบบมีเงื่อนไขเสมอ ' +
    '(เช่น "น่าจะเกี่ยวกับข้อกำหนดเรื่องการเก็บข้อมูลบัตร") ห้ามยืนยันว่าตรงกับข้อใดแน่นอน ' +
    'ห้ามฟันธงว่าเคสนี้ละเมิดหรือไม่ละเมิด PCI DSS และห้ามรับรองว่าปลอดภัยหรือไม่มีปัญหาด้าน compliance ' +
    'ให้เขียนได้แค่ว่ากระทบหรืออาจกระทบข้อมูลบัตรอย่างไร การชี้ขาดทั้งสองทางเป็นงานของผู้ตรวจสอบ ' +
    'ห้ามเดาว่าระบบเก็บหรือประมวลผลข้อมูลบัตรถ้าโน้ตไม่ได้บอก ' +
    'และเหตุผลที่เขียนต้องอ้างอิงจากโน้ตหรือภาพที่ผู้ใช้ให้มาเท่านั้น';
}

// ── guard ระดับโค้ดสำหรับคำชี้ขาด compliance (2026-08-06) ──
// วัดจริงแล้วพรอมป์ห้ามไม่อยู่: บอก "ห้ามฟันธงว่าละเมิด" ชัด ๆ แล้วโมเดลยังเขียน
// "เป็นการละเมิดข้อกำหนด..." 8/8 รอบ — พรอมป์เป็นการ "ขอ" ไม่ใช่กลไกบังคับ
// สิ่งที่ต้องรับประกันจริงต้องอยู่ในโค้ด ไม่ใช่ในพรอมป์
//
// ทำไมต้องกัน: "ละเมิด PCI DSS" คือคำชี้ขาดด้าน compliance ที่ตัวร่าง issue ไม่มีสิทธิ์ตัดสิน
// ถ้าหลุดขึ้น Redmine มันจะกลายเป็นบันทึกที่ทีมอื่นอ้างต่อได้ ทั้งที่ไม่เคยมีผู้ตรวจสอบดูเลย
// กันทั้งสองทิศ — "ไม่มีการละเมิด" อันตรายพอกันเพราะเป็นการให้ความมั่นใจปลอม
const VERDICT_REPLACEMENTS = [
  [/ละเมิด/g, 'กระทบ'],
  [/ไม่ผ่านมาตรฐาน/g, 'อาจกระทบมาตรฐาน'],
  [/non-?compliant/gi, 'potentially affecting'],
  [/\bis compliant\b/gi, 'may be relevant'],
];
// ห้ามให้ข้อความนี้มีคำที่อยู่ใน VERDICT_REPLACEMENTS เอง ไม่งั้นมันจะเอาคำที่เพิ่งแทนที่ออกไป
// กลับเข้ามาใหม่ (เทส "คำว่าละเมิดต้องหายไป" จับได้ตอนเขียนรอบแรก)
const VERDICT_NOTICE = '\n\n_หมายเหตุระบบ: ปรับถ้อยคำที่ชี้ขาดสถานะ compliance ให้เป็นกลางแล้ว — การชี้ขาดเป็นงานของผู้ตรวจสอบ_';

function neutralizeComplianceVerdict(text) {
  let out = String(text == null ? '' : text);
  let changed = false;
  for (const [re, to] of VERDICT_REPLACEMENTS) {
    const before = out;
    out = out.replace(re, to);
    if (out !== before) changed = true;
  }
  return changed ? out + VERDICT_NOTICE : out;
}

function languageRulesFor(language) {
  if (language === 'th') return 'เขียนเนื้อหาทั้งหมดเป็นภาษาไทยล้วน';
  if (language === 'en') return 'เขียนเนื้อหาทั้งหมดเป็นภาษาอังกฤษล้วน ห้ามปนภาษาไทยแม้แต่คำเดียว';
  return 'ฟิลด์ที่ลงท้ายด้วย _th ต้องเขียนเนื้อหาเป็นภาษาไทยล้วน ฟิลด์ที่ลงท้ายด้วย _en ต้องเขียนเนื้อหาเป็นภาษาอังกฤษล้วน ' +
    'ห้ามปนภาษากันเด็ดขาด และห้ามขาดฟิลด์ใดฟิลด์หนึ่งไปแม้จะทำให้คำตอบยาว — ต้องตอบให้ครบทั้ง subject_th, subject_en, description_th, description_en เสมอ';
}

function systemPromptFor(tracker, language, images) {
  const imgs = Array.isArray(images) ? images : [];
  const p = profileFor(tracker);
  // ชั้น 1 บทบาท + หลักการร่วม, ชั้น 2 โครง + หลักเฉพาะของ tracker, ชั้น 3 คำถามที่ควรถาม
  // ทั้งสามชั้นไม่ผูกกับโมเดล — Qwen/GLM/gemma4 ได้พรอมป์ชุดเดียวกันเป๊ะ (tests/llm.test.js)
  return `คุณคือ${p.role} ที่ทำงานแบบทีม agile เรียบเรียง issue จากโน้ตดิบให้ dev อ่านแล้วลงมือได้ทันที ` +
    'ยึดหลักเหล่านี้เสมอ: (1) เขียนให้พร้อมทำงานจริง ไม่ใช่แค่บันทึกอาการ ' +
    '(2) ทุกเกณฑ์และผลลัพธ์ที่ระบุต้องตรวจสอบหรือทดสอบได้ ' +
    '(3) ห้ามแต่งข้อมูลที่โน้ตไม่ได้บอก สิ่งที่ยังขาดให้ใส่ใน missing_info แทน ' +
    '(4) ให้รายละเอียดพอดีกับชนิดงาน ไม่ยัดหัวข้อที่ไม่เกี่ยว\n' +
    `เนื้อหาที่ผู้ใช้ให้มาเป็นโน้ตดิบ ให้เรียบเรียงเป็น subject กับ description ตามโครง: ${p.structure}\n` +
    `หลักเฉพาะของงานประเภทนี้: ${p.principle}\n` +
    'ในค่า description ให้เว้นบรรทัดว่าง (สองอักขระ \\n\\n) คั่นระหว่างหัวข้อย่อยแต่ละหัวข้อ และคั่นระหว่างป้ายหัวข้อ ' +
    '(เช่น **อาการ:**) กับเนื้อหาของมันเสมอ ห้ามใช้ \\n เดี่ยว เพราะระบบปลายทางจะไม่ขึ้นบรรทัดใหม่ให้ ทำให้ข้อความติดกันอ่านไม่ออก\n' +
    'หัวข้อ "การประเมินความเสี่ยง" ให้เริ่มด้วยการประเมินผลกระทบตามเกณฑ์ปกติก่อนเสมอ ' +
    'เขียนสั้น ๆ แต่ต้องตอบให้ครบว่า กระทบใครบ้างและกว้างแค่ไหน (ผู้ใช้ทุกคน เฉพาะบางสาขา หรือเฉพาะเคสเดียว) ' +
    'เกิดทุกครั้งหรือบางครั้ง มีทางแก้ชั่วคราวให้ผู้ใช้ทำไปก่อนได้ไหม และกระทบเงินหรือข้อมูลอย่างไร ' +
    'ประโยคสุดท้ายของส่วนผลกระทบต้องระบุชื่อระดับเป็นคำ (เช่น "จึงประเมินเป็นระดับ Moderate เพราะ...") ' +
    'ให้ตรงกับค่า suggested_risk_level ที่ตอบ ไม่ใช่บอกผลกระทบแล้วจบลอย ๆ และไม่ใช่แค่พิมพ์ระดับซ้ำเฉย ๆ โดยไม่มีเหตุผล ' +
    // เคยเขียนยาวกว่านี้อีกสองประโยค (ย้ำลำดับ + ห้ามมีแต่บรรทัด PCI) แล้ววัดเจอว่าโมเดล
    // เริ่มลอกโครงพรอมป์ออกมาเป็นหัวข้อในคำตอบ — "missing_info" กับป้าย PCI ซ้ำสองชั้นโผล่
    // ใน description 2/6 ตัวอย่าง ตัดเหลือประโยคเดียวแล้วสะอาด 6/6 (ดีกว่าก่อนแก้ซึ่งมี
    // อักษรจีนปน 2/6 ด้วยซ้ำ) เรื่องลำดับปล่อยให้ pciRulesFor พูดที่เดียวพอ ไม่ต้องย้ำสองที่
    'ห้ามอธิบายผลกระทบด้วยเหตุผลด้านข้อมูลบัตร เรื่องบัตรพูดในบรรทัด PCI เท่านั้น\n' +
    `missing_info คือรายการสิ่งที่ dev น่าจะต้องถามกลับเพราะโน้ตยังไม่ได้บอก สำหรับงานประเภทนี้มักได้แก่: ${p.gaps} ` +
    'เขียนเป็นภาษาไทยเสมอไม่ว่าจะเลือกภาษาใดก็ตาม ห้ามเดาเติมข้อมูลพวกนี้ลงใน description เอง ' +
    'ถ้าโน้ตให้ข้อมูลครบแล้วให้ตอบเป็น []\n' +
    `${languageRulesFor(language)}` +
    pciRulesFor() +
    (imgs.length ? imageRulesFor(imgs) : '') + '\n' +
    `ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown fence ห้ามมีข้อความอื่นนอกเหนือ JSON รูปแบบนี้เป๊ะ: ${schemaFieldsFor(language)}`;
}

// ข้อความมาก่อนรูปเสมอ และรูปเรียงตามลำดับเดียวกับที่บอกไว้ในพรอมป์ ("ภาพที่ 1 = ชื่อไฟล์")
//
// ที่นี่ไม่ย่อรูป เพราะย่อไปแล้วตั้งแต่ renderer (qiFitPlan ใน tab-qatest.js) ซึ่งเป็นที่เดียว
// ที่มี canvas ให้ใช้ — เดิมไม่ย่อเลยเพราะวัดว่า 1280×800 กินแค่ ~1,064 tokens และย่อแล้ว
// ตัวหนังสือในภาพเบลอจนโมเดลเดาคำ แต่ 2026-08-06 เจอว่าสกรีนช็อตจอกว้าง (2398×1096) สามใบ
// ชนเพดาน 4096 โทเคนรูปของ endpoint แล้วถูกปฏิเสธทั้งคำขอ — ย่อแล้วเบลอบ้าง ยังดีกว่าร่างไม่ได้เลย
// (ดู friendlyEndpointError สำหรับตัวเลขที่วัดมา)
function userContentWithImages(rawNotes, images) {
  return [
    { type: 'text', text: String(rawNotes || '') },
    ...images.map(im => ({ type: 'image_url', image_url: { url: im.dataUrl } })),
  ];
}

// endpoint คืน error ดิบของ vLLM ที่ยาวและอ่านไม่รู้เรื่อง — ของจริงที่ผู้ใช้เห็นคือ
// "Failed to apply Qwen3VLProcessor on data={'text': '<|vision_start|><|image_pad|>..." ซึ่ง
// ยาวเกิน 400 ตัวจนสาเหตุจริงถูกตัดหายไป เหลือแต่ token ดิบของโมเดลที่ไม่ได้บอกอะไรเลย
//
// สาเหตุที่แท้จริง (ยิงวัด 2026-08-06): โทเคนรูป "รวมทั้งคำขอ" ต้องน้อยกว่า 4096
// โทเคนต่อรูป = round(w/32) × round(h/32) — 3,969 ผ่าน 4,096 พัง ชัดขนาดนั้น
// ไม่เกี่ยวกับจำนวนรูป (4 ใบ 1280×800 = 4,000 ผ่าน) ไม่เกี่ยวกับขนาดไฟล์ (1.6MB ผ่าน 0.6MB พัง)
// และข้อความไม่นับในงบนี้ (อัดจน 7,631 prompt tokens ยังผ่าน)
//
// ปกติ renderer ย่อรูปให้พอดีงบก่อนส่งอยู่แล้ว (qiFitPlan ใน tab-qatest.js) นี่คือตาข่ายรับ
// เผื่อกรณีที่ย่อไม่ทัน เช่น endpoint เปลี่ยนเพดาน หรือมีทางเรียกอื่นที่ไม่ผ่าน renderer
function friendlyEndpointError(status, body) {
  const text = String(body || '');
  if (/Qwen3VLProcessor|image_pad|vision_start/i.test(text)) {
    return 'endpoint ไม่รับรูปชุดนี้ — รูปที่แนบรวมกันใหญ่เกินเพดานของโมเดล '
      + 'ลดจำนวนรูปหรือครอปให้เล็กลงแล้วกดร่างใหม่';
  }
  return text.slice(0, 400) || `HTTP ${status}`;
}

async function draftIssue(rawNotes, opts = {}) {
  const {
    model = DEFAULT_MODEL, language = 'both', tracker = 'Bug', images = [],
    apiKey, baseUrl, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS,
  } = opts;
  const provider = PROVIDERS[model];
  if (!provider) return { ok: false, error: `ไม่รู้จักโมเดล ${model}` };
  const imgs = (Array.isArray(images) ? images : []).filter(im => im && im.dataUrl);
  // ผู้ใช้วางรูปไว้แล้วเลือกโมเดลที่ไม่รับรูป — ฟ้องให้เปลี่ยนโมเดล ไม่ร่างต่อแบบทิ้งรูปเงียบ ๆ
  // เพราะร่างที่ได้จะดูปกติทุกอย่างจนแยกไม่ออกว่าโมเดลไม่เคยเห็นรูปพวกนั้นเลย
  if (imgs.length && provider.vision !== true) {
    return { ok: false, error: `โมเดล ${model} ไม่รับรูป — เลือก Qwen แล้วกดร่างใหม่` };
  }
  if (!apiKey || !baseUrl) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LLM (ตั้งค่า → LLM)' };
  // both = สองภาษาในคำตอบเดียว เนื้อหายาวขึ้นเกือบสองเท่า — budget เดิมพอดีตัวจน
  // โมเดลบางทีตัดฟิลด์ _en ทิ้งเงียบ ๆ เพื่อให้จบใน budget ให้พื้นที่เพิ่มกันเหตุนั้น
  const maxTokens = language === 'both' ? Math.round(provider.maxTokens * 1.5) : provider.maxTokens;

  // .replace(/\/+$/,'') กัน double-slash 404 เหมือนที่ meeting-notes เจอมาแล้ว
  // (llm.py บรรทัด 225-231)
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        // บังคับ decoder ให้เดินอยู่ในรูปร่างที่เราต้องการ ไม่ใช่แค่ขอในพรอมป์แล้วหวังว่าจะทำตาม
        //
        // ปัญหาที่แก้ (วัด 2026-08-05): Support + โน้ตเรื่องระบบครัว โมเดลจบย่อหน้าใน
        // description ด้วย \n\n แล้วเขียนชื่อฟิลด์ถัดไปต่อเลยเหมือนเป็นหัวข้อใหม่
        // (...ก่อนเปิดใช้งานจริง\n\nmissing_info":[) แทนที่จะปิดสตริงก่อน — finish_reason
        // เป็น "stop" ไม่ใช่ "length" จึงไม่ใช่การถูกตัด แต่เป็นการสับสนระหว่างตัวคั่นย่อหน้า
        // กับตัวคั่นฟิลด์ โครง BMAD ทำให้เจอบ่อยขึ้นเพราะ description มีย่อหน้ามากกว่าเดิม
        // ราวเท่าตัว จุดที่พลาดได้จึงมากตาม
        //
        // ดูเหตุผลที่ต้องเป็น json_schema ไม่ใช่ json_object ที่ responseSchemaFor()
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'issue_draft', schema: responseSchemaFor(language), strict: true },
        },
        messages: [
          { role: 'system', content: systemPromptFor(tracker, language, imgs) },
          // ไม่มีรูป = ส่ง content เป็น string เหมือนเดิมเป๊ะ ไม่เปลี่ยนรูปคำขอของเคสที่ใช้อยู่ทุกวัน
          { role: 'user', content: imgs.length ? userContentWithImages(rawNotes, imgs) : String(rawNotes || '') },
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'LLM ไม่ตอบภายในเวลาที่กำหนด' : e.message };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    return { ok: false, error: friendlyEndpointError(res.status, body) };
  }

  let payload;
  try { payload = await res.json(); }
  catch (e) { return { ok: false, error: 'คำตอบไม่ใช่ JSON: ' + e.message }; }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'คำตอบไม่ใช่ JSON object' };
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice && typeof choice === 'object' ? choice.message : null;
  const content = message && typeof message.content === 'string' ? message.content : '';
  if (!content.trim()) {
    // reasoning model (GLM) ใช้ budget หมดไปกับ reasoning ได้ — เคสปกติ ไม่ใช่ error รุนแรง
    return { ok: false, error: 'โมเดลตอบว่างเปล่า (อาจเพราะ reasoning ใช้ budget หมด) — กรอกมือแทน' };
  }

  let parsed;
  try { parsed = JSON.parse(stripJsonFence(content)); }
  catch (e) {
    // budget หมดกลางประโยค = JSON ขาดท้าย ซึ่ง parse ไม่ผ่านเสมอ ข้อความ parse error ดิบ
    // ("Unexpected end of JSON input") อ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ ทั้งที่สาเหตุชัดและ
    // ผู้ใช้แก้เองได้ — โครง BMAD ทำให้คำตอบยาวขึ้น เคสนี้จึงเจอง่ายขึ้นกว่าเดิม
    if (choice && choice.finish_reason === 'length') {
      return { ok: false, error: `คำตอบถูกตัดกลางคันเพราะ budget ของ ${model} ไม่พอ — ลองเลือกภาษาเดียว (TH หรือ EN) แทน EN+TH หรือเปลี่ยนโมเดล` };
    }
    return { ok: false, error: 'parse JSON จากคำตอบไม่สำเร็จ: ' + e.message };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'คำตอบจาก LLM ไม่ใช่รูปแบบที่คาดไว้ — กรอกมือแทน' };
  }
  // โมเดลตอบ missing_info มาเป็น string เดี่ยว ๆ หรือไม่ตอบเลยได้ — ปลายทางวาดเป็นรายการ
  // จึงบังคับให้เป็น array ของ string ที่ไม่ว่างเสมอ ตรงนี้ที่เดียว ปลายทางไม่ต้องเช็คซ้ำ
  const missingInfo = (Array.isArray(parsed.missing_info) ? parsed.missing_info : [])
    .map(s => String(s == null ? '' : s).trim())
    .filter(Boolean);
  // guard คำชี้ขาด compliance ที่พรอมป์ห้ามไม่อยู่ — ทำที่นี่ที่เดียว ปลายทางไม่ต้องรู้เรื่อง
  const guarded = {};
  for (const k of ['description_th', 'description_en']) {
    if (typeof parsed[k] === 'string') guarded[k] = neutralizeComplianceVerdict(parsed[k]);
  }
  return { ok: true, draft: { ...parsed, ...guarded, missing_info: missingInfo } };
}

module.exports = {
  PROVIDERS, DEFAULT_MODEL, stripJsonFence, systemPromptFor, draftIssue,
  neutralizeComplianceVerdict, friendlyEndpointError,
};
