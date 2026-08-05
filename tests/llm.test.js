const test = require('node:test');
const assert = require('node:assert');
const { stripJsonFence, systemPromptFor, draftIssue, PROVIDERS, DEFAULT_MODEL } = require('../llm.js');

test('PROVIDERS: มี Qwen (ค่าเริ่มต้น) และ GLM โดย GLM มี budget กว้างกว่ามาก', () => {
  assert.ok(PROVIDERS[DEFAULT_MODEL]);
  assert.strictEqual(DEFAULT_MODEL, 'Qwen/Qwen3.6-35B-A3B');
  assert.ok(PROVIDERS['GLM-5.2'].maxTokens > PROVIDERS[DEFAULT_MODEL].maxTokens * 2,
    'GLM เป็น reasoning model ต้องมี budget กว้างกว่า Qwen มาก ไม่งั้น content ว่างเปล่าบ่อย');
});

test('stripJsonFence: ลอก ```json fence ออก', () => {
  assert.strictEqual(stripJsonFence('```json\n{"a":1}\n```'), '{"a":1}');
});
test('stripJsonFence: fence ที่ไม่ระบุภาษาก็ลอกออก', () => {
  assert.strictEqual(stripJsonFence('```\n{"a":1}\n```'), '{"a":1}');
});
test('stripJsonFence: ไม่มี fence คืนค่าเดิม (trim แล้ว)', () => {
  assert.strictEqual(stripJsonFence('  {"a":1}  '), '{"a":1}');
});

test('systemPromptFor: Bug บังคับโครงขั้นตอนทำซ้ำ', () => {
  assert.ok(systemPromptFor('Bug', 'th').includes('ขั้นตอนที่ทำให้เกิด'));
});
test('systemPromptFor: Feature บังคับโครงเป้าหมาย', () => {
  assert.ok(systemPromptFor('Feature', 'th').includes('เป้าหมาย'));
});
test('systemPromptFor: Epic/Support ไม่บังคับหัวข้อย่อย', () => {
  assert.ok(systemPromptFor('Epic', 'th').includes('ไม่บังคับหัวข้อย่อย'));
  assert.ok(systemPromptFor('Support', 'th').includes('ไม่บังคับหัวข้อย่อย'));
});
test('systemPromptFor: language th ขอแค่ subject_th/description_th ไม่มี _en', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(p.includes('subject_th'));
  assert.ok(!p.includes('subject_en'));
});
test('systemPromptFor: language both ขอครบสี่ฟิลด์', () => {
  const p = systemPromptFor('Bug', 'both');
  assert.ok(p.includes('subject_th') && p.includes('subject_en'));
  assert.ok(p.includes('description_th') && p.includes('description_en'));
});
test('systemPromptFor: ไม่มี suggested_tracker ใน schema ไหนเลย', () => {
  assert.ok(!systemPromptFor('Bug', 'both').includes('suggested_tracker'));
});

test('draftIssue: ไม่ตั้ง apiKey/baseUrl คืน ok:false ทันที ไม่ยิงเน็ต', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const result = await draftIssue('โน้ตดิบ', { apiKey: '', baseUrl: '', fetchImpl });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(called, false);
});

test('draftIssue: model ไม่รู้จัก คืน ok:false ไม่ยิงเน็ต', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const result = await draftIssue('โน้ตดิบ', { model: 'unknown-model', apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(called, false);
});

test('draftIssue: base_url ที่ลงท้าย / ไม่กลายเป็น double-slash', async () => {
  let calledUrl;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"subject_th":"a","description_th":"b","suggested_risk_level":"Low"}' } }] }) };
  };
  await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x/', fetchImpl });
  assert.strictEqual(calledUrl, 'https://x/chat/completions');
});

test('draftIssue: content ว่างเปล่า (GLM reasoning กิน budget) = ok:false ไม่ throw', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test('draftIssue: top-level ไม่ใช่ JSON object = ok:false ไม่ throw', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => null });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
});

test('draftIssue: choices ว่างเปล่า/ไม่มี message = ok:false ไม่ throw', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [] }) });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
});

test('draftIssue: HTTP error status = ok:false พร้อม detail จาก body', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('401') || result.error.includes('unauthorized'));
});

test('draftIssue: parse สำเร็จคืน draft ที่ strip fence แล้ว จริง', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '```json\n{"subject_th":"a","description_th":"b","suggested_risk_level":"High"}\n```' } }] }),
  });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.draft.subject_th, 'a');
  assert.strictEqual(result.draft.suggested_risk_level, 'High');
});

test('draftIssue: parse JSON ไม่สำเร็จ (แม้ผ่าน strip fence แล้ว) = ok:false ไม่ throw', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'ไม่ใช่ json เลย' } }] }) });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
});

test('draftIssue: content เป็น JSON ที่ valid แต่ไม่ใช่ object ("null"/"42") = ok:false ไม่ throw', async () => {
  for (const literal of ['null', '42']) {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: literal } }] }) });
    const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
    assert.strictEqual(result.ok, false, `literal ${literal} ควรเป็น ok:false`);
    assert.ok(result.error);
  }
});

test('draftIssue: timeout ยกเลิกคำขอแล้วคืน ok:false ไม่ค้าง', async () => {
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const result = await draftIssue('note', { apiKey: 'k', baseUrl: 'https://x', fetchImpl, timeoutMs: 10 });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('ไม่ตอบ'));
});

// ===== ส่งสกรีนช็อตให้โมเดลดู (spec 2026-08-05) =====
// vision ของ Qwen วัดมาจากการยิงจริง ไม่ได้อนุมานจากชื่อรุ่น — เทสตรงนี้ล็อกไว้ว่าธงต้องไม่หายไป
const OK_JSON = '{"subject_th":"a","description_th":"b","suggested_risk_level":"Low","missing_info":["route ไหน"]}';
const okFetch = (capture) => async (url, opts) => {
  if (capture) capture.body = JSON.parse(opts.body);
  return { ok: true, json: async () => ({ choices: [{ message: { content: OK_JSON } }] }) };
};
const IMG = [{ filename: 'clipboard-1.png', dataUrl: 'data:image/png;base64,AAA' }];

test('PROVIDERS: Qwen รับรูปได้ (วัดจริงแล้ว) ส่วน GLM ถือว่าไม่รับ', () => {
  assert.strictEqual(PROVIDERS[DEFAULT_MODEL].vision, true);
  assert.notStrictEqual(PROVIDERS['GLM-5.2'].vision, true);
});

test('draftIssue: ไม่มีรูป content ยังเป็น string เหมือนเดิมเป๊ะ', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
  assert.strictEqual(typeof cap.body.messages[1].content, 'string');
  assert.strictEqual(cap.body.messages[1].content, 'โน้ต');
});

test('draftIssue: มีรูป content เป็น array ข้อความมาก่อน แล้วรูปเรียงตามลำดับ', async () => {
  const cap = {};
  const images = [
    { filename: 'a.png', dataUrl: 'data:image/png;base64,AAA' },
    { filename: 'b.png', dataUrl: 'data:image/png;base64,BBB' },
  ];
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', images, fetchImpl: okFetch(cap) });
  const content = cap.body.messages[1].content;
  assert.ok(Array.isArray(content));
  assert.strictEqual(content[0].type, 'text');
  assert.strictEqual(content[0].text, 'โน้ต');
  assert.deepStrictEqual(content.slice(1).map(c => c.type), ['image_url', 'image_url']);
  assert.strictEqual(content[1].image_url.url, 'data:image/png;base64,AAA');
  assert.strictEqual(content[2].image_url.url, 'data:image/png;base64,BBB');
});

test('draftIssue: รูปที่ยังไม่มี dataUrl ถูกตัดออก ไม่ส่ง url ว่างไปให้ endpoint ปฏิเสธทั้งคำขอ', async () => {
  const cap = {};
  const images = [{ filename: 'a.png', dataUrl: '' }, { filename: 'b.png', dataUrl: 'data:image/png;base64,BBB' }];
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', images, fetchImpl: okFetch(cap) });
  const content = cap.body.messages[1].content;
  assert.strictEqual(content.filter(c => c.type === 'image_url').length, 1);
});

test('draftIssue: images ว่าง/ไม่ใช่ array ก็ยังเป็น string ไม่พังเป็น array เปล่า', async () => {
  for (const images of [[], null, undefined, 'ไม่ใช่ array']) {
    const cap = {};
    await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', images, fetchImpl: okFetch(cap) });
    assert.strictEqual(typeof cap.body.messages[1].content, 'string', `images=${JSON.stringify(images)}`);
  }
});

test('draftIssue: โมเดลที่ไม่รับรูป + มีรูป = ok:false และไม่ยิงเน็ต (ห้ามทิ้งรูปเงียบ ๆ)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const result = await draftIssue('โน้ต', {
    model: 'GLM-5.2', apiKey: 'k', baseUrl: 'https://x', images: IMG, fetchImpl,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(called, false, 'ต้องไม่ยิงเน็ตเลยเมื่อรู้อยู่แล้วว่าโมเดลไม่รับรูป');
  assert.ok(result.error.includes('Qwen'), 'error ต้องบอกทางออก ไม่ใช่แค่บอกว่าไม่ได้');
});

test('draftIssue: โมเดลที่ไม่รับรูป แต่ไม่มีรูป = ร่างได้ตามปกติ', async () => {
  const result = await draftIssue('โน้ต', {
    model: 'GLM-5.2', apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(),
  });
  assert.strictEqual(result.ok, true);
});

test('systemPromptFor: ไม่มีรูป = ไม่มีกฎเรื่องภาพเลย', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(!p.includes('สกรีนช็อต'));
  assert.ok(!p.includes('ภาพที่ 1'));
});

test('systemPromptFor: มีรูป = บอกลำดับ+ชื่อไฟล์ และมีกฎครบทั้งสามข้อที่วัดมา', () => {
  const p = systemPromptFor('Bug', 'th', [{ filename: 'a.png' }, { filename: 'b.png' }]);
  assert.ok(p.includes('ภาพที่ 1 = a.png'), 'ต้องผูกลำดับกับชื่อไฟล์');
  assert.ok(p.includes('ภาพที่ 2 = b.png'));
  assert.ok(p.includes('ยึดโน้ต'), 'โน้ตผู้ใช้ต้องเป็นข้อมูลหลัก');
  assert.ok(p.includes('ห้ามเดาสาเหตุทาง code'), 'กันโมเดลเดาสาเหตุจากภาพ');
  assert.ok(p.includes('ไม่แน่ใจ'), 'อ่านไม่ชัดต้องให้บอก ไม่ใช่เดาคำ');
});

// ตาข่ายเดียวที่กันรูปหายจากเนื้อ issue หลังตัด stripUnknownImageTags ออก — ถ้า LLM เขียนชื่อไฟล์
// ลง description แล้ว embedImageAttachments() จะข้ามรูปใบนั้นเพราะ text.includes(filename) เป็นจริง
test('systemPromptFor: มีรูป = ห้ามเขียนชื่อไฟล์/แท็ก <img> ลง description', () => {
  const p = systemPromptFor('Bug', 'th', [{ filename: 'a.png' }]);
  assert.ok(p.includes('ห้ามเขียนชื่อไฟล์'));
  assert.ok(p.includes('<img>'));
});

test('systemPromptFor: schema ขอ missing_info ทุกภาษา', () => {
  for (const lang of ['th', 'en', 'both']) {
    assert.ok(systemPromptFor('Bug', lang).includes('missing_info'), `language ${lang}`);
  }
});

test('draftIssue: missing_info ทะลุถึง draft', async () => {
  const result = await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch() });
  assert.deepStrictEqual(result.draft.missing_info, ['route ไหน']);
});

test('draftIssue: missing_info ที่ไม่ใช่ array หรือไม่มีเลย = [] ไม่ใช่ undefined', async () => {
  for (const raw of ['"เป็น string"', 'null', 'undefined-ไม่มีคีย์']) {
    const content = raw === 'undefined-ไม่มีคีย์'
      ? '{"subject_th":"a","description_th":"b"}'
      : `{"subject_th":"a","description_th":"b","missing_info":${raw}}`;
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
    const result = await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
    assert.deepStrictEqual(result.draft.missing_info, [], `raw=${raw}`);
  }
});

test('draftIssue: missing_info ตัดช่องว่างและรายการว่างทิ้ง', async () => {
  const content = '{"subject_th":"a","description_th":"b","missing_info":["  route ไหน  ","","   ",null]}';
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const result = await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.deepStrictEqual(result.draft.missing_info, ['route ไหน']);
});

// mutation check จับได้ว่าเดิมไม่มีเทสไหนพังเลยถ้า draftIssue ลืมส่ง imgs เข้า systemPromptFor —
// โมเดลจะได้รูปมาโดยไม่มีกฎกำกับสักข้อ รวมทั้งกฎห้ามเขียนชื่อไฟล์ที่กันรูปหายจากเนื้อ issue
test('draftIssue: มีรูป = system prompt ที่ส่งไปจริงมีกฎเรื่องภาพครบ ไม่ใช่แนบรูปเปล่า ๆ', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', images: IMG, fetchImpl: okFetch(cap) });
  const sys = cap.body.messages[0].content;
  assert.ok(sys.includes('ภาพที่ 1 = clipboard-1.png'), 'ต้องบอกลำดับ+ชื่อไฟล์ของรูปที่แนบไปจริง');
  assert.ok(sys.includes('ห้ามเขียนชื่อไฟล์'));
  assert.ok(sys.includes('ห้ามเดาสาเหตุทาง code'));
});

test('draftIssue: ไม่มีรูป = system prompt ที่ส่งไปจริงไม่มีกฎเรื่องภาพ', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
  assert.ok(!cap.body.messages[0].content.includes('สกรีนช็อต'));
});

// ── BMAD (2026-08-05) ────────────────────────────────────────────────────────
// prompt เปลี่ยนจาก "ผู้ช่วยเรียบเรียง" เป็นบทบาทแบบทีม agile + หลักการ + คำถามที่ควรถาม
// แยกตาม tracker เทสชุดนี้ล็อกเฉพาะ "มีครบทุกชั้น" ไม่ล็อกถ้อยคำทั้งประโยค เพราะถ้อยคำ
// ต้องปรับได้ตามผลที่วัดจากโมเดลจริง

test('systemPromptFor: ทุก tracker ได้บทบาทเฉพาะของงานประเภทนั้น ไม่ใช่บทบาทกลาง ๆ ตัวเดียว', () => {
  assert.ok(systemPromptFor('Bug', 'th').includes('QA'), 'Bug ต้องคิดแบบ QA');
  assert.ok(systemPromptFor('Feature', 'th').includes('Product Owner'), 'Feature ต้องคิดแบบ PO');
  // tracker ที่ไม่มีโปรไฟล์ต้องไม่พัง และต้องได้บทบาทสำรอง ไม่ใช่ undefined โผล่ในพรอมป์
  const other = systemPromptFor('ไม่รู้จัก', 'th');
  assert.ok(other.includes('นักวิเคราะห์ระบบ'));
  assert.ok(!other.includes('undefined'), 'tracker แปลก ๆ ต้องไม่ทำให้ undefined หลุดเข้าพรอมป์');
});

test('systemPromptFor: หลักการร่วมของ BMAD ติดไปทุก tracker', () => {
  for (const t of ['Bug', 'Feature', 'Epic', 'Support', 'ไม่รู้จัก']) {
    const p = systemPromptFor(t, 'th');
    assert.ok(p.includes('ตรวจสอบหรือทดสอบได้'), `${t} ต้องมีหลักว่าผลลัพธ์ต้องทดสอบได้`);
    assert.ok(p.includes('ห้ามแต่งข้อมูลที่โน้ตไม่ได้บอก'), `${t} ต้องมีหลักห้ามแต่งข้อมูล`);
  }
});

test('systemPromptFor: คำถามที่ควรถาม (missing_info) ต่างกันตามชนิดงาน ไม่ใช่ลิสต์เดียวใช้ทุกที่', () => {
  const bug = systemPromptFor('Bug', 'th');
  const feature = systemPromptFor('Feature', 'th');
  assert.ok(bug.includes('browser'), 'Bug ต้องถามเรื่อง environment');
  assert.ok(feature.includes('ผู้ใช้'), 'Feature ต้องถามว่าใครคือผู้ใช้');
  assert.ok(!feature.includes('ขนาดจอ'), 'Feature ไม่ควรลากคำถามสไตล์ bug มาถาม');
});

test('systemPromptFor: Feature บังคับเกณฑ์การยอมรับที่ทดสอบได้ (ไม่ใช่แค่บอกเป้าหมายลอย ๆ)', () => {
  const p = systemPromptFor('Feature', 'th');
  assert.ok(p.includes('เกณฑ์การยอมรับ'));
  assert.ok(p.includes('เป้าหมาย'), 'เทสเดิมล็อกคำนี้ไว้ ห้ามหลุด');
});

test('BMAD prompt ใช้กับทุกโมเดลเหมือนกันหมด — เลือกโมเดลไหนก็ได้ prompt ชุดเดียวกัน', async () => {
  const sent = {};
  for (const model of Object.keys(PROVIDERS)) {
    const cap = {};
    await draftIssue('โน้ต', { model, apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
    sent[model] = cap.body.messages[0].content;
  }
  const all = Object.values(sent);
  assert.ok(all.length >= 3, 'ต้องครอบคลุมโมเดลที่มีจริงทั้งหมด รวม gemma4');
  assert.ok(all.every((p) => p === all[0]), 'system prompt ต้องไม่ผูกกับโมเดล');
  assert.ok(all[0].includes('QA'), 'และต้องเป็น prompt แบบ BMAD จริง ไม่ใช่ของเดิม');
});

test('PROVIDERS: gemma4 มี budget กว้างกว่า Qwen เพราะ BMAD ทำให้คำตอบยาวขึ้น', () => {
  assert.ok(PROVIDERS['litellm/gemma4'].maxTokens > PROVIDERS[DEFAULT_MODEL].maxTokens,
    'meeting-notes วัดแล้วว่า gemma4 รับได้เกิน 100K token และไม่เคยถูกตัด — ไม่มีเหตุให้บีบเท่า Qwen');
});

// เดิมเคสนี้เด้ง "parse JSON จากคำตอบไม่สำเร็จ: Unexpected end of JSON input" ซึ่งอ่านแล้ว
// ไม่รู้ว่าต้องทำอะไรต่อ ทั้งที่สาเหตุชัดและมีทางแก้ชัด (ลดภาษา/เปลี่ยนโมเดล)
test('draftIssue: คำตอบถูกตัดเพราะ budget หมด = บอกสาเหตุกับทางแก้ ไม่ใช่โยน parse error ดิบ', async () => {
  const truncated = '{"subject_th":"ปุ่มกดไม่ติด","description_th":"**อาการ:**\n\nกดแล้วไม่มีอะไรเ';
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'length', message: { content: truncated } }] }),
  });
  const result = await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('ถูกตัด'), 'ต้องบอกว่าคำตอบถูกตัด ไม่ใช่บอกว่า parse ไม่ผ่าน');
  assert.ok(/ภาษาเดียว|เปลี่ยนโมเดล/.test(result.error), 'ต้องบอกทางแก้ที่ผู้ใช้ทำได้จริง');
});

test('draftIssue: JSON พังโดยที่ไม่ได้ถูกตัด = ยังคงข้อความเดิม ไม่ไปโทษ budget มั่ว', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'ไม่ใช่ JSON เลย' } }] }),
  });
  const result = await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('parse JSON'));
  assert.ok(!result.error.includes('ถูกตัด'));
});
