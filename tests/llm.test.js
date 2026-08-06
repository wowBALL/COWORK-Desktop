const test = require('node:test');
const assert = require('node:assert');
const { stripJsonFence, systemPromptFor, draftIssue, PROVIDERS, DEFAULT_MODEL, neutralizeComplianceVerdict } = require('../llm.js');

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

// ── บังคับรูปร่างคำตอบด้วย json_schema (2026-08-05) ─────────────────────────────
// วัดจริงแล้วว่าการขอ JSON ในพรอมป์อย่างเดียวไม่พอ: โมเดลจบย่อหน้าใน description ด้วย
// \n\n แล้วเขียนชื่อฟิลด์ถัดไปต่อเหมือนเป็นหัวข้อใหม่ ทำให้ JSON เสีย และเมื่อบังคับแค่
// json_object มันก็ปิดวงเล็บตั้งแต่ยังไม่เขียนสองฟิลด์ท้าย ได้ JSON ที่ parse ผ่านแต่ข้อมูลหาย

test('draftIssue: ส่ง response_format แบบ json_schema ไม่ใช่ json_object เปล่า ๆ', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
  const rf = cap.body.response_format;
  assert.strictEqual(rf.type, 'json_schema',
    'json_object บังคับแค่ไวยากรณ์ ไม่ได้บังคับว่าฟิลด์ต้องครบ — ข้อมูลหายเงียบได้');
  assert.strictEqual(rf.json_schema.strict, true);
});

test('draftIssue: schema บังคับให้ทุกฟิลด์ที่พรอมป์ขอเป็น required จริง', async () => {
  const expected = {
    th: ['subject_th', 'description_th'],
    en: ['subject_en', 'description_en'],
    both: ['subject_en', 'subject_th', 'description_en', 'description_th'],
  };
  for (const [language, fields] of Object.entries(expected)) {
    const cap = {};
    await draftIssue('โน้ต', { language, apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
    const schema = cap.body.response_format.json_schema.schema;
    const want = [...fields, 'suggested_risk_level', 'missing_info'];
    assert.deepStrictEqual([...schema.required].sort(), [...want].sort(), `language=${language}`);
    // ฟิลด์ภาษาอื่นต้องไม่หลุดเข้ามา — เทสพรอมป์ข้างบนกันไว้แล้วว่า th ต้องไม่มีคำว่า subject_en
    // ตรงนี้กันฝั่ง schema ด้วย ไม่งั้นบังคับให้โมเดลตอบภาษาที่ผู้ใช้ไม่ได้ขอ
    assert.strictEqual(Object.keys(schema.properties).length, want.length, `language=${language}`);
  }
});

test('draftIssue: schema จำกัด suggested_risk_level ให้เป็นห้าระดับที่ Redmine รู้จักเท่านั้น', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
  const risk = cap.body.response_format.json_schema.schema.properties.suggested_risk_level;
  assert.deepStrictEqual(risk.enum, ['Low', 'Fairly Low', 'Moderate', 'High', 'Very High']);
});

// ── PCI DSS risk assessment (2026-08-06) ─────────────────────────────────────
// เพิ่มมุมข้อมูลบัตรชำระเงินเข้าในหัวข้อ "การประเมินความเสี่ยง" ที่มีอยู่แล้ว
// ดู docs/superpowers/specs/2026-08-06-pci-risk-assessment-design.md
//
// เทสชุดนี้ล็อก "มีกฎครบ" ไม่ล็อกถ้อยคำทั้งประโยค (ถ้อยคำต้องปรับได้ตามผลที่วัดจากโมเดลจริง)
// ยกเว้นข้อห้ามอ้างเลขข้อ ที่ล็อกไว้แน่นเพราะเป็นตัวกันไม่ให้ใครมาเติมทีหลัง

test('systemPromptFor: ทุก tracker ได้บล็อก PCI ไม่ใช่เฉพาะ Bug', () => {
  for (const t of ['Bug', 'Feature', 'Epic', 'Support', 'ไม่รู้จัก']) {
    assert.ok(systemPromptFor(t, 'th').includes('PCI DSS'), `${t} ต้องมีบล็อก PCI`);
  }
});

test('systemPromptFor: PCI บอกนิยามขอบเขตเป็นรูปธรรม ครบทั้ง CHD และ SAD', () => {
  const p = systemPromptFor('Bug', 'th');
  // ข้อมูลบัตร (CHD)
  assert.ok(p.includes('เลขบัตร'), 'ต้องระบุเลขบัตร');
  assert.ok(p.includes('วันหมดอายุ'), 'ต้องระบุวันหมดอายุ');
  // ข้อมูลยืนยันตัวตน (SAD) — กลุ่มนี้ห้ามเก็บเด็ดขาด หลุดหายไปคือเสียสาระของ PCI
  assert.ok(p.includes('CVV'), 'ต้องระบุ CVV');
  assert.ok(p.includes('PIN'), 'ต้องระบุ PIN');
});

test('systemPromptFor: PCI มีครบทั้งสามสถานะ รวม "ยืนยันไม่ได้" ที่กันโมเดลฟันธงมั่ว', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(p.includes('อยู่ในขอบเขต'), 'ต้องมีสถานะอยู่ในขอบเขต');
  assert.ok(p.includes('ไม่อยู่ในขอบเขต'), 'ต้องมีสถานะไม่อยู่ในขอบเขต');
  assert.ok(p.includes('ยืนยันไม่ได้จากโน้ต'), 'ต้องมีสถานะยืนยันไม่ได้');
});

test('systemPromptFor: PCI ดันระดับความเสี่ยงขึ้นได้อย่างเดียว ห้ามดึงลง', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(p.includes('สูงกว่า'), 'ต้องบอกให้เอาค่าที่สูงกว่า');
  assert.ok(p.includes('ห้ามใช้ระดับ PCI ที่ต่ำกว่ามาลดระดับ'), 'ต้องห้ามลดระดับอย่างชัดเจน');
});

// เดิมห้ามอ้างเลขข้อเด็ดขาด แต่วัดจริง 2026-08-06 แล้วโมเดลไม่ทำตาม 8/8 (อ้าง
// "PCI DSS Requirement 3" ทุกครั้งกับเคสเลขบัตรใน log ซึ่งเป็นข้อที่ถูกต้องด้วย)
// พรอมป์เป็นการ "ขอ" ไม่ใช่กลไกบังคับ — เปลี่ยนเป็นให้อ้างได้แต่ต้องเขียนแบบมีเงื่อนไข
// ส่วนคำชี้ขาด compliance ใช้ guard ระดับโค้ดแทน (neutralizeComplianceVerdict)
test('systemPromptFor: PCI ให้อ้างข้อกำหนดได้แบบมีเงื่อนไข ไม่ใช่ห้ามเด็ดขาด', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(p.includes('แบบมีเงื่อนไข'), 'ต้องบอกให้เขียนแบบมีเงื่อนไข');
  assert.ok(p.includes('ห้ามยืนยันว่าตรงกับข้อใดแน่นอน'), 'ต้องห้ามฟันธงว่าตรงข้อไหน');
  assert.ok(!p.includes('ห้ามอ้างเลขข้อ'), 'กฎห้ามเด็ดขาดต้องถูกถอดออกแล้ว');
});

test('neutralizeComplianceVerdict: เปลี่ยนคำชี้ขาดเป็นกลาง แล้วแปะหมายเหตุให้ QA รู้ว่าถูกปรับ', () => {
  const out = neutralizeComplianceVerdict('พบว่าเป็นการละเมิดข้อกำหนดโดยตรง');
  assert.ok(!out.includes('ละเมิด'), 'คำว่าละเมิดต้องหายไป');
  assert.ok(out.includes('กระทบ'), 'ต้องแทนด้วยคำที่เป็นกลาง');
  assert.ok(out.includes('หมายเหตุระบบ'), 'ต้องแปะหมายเหตุให้ QA เห็นว่าระบบปรับถ้อยคำ');
});

test('neutralizeComplianceVerdict: จับทั้งฝั่งที่บอกว่าไม่ละเมิด ไม่ใช่แค่ฝั่งที่บอกว่าละเมิด', () => {
  const out = neutralizeComplianceVerdict('ยืนยันว่าไม่มีการละเมิดมาตรฐาน');
  assert.ok(!out.includes('ละเมิด'));
  assert.ok(out.includes('หมายเหตุระบบ'));
});

test('neutralizeComplianceVerdict: ข้อความที่ไม่มีคำชี้ขาด ต้องไม่ถูกแตะและไม่มีหมายเหตุงอก', () => {
  const clean = 'PCI DSS: อยู่ในขอบเขต — PAN โผล่ใน log · ระดับ Very High เพราะข้อมูลบัตรถูกเปิดเผย';
  assert.strictEqual(neutralizeComplianceVerdict(clean), clean);
});

test('draftIssue: description ที่กลับมาผ่าน guard แล้ว ทั้ง th และ en', async () => {
  const dirty = JSON.stringify({
    subject_en: 's', subject_th: 'ส',
    description_en: 'this is non-compliant with the standard',
    description_th: 'เป็นการละเมิดข้อกำหนด',
    suggested_risk_level: 'High', missing_info: [],
  });
  const fetchImpl = async () => ({
    ok: true, json: async () => ({ choices: [{ message: { content: dirty } }] }),
  });
  const r = await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.ok(r.ok);
  assert.ok(!r.draft.description_th.includes('ละเมิด'), 'ฝั่งไทยต้องถูก guard');
  assert.ok(!/non-?compliant/i.test(r.draft.description_en), 'ฝั่งอังกฤษต้องถูก guard');
});

test('systemPromptFor: บล็อก PCI ไม่ผูกกับภาษาที่เลือก', () => {
  for (const lang of ['th', 'en', 'both']) {
    assert.ok(systemPromptFor('Bug', lang).includes('PCI DSS'), `language ${lang}`);
  }
});

test('draftIssue: เพิ่ม PCI แล้ว schema ต้องไม่เปลี่ยน — ไม่มีฟิลด์ pci_* โผล่มา', async () => {
  const cap = {};
  await draftIssue('โน้ต', { language: 'th', apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
  const schema = cap.body.response_format.json_schema.schema;
  assert.deepStrictEqual(
    [...schema.required].sort(),
    ['description_th', 'missing_info', 'subject_th', 'suggested_risk_level'],
  );
  assert.ok(!JSON.stringify(schema).includes('pci'), 'PCI ต้องอยู่ในพรอมป์เท่านั้น ไม่ใช่ schema');
});

// วัดจริง 2026-08-06: พรอมป์รุ่นแรกห้ามแค่ "ฟันธงว่าละเมิด" โมเดลเลยไปฟันธงด้านตรงข้ามแทน
// ("ยืนยันว่าไม่มีการละเมิด") ซึ่งเป็นการชี้ขาด compliance เหมือนกัน และอันตรายกว่าเพราะ
// เป็นการให้ความมั่นใจปลอม ปิดช่องไม่ให้ผู้ตรวจสอบดูต่อ — ต้องปิดทั้งสองทิศ
test('systemPromptFor: PCI ห้ามฟันธง compliance ทั้งสองทิศ ไม่ใช่ห้ามแค่ทางที่ว่าละเมิด', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(p.includes('ละเมิดหรือไม่ละเมิด'), 'ต้องห้ามฟันธงทั้งสองทิศอย่างชัดเจน');
  assert.ok(p.includes('ห้ามรับรองว่าปลอดภัย'), 'ต้องห้ามออกใบรับรองความปลอดภัยด้วย');
});

// วัดจริง 2026-08-06 (6/6 รอบ): บอกว่ามีสามสถานะเฉย ๆ ไม่พอ — โมเดลเลือก "ไม่อยู่ในขอบเขต"
// ทุกครั้งโดยให้เหตุผลว่า "โน้ตไม่ได้พูดถึงข้อมูลบัตร" ซึ่งคือการสรุปจากการไม่มีข้อมูล
// อันเป็นสิ่งที่สถานะที่สามมีไว้กันพอดี ต้องบอกเกณฑ์เลือกให้ชัด ไม่ใช่แค่ลิสต์สถานะ
test('systemPromptFor: PCI บอกเกณฑ์ว่าเมื่อไหร่ใช้ "ยืนยันไม่ได้" แทน "ไม่อยู่ในขอบเขต"', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(p.includes('ไม่เกี่ยวกับการเงินเลย'), 'ต้องจำกัดว่า "ไม่อยู่ในขอบเขต" ใช้ได้เมื่อไหร่');
  assert.ok(
    p.includes('การไม่พูดถึงไม่ใช่หลักฐานว่าไม่มี'),
    'ต้องบอกตรง ๆ ว่าห้ามสรุปจากการที่โน้ตเงียบ',
  );
});

// วัดจริง 2026-08-06: ลิสต์ระบบการเงินเป็นภาษาไทยล้วน ทำให้โน้ตที่เขียนชื่อหน้าจอเป็นอังกฤษ
// ("หน้าจอ Transfer") ไม่เข้าเกณฑ์ — ได้ "ไม่อยู่ในขอบเขต" 3/3 ขณะที่ "หน้าจอโอนเงิน"
// ได้ "ยืนยันไม่ได้" 3/3 ทั้งที่เป็นหน้าจอเดียวกัน UI ที่ทีมเทสส่วนใหญ่เป็นอังกฤษ ลิสต์จึงต้องมีทั้งสองภาษา
test('systemPromptFor: ลิสต์ระบบการเงินมีคำอังกฤษด้วย ไม่ใช่ไทยล้วน', () => {
  const p = systemPromptFor('Bug', 'th');
  for (const w of ['transfer', 'payment', 'checkout', 'refund']) {
    assert.ok(p.toLowerCase().includes(w), `ลิสต์ต้องมีคำว่า ${w}`);
  }
});

// ===== แปล error ดิบของ endpoint ให้ผู้ใช้ทำต่อได้ (วัด 2026-08-06) =====
const { friendlyEndpointError } = require('../llm.js');

const VLLM_IMAGE_ERROR = JSON.stringify({
  error: {
    message: 'litellm.BadRequestError: Hosted_vllmException - {"error":{"message":"Failed to apply '
      + "Qwen3VLProcessor on data={'text': '<|vision_start|><|image_pad|><|vision_end|>', 'images': "
      + '[<PIL.Image.Image image mode=RGB size=2398x1096>]} with kwargs={\'return_tensors\': \'pt\'}"}}',
  },
});

test('friendlyEndpointError: error เรื่องรูปต้องบอกว่าให้ทำอะไรต่อ ไม่ใช่พ่น <|image_pad|> ใส่หน้า', () => {
  const msg = friendlyEndpointError(400, VLLM_IMAGE_ERROR);
  assert.ok(!msg.includes('image_pad'), 'ต้องไม่มี token ดิบของโมเดลหลุดมาให้ผู้ใช้อ่าน');
  assert.ok(!msg.includes('Qwen3VLProcessor'), 'ต้องไม่มีชื่อ class ภายในของ endpoint');
  assert.ok(/รูป/.test(msg), 'ต้องบอกว่าปัญหาอยู่ที่รูป');
});

test('friendlyEndpointError: error อื่นต้องส่งข้อความเดิมต่อ ไม่กลืนจนดีบักไม่ได้', () => {
  assert.ok(friendlyEndpointError(401, '{"error":"invalid api key"}').includes('invalid api key'));
});

test('friendlyEndpointError: body ว่างต้องเหลือรหัส HTTP ไว้ ไม่ใช่ข้อความว่าง', () => {
  assert.strictEqual(friendlyEndpointError(502, ''), 'HTTP 502');
});

test('friendlyEndpointError: body ยาวมากยังถูกตัดเหมือนเดิม ไม่ท่วมกล่องสถานะ', () => {
  assert.ok(friendlyEndpointError(500, 'x'.repeat(5000)).length <= 400);
});

test('draftIssue: endpoint ปฏิเสธเพราะรูป ต้องคืนข้อความที่อ่านรู้เรื่อง', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => VLLM_IMAGE_ERROR });
  const r = await draftIssue('โน้ต', {
    apiKey: 'k', baseUrl: 'https://x', images: IMG, fetchImpl,
  });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.error.includes('image_pad'), r.error);
  assert.ok(/รูป/.test(r.error), r.error);
});
