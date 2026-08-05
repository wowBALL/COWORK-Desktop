'use strict';

// พอร์ตตรรกะจาก meeting-notes/src/llm.py (_openai_compat_completer) มาเป็น JS สำหรับ
// main process ของ COWORK Desktop — ไม่มี Electron import (เหมือน grafana.js/qatest.js)
// จึงรันผ่าน node --test ได้ตรง โดยฉีด fetchImpl ปลอมแทนการยิงเน็ตจริง
// ดู docs/superpowers/specs/2026-08-04-qa-create-issue-design.md

// vision = ยิงจริงเข้า endpoint แล้ววัดมา ไม่ได้อนุมานจากชื่อรุ่น (ดู spec 2026-08-05):
// Qwen ตอบภาพคุมสองสีถูก 3/3 และถอดข้อความไทย+อังกฤษในสกรีนช็อต 1280×800 ได้ครบ
// ส่วน GLM ทดสอบไม่ได้เพราะ backend ล่ม จึงถือว่าไม่รับรูปไว้ก่อน — ปลอดภัยกว่าเดาว่ารับได้
const PROVIDERS = {
  // ไม่ใช่ reasoning model — budget เล็กพอสำหรับร่าง issue สั้น ๆ
  'Qwen/Qwen3.6-35B-A3B': { maxTokens: 2048, vision: true },
  // reasoning model — max_tokens คุมผลรวมของ reasoning + คำตอบ ไม่ใช่คำตอบอย่างเดียว
  // ต้องกว้างกว่า Qwen มาก ไม่งั้น content ว่างเปล่าบ่อย (ดู meeting-notes/src/llm.py บรรทัด 24-29)
  'GLM-5.2': { maxTokens: 8192, vision: false },
  // ไม่ใช่ reasoning model เหมือน Qwen (ดู meeting-notes/src/llm.py บรรทัด 42-49) แต่ยังไม่เคย
  // ทดสอบรับภาพ — ถือว่าไม่รับไว้ก่อนเหมือน GLM แทนที่จะเดา
  'litellm/gemma4': { maxTokens: 2048, vision: false },
};
const DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B';
const REQUEST_TIMEOUT_MS = 30000;

function stripJsonFence(text) {
  const t = String(text || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1].trim() : t;
}

// tracker เป็น input ที่กำหนดโครงร่าง ไม่ใช่สิ่งที่ LLM ทาย (ผู้ใช้เลือก tracker ไว้ก่อนแล้ว)
function structureFor(tracker) {
  if (tracker === 'Bug') return 'อาการ / ขั้นตอนที่ทำให้เกิด / คาดว่าจะได้ / ได้จริง / การประเมินความเสี่ยง / Environment';
  if (tracker === 'Feature') return 'เป้าหมาย / พฤติกรรมที่เสนอ / เหตุผลหรือผลกระทบถ้าไม่ทำ / การประเมินความเสี่ยง';
  return 'สรุปตามเนื้อหาที่ให้มา ไม่บังคับหัวข้อย่อย แต่ต้องมีย่อหน้าการประเมินความเสี่ยงเสมอ';
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

function languageRulesFor(language) {
  if (language === 'th') return 'เขียนเนื้อหาทั้งหมดเป็นภาษาไทยล้วน';
  if (language === 'en') return 'เขียนเนื้อหาทั้งหมดเป็นภาษาอังกฤษล้วน ห้ามปนภาษาไทยแม้แต่คำเดียว';
  return 'ฟิลด์ที่ลงท้ายด้วย _th ต้องเขียนเนื้อหาเป็นภาษาไทยล้วน ฟิลด์ที่ลงท้ายด้วย _en ต้องเขียนเนื้อหาเป็นภาษาอังกฤษล้วน ' +
    'ห้ามปนภาษากันเด็ดขาด และห้ามขาดฟิลด์ใดฟิลด์หนึ่งไปแม้จะทำให้คำตอบยาว — ต้องตอบให้ครบทั้ง subject_th, subject_en, description_th, description_en เสมอ';
}

function systemPromptFor(tracker, language, images) {
  const imgs = Array.isArray(images) ? images : [];
  return 'คุณคือผู้ช่วยเรียบเรียง issue tracker ให้ทีม dev อ่านแล้วแก้ได้ทันที ' +
    `เนื้อหาที่ผู้ใช้ให้มาเป็นโน้ตดิบ ให้เรียบเรียงเป็น subject กับ description ตามโครง: ${structureFor(tracker)}\n` +
    'ในค่า description ให้เว้นบรรทัดว่าง (สองอักขระ \\n\\n) คั่นระหว่างหัวข้อย่อยแต่ละหัวข้อ และคั่นระหว่างป้ายหัวข้อ ' +
    '(เช่น **อาการ:**) กับเนื้อหาของมันเสมอ ห้ามใช้ \\n เดี่ยว เพราะระบบปลายทางจะไม่ขึ้นบรรทัดใหม่ให้ ทำให้ข้อความติดกันอ่านไม่ออก\n' +
    'หัวข้อ "การประเมินความเสี่ยง" ให้เขียนสั้นๆ อธิบายเหตุผลว่าทำไมถึงประเมินระดับความเสี่ยงแบบนั้น ' +
    '(กระทบผู้ใช้กี่คน กระทบเงิน/ข้อมูลไหม มีทางแก้ชั่วคราวไหม ฯลฯ) ต้องสอดคล้องกับค่า suggested_risk_level ที่ตอบ ' +
    'ไม่ใช่แค่พิมพ์ระดับซ้ำเฉยๆ\n' +
    'missing_info คือรายการสิ่งที่ dev น่าจะต้องถามกลับเพราะโน้ตยังไม่ได้บอก (เช่น หน้าจอหรือ route ไหน ' +
    'ขนาดจอ/browser/OS ข้อมูลที่ใช้ทดสอบ เกิดทุกครั้งหรือบางครั้ง สิ่งที่ถูกต้องควรเป็นอย่างไร) ' +
    'เขียนเป็นภาษาไทยเสมอไม่ว่าจะเลือกภาษาใดก็ตาม ห้ามเดาเติมข้อมูลพวกนี้ลงใน description เอง ' +
    'ถ้าโน้ตให้ข้อมูลครบแล้วให้ตอบเป็น []\n' +
    `${languageRulesFor(language)}` +
    (imgs.length ? imageRulesFor(imgs) : '') + '\n' +
    `ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown fence ห้ามมีข้อความอื่นนอกเหนือ JSON รูปแบบนี้เป๊ะ: ${schemaFieldsFor(language)}`;
}

// ข้อความมาก่อนรูปเสมอ และรูปเรียงตามลำดับเดียวกับที่บอกไว้ในพรอมป์ ("ภาพที่ 1 = ชื่อไฟล์")
// ไม่ย่อรูป — วัดแล้วสกรีนช็อต 1280×800 กินแค่ ~1,064 prompt tokens และย่อแล้วตัวหนังสือเล็ก
// ในภาพจะเบลอจนโมเดลเดาคำ ซึ่งแย่กว่าไม่เห็นรูปเลย
function userContentWithImages(rawNotes, images) {
  return [
    { type: 'text', text: String(rawNotes || '') },
    ...images.map(im => ({ type: 'image_url', image_url: { url: im.dataUrl } })),
  ];
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
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.text()).slice(0, 400) || detail; } catch {}
    return { ok: false, error: detail };
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
  catch (e) { return { ok: false, error: 'parse JSON จากคำตอบไม่สำเร็จ: ' + e.message }; }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'คำตอบจาก LLM ไม่ใช่รูปแบบที่คาดไว้ — กรอกมือแทน' };
  }
  // โมเดลตอบ missing_info มาเป็น string เดี่ยว ๆ หรือไม่ตอบเลยได้ — ปลายทางวาดเป็นรายการ
  // จึงบังคับให้เป็น array ของ string ที่ไม่ว่างเสมอ ตรงนี้ที่เดียว ปลายทางไม่ต้องเช็คซ้ำ
  const missingInfo = (Array.isArray(parsed.missing_info) ? parsed.missing_info : [])
    .map(s => String(s == null ? '' : s).trim())
    .filter(Boolean);
  return { ok: true, draft: { ...parsed, missing_info: missingInfo } };
}

module.exports = { PROVIDERS, DEFAULT_MODEL, stripJsonFence, systemPromptFor, draftIssue };
