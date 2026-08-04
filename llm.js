'use strict';

// พอร์ตตรรกะจาก meeting-notes/src/llm.py (_openai_compat_completer) มาเป็น JS สำหรับ
// main process ของ COWORK Desktop — ไม่มี Electron import (เหมือน grafana.js/qatest.js)
// จึงรันผ่าน node --test ได้ตรง โดยฉีด fetchImpl ปลอมแทนการยิงเน็ตจริง
// ดู docs/superpowers/specs/2026-08-04-qa-create-issue-design.md

const PROVIDERS = {
  // ไม่ใช่ reasoning model — budget เล็กพอสำหรับร่าง issue สั้น ๆ
  'Qwen/Qwen3.6-35B-A3B': { maxTokens: 2048 },
  // reasoning model — max_tokens คุมผลรวมของ reasoning + คำตอบ ไม่ใช่คำตอบอย่างเดียว
  // ต้องกว้างกว่า Qwen มาก ไม่งั้น content ว่างเปล่าบ่อย (ดู meeting-notes/src/llm.py บรรทัด 24-29)
  'GLM-5.2': { maxTokens: 8192 },
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
  if (tracker === 'Bug') return 'อาการ / ขั้นตอนที่ทำให้เกิด / คาดว่าจะได้ / ได้จริง / Environment';
  if (tracker === 'Feature') return 'เป้าหมาย / พฤติกรรมที่เสนอ / เหตุผลหรือผลกระทบถ้าไม่ทำ';
  return 'สรุปตามเนื้อหาที่ให้มา ไม่บังคับหัวข้อย่อย';
}

function schemaFieldsFor(language) {
  const risk = '"suggested_risk_level":"Low|Fairly Low|Moderate|High|Very High"';
  if (language === 'th') return `{"subject_th":"...","description_th":"...",${risk}}`;
  if (language === 'en') return `{"subject_en":"...","description_en":"...",${risk}}`;
  return `{"subject_en":"...","subject_th":"...","description_en":"...","description_th":"...",${risk}}`;
}

function languageRulesFor(language) {
  if (language === 'th') return 'เขียนเนื้อหาทั้งหมดเป็นภาษาไทยล้วน';
  if (language === 'en') return 'เขียนเนื้อหาทั้งหมดเป็นภาษาอังกฤษล้วน ห้ามปนภาษาไทยแม้แต่คำเดียว';
  return 'ฟิลด์ที่ลงท้ายด้วย _th ต้องเขียนเนื้อหาเป็นภาษาไทยล้วน ฟิลด์ที่ลงท้ายด้วย _en ต้องเขียนเนื้อหาเป็นภาษาอังกฤษล้วน ' +
    'ห้ามปนภาษากันเด็ดขาด และห้ามขาดฟิลด์ใดฟิลด์หนึ่งไปแม้จะทำให้คำตอบยาว — ต้องตอบให้ครบทั้ง subject_th, subject_en, description_th, description_en เสมอ';
}

function systemPromptFor(tracker, language) {
  return 'คุณคือผู้ช่วยเรียบเรียง issue tracker ให้ทีม dev อ่านแล้วแก้ได้ทันที ' +
    `เนื้อหาที่ผู้ใช้ให้มาเป็นโน้ตดิบ ให้เรียบเรียงเป็น subject กับ description ตามโครง: ${structureFor(tracker)}\n` +
    'ในค่า description ให้เว้นบรรทัดว่าง (สองอักขระ \\n\\n) คั่นระหว่างหัวข้อย่อยแต่ละหัวข้อ และคั่นระหว่างป้ายหัวข้อ ' +
    '(เช่น **อาการ:**) กับเนื้อหาของมันเสมอ ห้ามใช้ \\n เดี่ยว เพราะระบบปลายทางจะไม่ขึ้นบรรทัดใหม่ให้ ทำให้ข้อความติดกันอ่านไม่ออก\n' +
    `${languageRulesFor(language)}\n` +
    `ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown fence ห้ามมีข้อความอื่นนอกเหนือ JSON รูปแบบนี้เป๊ะ: ${schemaFieldsFor(language)}`;
}

async function draftIssue(rawNotes, opts = {}) {
  const {
    model = DEFAULT_MODEL, language = 'both', tracker = 'Bug',
    apiKey, baseUrl, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS,
  } = opts;
  const provider = PROVIDERS[model];
  if (!provider) return { ok: false, error: `ไม่รู้จักโมเดล ${model}` };
  if (!apiKey || !baseUrl) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LLM_API_KEY/LLM_BASE_URL' };
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
          { role: 'system', content: systemPromptFor(tracker, language) },
          { role: 'user', content: String(rawNotes || '') },
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
  return { ok: true, draft: parsed };
}

module.exports = { PROVIDERS, DEFAULT_MODEL, stripJsonFence, systemPromptFor, draftIssue };
