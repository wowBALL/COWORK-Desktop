const test = require('node:test');
const assert = require('node:assert');
const { stripJsonFence, systemPromptFor, draftIssue, PROVIDERS, DEFAULT_MODEL, neutralizeComplianceVerdict, uiXmlRulesFor, userContentWithDumps } = require('../llm.js');

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

// ===== หัวข้อประเมินความเสี่ยงต้องมีสองส่วน ไม่ใช่เหลือแต่ PCI (2026-08-06) =====
// PCI เข้ามาเป็น block ยาว 15 บรรทัดที่กำหนดฟอร์แมตเป๊ะ ส่วนกฎผลกระทบเดิมมีประโยคเดียว
// น้ำหนักจึงเทไปทาง PCI จนการประเมินผลกระทบเหลือบาง ๆ หรือถูกเขียนด้วยภาษา PCI ทั้งย่อหน้า
for (const tracker of ['Bug', 'Feature', 'Epic', 'Support', 'ไม่รู้จัก']) {
  test(`systemPromptFor(${tracker}): สั่งลำดับชัดว่าผลกระทบมาก่อน PCI ปิดท้าย`, () => {
    const p = systemPromptFor(tracker, 'th', []);
    assert.ok(/ไม่แทนที่หรือย่อการประเมินผลกระทบ/.test(p), 'ต้องบอกว่า PCI เป็นส่วนเพิ่ม ไม่ใช่ส่วนแทน');
    assert.ok(/บรรทัดสุดท้ายของหัวข้อ/.test(p), 'ต้องระบุว่า PCI อยู่บรรทัดสุดท้าย');
  });
}

// กฎลำดับพูดที่เดียวพอ — ตอนที่ย้ำทั้งใน systemPromptFor และ pciRulesFor โมเดลเริ่มลอกโครง
// พรอมป์ออกมาเป็นหัวข้อในคำตอบ (missing_info กับป้าย PCI ซ้ำสองชั้นโผล่ใน description 2/6)
test('systemPromptFor: กฎเรื่องลำดับต้องไม่ถูกย้ำซ้ำสองที่', () => {
  const p = systemPromptFor('Bug', 'th', []);
  const hits = p.match(/ไม่แทนที่หรือย่อการประเมินผลกระทบ|ผลกระทบตามเกณฑ์ปกติมาก่อนเสมอ/g) || [];
  assert.strictEqual(hits.length, 1, `ย้ำ ${hits.length} ครั้ง — ควรมีที่เดียว`);
});

test('systemPromptFor: กฎผลกระทบต้องมาก่อนบล็อก PCI ในตัวพรอมป์เอง', () => {
  const p = systemPromptFor('Bug', 'th', []);
  assert.ok(p.indexOf('ผลกระทบต่อระบบ') < p.indexOf('PCI DSS'), 'ลำดับในพรอมป์ต้องสะท้อนลำดับที่ต้องการในคำตอบ');
});

test('systemPromptFor: ยังบอกสิ่งที่ต้องตอบในส่วนผลกระทบครบตามเดิม', () => {
  const p = systemPromptFor('Bug', 'th', []);
  for (const must of ['ผลกระทบต่อระบบ', 'ผลกระทบต่อผู้ใช้', 'ลามไปกระทบส่วนอื่น', 'ทางแก้ชั่วคราว', 'เกิดทุกครั้งหรือบางครั้ง']) {
    assert.ok(p.includes(must), `ขาด "${must}"`);
  }
});

test('systemPromptFor: ห้ามเขียนส่วนผลกระทบด้วยภาษา PCI — สองส่วนต้องแยกกันจริง', () => {
  const p = systemPromptFor('Bug', 'th', []);
  assert.ok(/ห้ามอธิบายผลกระทบด้วยเหตุผลด้านข้อมูลบัตร/.test(p));
});

test('systemPromptFor: กฎลำดับต้องอยู่กับกฎ PCI ไม่ใช่ผูกกับ tracker ใด tracker หนึ่ง', () => {
  // ย้ายที่ผิดแล้ว tracker ที่ Redmine เพิ่มมาทีหลังจะไม่ได้กฎนี้ — บั๊กคลาส "แก้ไม่ครบ"
  const known = systemPromptFor('Bug', 'th', []);
  const unknown = systemPromptFor('Trackerใหม่ที่ยังไม่มีในโค้ด', 'th', []);
  for (const rule of ['ไม่แทนที่หรือย่อการประเมินผลกระทบ', 'ห้ามอธิบายผลกระทบด้วยเหตุผลด้านข้อมูลบัตร', 'ผลกระทบต่อระบบ']) {
    assert.ok(unknown.includes(rule), `tracker ที่ไม่รู้จักต้องได้กฎ "${rule}" ด้วย`);
    assert.strictEqual(known.includes(rule), unknown.includes(rule), rule);
  }
});

test('systemPromptFor: ส่วนผลกระทบต้องปิดท้ายด้วยชื่อระดับเป็นคำ ไม่ใช่บอกผลกระทบแล้วจบลอย ๆ', () => {
  const p = systemPromptFor('Bug', 'th', []);
  assert.ok(/ประโยคสุดท้ายของหัวข้อต้องระบุชื่อระดับ/.test(p));
});

// ===== เลือกได้ว่างานนี้ต้องประเมิน PCI DSS ไหม (2026-08-06) =====
// ค่าเริ่มต้นคือประเมิน — งานที่ทีมนี้ทดสอบส่วนใหญ่อยู่ในระบบร้านอาหาร/ชำระเงิน
// การเผลอไม่ประเมินอันตรายกว่าการประเมินเกินจำเป็น และคนติ๊กออกคือการตัดสินใจของคน
test('systemPromptFor: ไม่ติ๊ก PCI = ไม่มีบล็อก PCI ในพรอมป์เลยสักคำ', () => {
  const p = systemPromptFor('Bug', 'th', [], { pci: false });
  assert.ok(!/PCI/i.test(p), 'ต้องไม่เหลือร่องรอย PCI');
  assert.ok(!/CVV|PIN block|track data/i.test(p), 'ต้องไม่เหลือนิยามขอบเขตด้วย');
});

test('systemPromptFor: ค่าเริ่มต้นคือประเมิน PCI — ไม่ส่ง option มาต้องเหมือนติ๊กไว้', () => {
  assert.strictEqual(systemPromptFor('Bug', 'th', []), systemPromptFor('Bug', 'th', [], { pci: true }));
  assert.ok(systemPromptFor('Bug', 'th', []).includes('PCI DSS'));
});

test('systemPromptFor: ปิด PCI แล้วกฎผลกระทบสองส่วนต้องยังอยู่ครบ', () => {
  const p = systemPromptFor('Bug', 'th', [], { pci: false });
  assert.ok(p.includes('ผลกระทบต่อระบบ'), 'ส่วนระบบต้องอยู่');
  assert.ok(p.includes('ผลกระทบต่อผู้ใช้'), 'ส่วนผู้ใช้ต้องอยู่');
  assert.ok(/ประโยคสุดท้ายของหัวข้อต้องระบุชื่อระดับ/.test(p), 'ประโยคสรุประดับต้องอยู่');
});

test('systemPromptFor: ข้อห้ามเรื่องภาษาบัตรอยู่ในบล็อก PCI — ปิดแล้วต้องหายไปด้วย ไม่ค้างเป็นกฎลอย', () => {
  assert.ok(systemPromptFor('Bug', 'th', [], { pci: true }).includes('ห้ามอธิบายผลกระทบด้วยเหตุผลด้านข้อมูลบัตร'));
  assert.ok(!systemPromptFor('Bug', 'th', [], { pci: false }).includes('ห้ามอธิบายผลกระทบด้วยเหตุผลด้านข้อมูลบัตร'));
});

for (const tracker of ['Bug', 'Feature', 'Epic', 'Support', 'ไม่รู้จัก']) {
  test(`systemPromptFor(${tracker}): แยกผลกระทบเป็นสองส่วน ระบบ กับ ผู้ใช้`, () => {
    const p = systemPromptFor(tracker, 'th', []);
    assert.ok(p.indexOf('ผลกระทบต่อระบบ') < p.indexOf('ผลกระทบต่อผู้ใช้'), 'ระบบต้องมาก่อนผู้ใช้');
    assert.ok(p.indexOf('ผลกระทบต่อผู้ใช้') < p.indexOf('PCI DSS'), 'ทั้งสองส่วนต้องมาก่อน PCI');
  });
}

test('draftIssue: pci:false ทะลุถึง system prompt ที่ส่งออกไปจริง', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', pci: false, fetchImpl: okFetch(cap) });
  assert.ok(!/PCI/i.test(cap.body.messages[0].content));
});

test('draftIssue: ไม่ส่ง pci มา = ยังประเมิน PCI เหมือนเดิม (ของเก่าที่เรียกอยู่ต้องไม่เปลี่ยนพฤติกรรม)', async () => {
  const cap = {};
  await draftIssue('โน้ต', { apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
  assert.ok(cap.body.messages[0].content.includes('PCI DSS'));
});

// ===== โมเดลลอกชื่อฟิลด์ของ schema มาต่อท้าย description (2026-08-06) =====
// วัดได้ 3/3 เมื่อปิดการประเมิน PCI: ปิดท้าย description ด้วยบรรทัด "missing_info: []"
// ซึ่งเป็นชื่อฟิลด์ใน JSON ไม่ใช่เนื้อหาที่คนต้องอ่าน — เคยลองแก้ด้วยพรอมป์แล้วเอาไม่อยู่
// ทั้งสองรอบ (ดู pciRulesFor) จึงกันที่โค้ดแทน
const { stripEchoedFields } = require('../llm.js');

test('stripEchoedFields: ตัดบรรทัดชื่อฟิลด์ที่ต่อท้าย ไม่แตะเนื้อหาข้างบน', () => {
  const out = stripEchoedFields('อาการ: กดไม่ติด\n\nการประเมินความเสี่ยง: ระดับ Low\n\nmissing_info: []');
  assert.strictEqual(out, 'อาการ: กดไม่ติด\n\nการประเมินความเสี่ยง: ระดับ Low');
});

test('stripEchoedFields: ตัดได้แม้เขียนเป็นหัวข้อตัวหนาพร้อมลิสต์ใต้มัน', () => {
  const out = stripEchoedFields('เนื้อหา\n\n**missing_info:**\n- route ไหน\n- browser อะไร');
  assert.strictEqual(out, 'เนื้อหา');
});

test('stripEchoedFields: ตัดชื่อฟิลด์อื่นของ schema ที่ถูกลอกมาด้วย', () => {
  for (const f of ['suggested_risk_level', 'subject_th', 'description_en']) {
    assert.strictEqual(stripEchoedFields(`เนื้อหา\n\n${f}: อะไรก็ตาม`), 'เนื้อหา', f);
  }
});

test('stripEchoedFields: ข้อความปกติต้องไม่ถูกแตะ', () => {
  const th = 'อาการ: กดไม่ติด\n\nการประเมินความเสี่ยง:\nผลกระทบต่อระบบ: ...\nผลกระทบต่อผู้ใช้: ...';
  assert.strictEqual(stripEchoedFields(th), th);
});

test('stripEchoedFields: ชื่อฟิลด์ที่อยู่กลางเนื้อหาต้องไม่ถูกตัด — ตัดเฉพาะที่ต่อท้าย', () => {
  const th = 'สิ่งที่ยังขาดให้ใส่ใน missing_info แทน\n\nการประเมินความเสี่ยง: ระดับ Low';
  assert.strictEqual(stripEchoedFields(th), th);
});

test('stripEchoedFields: ค่าที่ไม่ใช่สตริงต้องไม่พัง', () => {
  assert.strictEqual(stripEchoedFields(null), '');
  assert.strictEqual(stripEchoedFields(undefined), '');
});

test('draftIssue: ชื่อฟิลด์ที่ถูกลอกมาต่อท้ายถูกตัดออกก่อนถึงฟอร์ม ทั้ง th และ en', async () => {
  const content = JSON.stringify({
    subject_th: 'a', description_th: 'เนื้อ th\n\nmissing_info: []',
    subject_en: 'b', description_en: 'body en\n\nmissing_info: []',
    suggested_risk_level: 'Low', missing_info: [],
  });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const r = await draftIssue('โน้ต', { language: 'both', apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(r.draft.description_th, 'เนื้อ th');
  assert.strictEqual(r.draft.description_en, 'body en');
});

// ===== กฎภาษาขัดกับกฎ missing_info (2026-08-06) =====
// languageRulesFor('en') เดิมสั่ง "ห้ามปนภาษาไทยแม้แต่คำเดียว" ซึ่งครอบคลุมทั้งคำตอบ
// ชนกับกฎที่สั่งว่า missing_info ต้องเป็นไทยเสมอ — วัดจริงแล้วกฎภาษาชนะ 6/14
test('systemPromptFor: กฎภาษาอังกฤษต้องยกเว้น missing_info ไม่ใช่ห้ามไทยทั้งคำตอบ', () => {
  const p = systemPromptFor('Bug', 'en', []);
  assert.ok(!/ห้ามปนภาษาไทยแม้แต่คำเดียว/.test(p), 'ข้อห้ามแบบครอบคลุมทั้งคำตอบต้องไม่มีแล้ว');
  assert.ok(/missing_info/.test(p.slice(p.indexOf('ภาษาอังกฤษ'))), 'กฎภาษาต้องพูดถึง missing_info ตรง ๆ');
});

for (const language of ['th', 'en', 'both']) {
  test(`systemPromptFor(${language}): missing_info ต้องถูกสั่งให้เป็นไทยเสมอ`, () => {
    assert.ok(/missing_info[\s\S]*เขียนเป็นภาษาไทยเสมอ/.test(systemPromptFor('Bug', language, [])));
  });
}

test('systemPromptFor: en ยังบังคับให้ subject/description เป็นอังกฤษอยู่ ไม่ได้ปล่อยหลุด', () => {
  const p = systemPromptFor('Bug', 'en', []);
  assert.ok(/subject.*description.*ภาษาอังกฤษ|ภาษาอังกฤษ.*subject.*description/s.test(p));
});

// โน้ตดิบบรรทัดเดียวแทบไม่มีทางตอบครบทุกข้อ แต่พรอมป์เดิมเปิดทางให้ตอบ [] ง่ายเกินไป
// วัดจริง: missing_info ว่าง 11/15 เมื่อเลือกภาษาไทย
test('systemPromptFor: การตอบ missing_info เป็น [] ต้องมีเงื่อนไขชัด ไม่ใช่ทางออกง่าย ๆ', () => {
  const p = systemPromptFor('Bug', 'th', []);
  assert.ok(/ตอบเป็น \[\] ได้เฉพาะเมื่อ/.test(p), 'ต้องจำกัดว่าเมื่อไหร่ถึงตอบว่างได้');
  assert.ok(/โน้ตดิบมักสั้น/.test(p), 'ต้องบอกสมมติฐานตั้งต้นว่าโน้ตมักไม่ครบ');
});

// พรอมป์บอกว่า missing_info ต้องเป็นไทยแล้วยังหลุดเป็นอังกฤษเมื่อเลือก EN — ย้ายมาบอกใน
// json_schema ด้วย เพราะ schema เป็นช่องทางที่บังคับรูปคำตอบได้แรงกว่าข้อความในพรอมป์
// (บทเรียนเดียวกับตอนเปลี่ยน json_object -> json_schema)
test('draftIssue: schema ระบุภาษาของ missing_info ไว้ในตัว schema เอง ไม่ใช่แค่ในพรอมป์', async () => {
  for (const language of ['th', 'en', 'both']) {
    const cap = {};
    await draftIssue('โน้ต', { language, apiKey: 'k', baseUrl: 'https://x', fetchImpl: okFetch(cap) });
    const mi = cap.body.response_format.json_schema.schema.properties.missing_info;
    assert.ok(mi.description, `language=${language} ต้องมี description`);
    assert.ok(/ไทย/.test(mi.description), `language=${language} ต้องระบุว่าเป็นภาษาไทย`);
    assert.ok(/ไทย/.test(mi.items.description || ''), `language=${language} ต้องระบุที่ระดับ item ด้วย`);
  }
});

// ===== ฟิลด์ภาษาที่ขอไปแล้วไม่ได้กลับมา ต้องไม่เงียบ (2026-08-06) =====
// ผู้ใช้รายงานว่าเลือก EN+TH แล้วได้แต่ไทย — ยิงวัด 48 ตัวอย่างแล้วทำซ้ำไม่ได้เลย (0/48)
// เมื่อทำซ้ำไม่ได้ก็ซ่อมตรง ๆ ไม่ได้ สิ่งที่ทำได้คือทำให้ตอนมันเกิดอีกครั้ง ผู้ใช้เห็นทันที
// แทนที่จะได้ร่างที่ดูปกติแต่ขาดไปครึ่งหนึ่งโดยไม่มีสัญญาณอะไรเลย
test('draftIssue: both แล้วขาดฝั่ง en ต้องเตือน ไม่ใช่คืนร่างครึ่งเดียวเงียบ ๆ', async () => {
  const content = JSON.stringify({
    subject_th: 'ก', description_th: 'เนื้อไทย', subject_en: '', description_en: '',
    suggested_risk_level: 'Low', missing_info: [],
  });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const r = await draftIssue('โน้ต', { language: 'both', apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.strictEqual(r.ok, true, 'ยังต้องคืนร่างที่ได้มา ไม่ใช่ทิ้งทั้งใบ');
  assert.ok(Array.isArray(r.warnings) && r.warnings.length, 'ต้องมีคำเตือน');
  assert.ok(/EN|อังกฤษ/.test(r.warnings[0]), r.warnings[0]);
});

test('draftIssue: ครบทั้งสองภาษา ต้องไม่มีคำเตือนงอกมากวน', async () => {
  // ต้องใช้ payload ที่มีครบทั้งสองฝั่งจริง — OK_JSON มีแต่ฝั่งไทย ซึ่งควรเตือนอยู่แล้ว
  const content = JSON.stringify({
    subject_th: 'ก', description_th: 'ไทย', subject_en: 'a', description_en: 'english',
    suggested_risk_level: 'Low', missing_info: [],
  });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const r = await draftIssue('โน้ต', { language: 'both', apiKey: 'k', baseUrl: 'https://x', fetchImpl });
  assert.deepStrictEqual(r.warnings, []);
});

test('draftIssue: th/en เดี่ยว ต้องไม่เตือนเรื่องภาษาที่ไม่ได้ขอ', async () => {
  for (const language of ['th', 'en']) {
    const content = JSON.stringify({
      subject_th: 'ก', description_th: 'ไทย', subject_en: 'a', description_en: 'en',
      suggested_risk_level: 'Low', missing_info: [],
    });
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
    const r = await draftIssue('โน้ต', { language, apiKey: 'k', baseUrl: 'https://x', fetchImpl });
    assert.deepStrictEqual(r.warnings, [], language);
  }
});

// ===== คำถามของหัวข้อประเมินความเสี่ยงต่างกันตามชนิดงาน (2026-08-06) =====
// เดิมใช้ถ้อยคำชุดเดียวที่คิดจากมุม Bug ("อะไรทำงานผิดหรือหยุด") พอเป็น Feature ที่ยังไม่มี
// อะไรพัง โมเดลเลยหันไปเขียนประโยชน์ที่จะได้ถ้าทำแทน ซึ่งไม่ใช่ความเสี่ยง และซ้ำกับหัวข้อ
// "ผลกระทบถ้าไม่ทำ" ที่โครง Feature มีอยู่แล้ว
test('systemPromptFor(Bug): ถามถึงสิ่งที่พังอยู่ตอนนี้', () => {
  const p = systemPromptFor('Bug', 'th', []);
  assert.ok(/อะไรทำงานผิดหรือหยุด/.test(p));
  assert.ok(!/ขึ้นระบบ/.test(p), 'Bug ไม่ควรได้คำถามเรื่องความเสี่ยงตอนดีพลอย');
});

test('systemPromptFor(Feature): ถามถึงความเสี่ยงตอนนำขึ้นระบบ ไม่ใช่สิ่งที่พังอยู่', () => {
  const p = systemPromptFor('Feature', 'th', []);
  assert.ok(/ขึ้นระบบ/.test(p), 'ต้องถามเรื่องการนำขึ้นระบบ');
  assert.ok(!/อะไรทำงานผิดหรือหยุด/.test(p), 'ถ้อยคำมุม Bug ต้องไม่ติดมาด้วย');
});

test('systemPromptFor(Feature): ห้ามเขียนประโยชน์ที่จะได้ลงหัวข้อความเสี่ยง', () => {
  assert.ok(/ห้ามเขียนประโยชน์/.test(systemPromptFor('Feature', 'th', [])));
});

test('systemPromptFor: tracker ที่ไม่รู้จักต้องได้ชุดคำถามสำรอง ไม่ใช่ undefined หลุดเข้าพรอมป์', () => {
  const p = systemPromptFor('Trackerใหม่', 'th', []);
  assert.ok(!/undefined/.test(p), p.slice(0, 200));
  assert.ok(/ผลกระทบต่อระบบ/.test(p) && /ผลกระทบต่อผู้ใช้/.test(p));
});

for (const tracker of ['Bug', 'Feature', 'Epic', 'Support', 'ไม่รู้จัก']) {
  test(`systemPromptFor(${tracker}): ยังคงสองส่วน + ประโยคสรุประดับ ไม่ว่าคำถามจะต่างกันแค่ไหน`, () => {
    const p = systemPromptFor(tracker, 'th', []);
    assert.ok(p.indexOf('ผลกระทบต่อระบบ') < p.indexOf('ผลกระทบต่อผู้ใช้'));
    assert.ok(/ประโยคสุดท้ายของหัวข้อต้องระบุชื่อระดับ/.test(p));
  });
}

// ---- เช็กลิสต์ E2E สำหรับ Testing Room ----
const { draftTestChecklist, cleanChecklistItems, CHECKLIST_MAX } = require('../llm.js');

const okChecklist = items => async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] }),
});
const ISSUE = { subject: 'login แล้ว sidebar ว่าง', description: 'พบบน uat', tracker: 'Bug' };
const CFG = { apiKey: 'k', baseUrl: 'https://x' };

test('cleanChecklistItems: ตัดเลขลำดับ/บุลเล็ตที่โมเดลใส่นำหน้ามา', () => {
  assert.deepStrictEqual(
    cleanChecklistItems(['1. เข้าสู่ระบบ', '2) ดู sidebar', '- ดู dashboard', '• ออกจากระบบ']),
    ['เข้าสู่ระบบ', 'ดู sidebar', 'ดู dashboard', 'ออกจากระบบ']);
});
test('cleanChecklistItems: ตัดข้อว่างและข้อซ้ำ', () => {
  assert.deepStrictEqual(cleanChecklistItems(['เข้าสู่ระบบ', '  ', 'เข้าสู่ระบบ', null]), ['เข้าสู่ระบบ']);
});
test('cleanChecklistItems: ยุบขึ้นบรรทัดใหม่ในข้อเดียวให้เป็นบรรทัดเดียว', () => {
  // ข้อหนึ่งข้อ = หนึ่งแถวในตาราง markdown ขึ้นบรรทัดใหม่กลางข้อทำให้ตารางขาด
  assert.deepStrictEqual(cleanChecklistItems(['เข้าสู่ระบบ\nแล้วดู sidebar']), ['เข้าสู่ระบบ แล้วดู sidebar']);
});
test('cleanChecklistItems: ตัดที่เพดาน CHECKLIST_MAX', () => {
  const many = Array.from({ length: CHECKLIST_MAX + 5 }, (_, i) => 'ข้อ ' + i);
  assert.strictEqual(cleanChecklistItems(many).length, CHECKLIST_MAX);
});

test('draftTestChecklist: ยังไม่ตั้งค่า LLM = ไม่ยิงเน็ต', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await draftTestChecklist(ISSUE, { apiKey: '', baseUrl: '', fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(called, false);
});
test('draftTestChecklist: งานที่ไม่มีหัวเรื่อง = ไม่ยิงเน็ต', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await draftTestChecklist({ subject: '   ' }, { ...CFG, fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(called, false);
});
test('draftTestChecklist: บังคับรูปร่างคำตอบด้วย json_schema ไม่ใช่ json_object', async () => {
  let body = null;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return okChecklist(['ก'])(); };
  await draftTestChecklist(ISSUE, { ...CFG, fetchImpl });
  assert.strictEqual(body.response_format.type, 'json_schema');
  assert.deepStrictEqual(body.response_format.json_schema.schema.required, ['items']);
});
test('draftTestChecklist: คืนข้อที่ล้างแล้ว', async () => {
  const r = await draftTestChecklist(ISSUE, { ...CFG, fetchImpl: okChecklist(['1. เข้าสู่ระบบ', 'เข้าสู่ระบบ', 'ดู sidebar']) });
  assert.deepStrictEqual(r, { ok: true, items: ['เข้าสู่ระบบ', 'ดู sidebar'] });
});
test('draftTestChecklist: โมเดลไม่เสนอข้อเลย = ok:false พร้อมบอกทางออก', async () => {
  const r = await draftTestChecklist(ISSUE, { ...CFG, fetchImpl: okChecklist([]) });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /เพิ่มข้อเองได้/);
});
test('draftTestChecklist: คำตอบถูกตัดเพราะ budget บอกให้เปลี่ยนโมเดล', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{"items":["เข้าสู่' } }] }),
  });
  const r = await draftTestChecklist(ISSUE, { ...CFG, fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /budget/);
});
test('draftTestChecklist: โมเดลที่ไม่รู้จักไม่ยิงเน็ต', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await draftTestChecklist(ISSUE, { ...CFG, model: 'ไม่มีอยู่จริง', fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(called, false);
});

// ---- comment ของ dev ที่แนบไปกับเช็กลิสต์ ----
const { historyForChecklist, HISTORY_MAX_CHARS } = require('../llm.js');

const J = (date, name, notes) => ({ created_on: date + 'T03:00:00Z', user: { name }, notes });

test('historyForChecklist: ทิ้ง journal ที่เป็นการเปลี่ยน field เฉย ๆ', () => {
  // journal ส่วนใหญ่ของงานหนึ่งคือการย้ายสถานะ/เปลี่ยน assignee ซึ่งไม่มีข้อความให้อ่าน
  const out = historyForChecklist([
    { created_on: '2026-08-01T03:00:00Z', user: { name: 'a' }, details: [{}] },
    J('2026-08-02', 'satit', 'แก้ที่ fixOrphanedOutlets แล้ว'),
    J('2026-08-03', 'b', '   '),
    null,
  ]);
  assert.strictEqual(out, '[2026-08-02] satit: แก้ที่ fixOrphanedOutlets แล้ว');
});

test('historyForChecklist: ไม่มี comment เลยคืนสตริงว่าง ไม่ใช่หัวข้อเปล่า', () => {
  // สตริงว่างคือสัญญาณให้ draftTestChecklist ไม่ใส่หัวข้อ comment ลงพรอมป์เลย
  assert.strictEqual(historyForChecklist([]), '');
  assert.strictEqual(historyForChecklist(undefined), '');
  assert.strictEqual(historyForChecklist([{ notes: '' }]), '');
});

test('historyForChecklist: เรียงเก่า → ใหม่ ตามที่พรอมป์บอกไว้', () => {
  const out = historyForChecklist([J('2026-08-01', 'a', 'เก่า'), J('2026-08-05', 'b', 'ใหม่')]);
  assert.ok(out.indexOf('เก่า') < out.indexOf('ใหม่'));
});

test('historyForChecklist: ตัดของเก่าทิ้งก่อนเสมอ และเก็บอันใหม่สุดไว้', () => {
  // ข้อมูลที่ dev เพิ่งเพิ่มมาว่า "แก้อะไรไปแล้ว" อยู่ท้ายเสมอ ตัดท้ายทิ้ง = ตัดส่วนที่มีค่าที่สุด
  const many = Array.from({ length: 40 }, (_, i) => J('2026-08-01', 'a', 'x'.repeat(300) + ' อันที่ ' + i));
  const out = historyForChecklist(many);
  assert.ok(out.includes('อันที่ 39'), 'comment ใหม่สุดต้องอยู่');
  assert.ok(!out.includes('อันที่ 0'), 'comment เก่าสุดต้องถูกตัด');
  assert.ok(out.length <= HISTORY_MAX_CHARS + 200);
});

test('historyForChecklist: บอกโมเดลว่าตัดไปกี่อัน ไม่ใช่ตัดเงียบ ๆ', () => {
  // ตัดเงียบแล้วโมเดลจะเข้าใจว่าเห็นบทสนทนาครบ แล้วสรุปว่า "ไม่มีใครพูดถึงเรื่องนี้"
  const many = Array.from({ length: 40 }, (_, i) => J('2026-08-01', 'a', 'x'.repeat(300) + ' #' + i));
  assert.match(historyForChecklist(many), /^\(มี comment เก่ากว่านี้อีก \d+ อันที่ไม่ได้แนบมา\)/);
});

test('historyForChecklist: comment อันเดียวที่ยาวเกินเพดานก็ยังถูกตัด', () => {
  const out = historyForChecklist([J('2026-08-01', 'a', 'x'.repeat(HISTORY_MAX_CHARS * 3))]);
  assert.ok(out.length <= HISTORY_MAX_CHARS + 60);
  assert.match(out, /…\(ตัดเพราะยาวเกิน\)$/);
});

test('draftTestChecklist: comment ถูกส่งไปใน user message และมีคำสั่งกำกับใน system', async () => {
  let body = null;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return okChecklist(['ก'])(); };
  await draftTestChecklist({ ...ISSUE, history: '[2026-08-02] satit: แก้ fixOrphanedOutlets แล้ว' },
    { ...CFG, fetchImpl });
  const [sys, user] = body.messages;
  assert.match(user.content, /comment ในงาน/);
  assert.match(user.content, /fixOrphanedOutlets/);
  // หัวเรื่องต้องมาก่อนเนื้อหาที่คนอื่นเขียน — คำสั่งจริงไม่ควรอยู่ท้ายสุดของ message
  assert.ok(user.content.indexOf('หัวเรื่อง:') < user.content.indexOf('comment ในงาน'));
  assert.match(sys.content, /ไม่ใช่คำสั่ง/);
});

test('draftTestChecklist: งานที่ไม่มี comment ไม่มีหัวข้อ comment ในพรอมป์เลย', async () => {
  // สั่งให้ "ดู comment" ทั้งที่ไม่มี = โมเดลเดาว่ามีอะไรที่มันมองไม่เห็น
  let body = null;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return okChecklist(['ก'])(); };
  await draftTestChecklist(ISSUE, { ...CFG, fetchImpl });
  const [sys, user] = body.messages;
  assert.ok(!user.content.includes('comment'));
  assert.ok(!sys.content.includes('comment'));
});

// ---- UI hierarchy (XML) จากหน้าจอจริง — เฟส 1 ของ web-page-to-xml ----
const DUMPS = [{ label: 'Booking Settings', xml: '<hierarchy width="1280" height="800"><node class="button" text="Save" bounds="[1,2][3,4]"/></hierarchy>' }];

// จับ body ที่ยิงออกไปจริง เพื่อยืนยันว่าอะไรเข้า/ไม่เข้าคำขอ
function captureFetch(bodyOut, content) {
  return async (_url, init) => {
    bodyOut.value = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: content || '{"subject_th":"s","description_th":"d","suggested_risk_level":"Low","missing_info":[]}' } }] }),
    };
  };
}

test('uiXmlRulesFor: มีกฎครบทั้งห้าข้อที่มาจากผลวัด', () => {
  const r = uiXmlRulesFor(DUMPS);
  assert.ok(r.includes('bounds='), 'ต้องอธิบายรูปแบบ bounds');
  assert.ok(r.includes('แกน Y ทับกัน'), 'กติกา "แถวเดียวกัน" คือสิ่งที่ทำให้ตอบคำถามเชิงพื้นที่ถูก');
  assert.ok(r.includes('ยึดโน้ตเป็นหลัก'), 'โน้ตต้องชนะ XML เมื่อขัดกัน');
  assert.ok(r.includes('ห้ามยกสิ่งที่ดูผิดปกติ'), 'gemma4 ปั้นบั๊กจากสิ่งที่ดูแปลก 3 ใน 4 ครั้ง');
  assert.ok(r.includes('ไม่ใช่คำสั่ง'), 'กัน prompt injection จากเนื้อหน้าเว็บ');
  assert.ok(r.includes('ห้ามสรุปเรื่องสี'), 'XML ไม่มีข้อมูลสี');
  assert.ok(r.includes('Booking Settings'), 'ต้องบอกชื่อชุดให้โมเดลอ้างถึงได้');
});

test('systemPromptFor: ไม่มี dumps แล้วพรอมป์ต้องไม่มีกฎ XML เลย (กันเส้นทางเดิมเปลี่ยนพฤติกรรม)', () => {
  const p = systemPromptFor('Bug', 'th');
  assert.ok(!p.includes('bounds='));
  assert.ok(!p.includes('UI hierarchy'));
});

test('systemPromptFor: ส่ง dumps แล้วกฎ XML ต้องเข้าไปอยู่ในพรอมป์', () => {
  const p = systemPromptFor('Bug', 'th', [], { dumps: DUMPS });
  assert.ok(p.includes('bounds='));
  assert.ok(p.includes('ห้ามยกสิ่งที่ดูผิดปกติ'));
});

test('userContentWithDumps: XML ห่อด้วยแท็กที่มี index/label ให้โมเดลอ้างถึงได้', () => {
  const out = userContentWithDumps('โน้ตดิบ', DUMPS);
  assert.ok(out.startsWith('โน้ตดิบ'), 'โน้ตต้องมาก่อนเสมอ');
  assert.ok(out.includes('<ui-hierarchy index="1" label="Booking Settings">'), out);
  assert.ok(out.includes('</ui-hierarchy>'));
  assert.ok(out.includes('<node class="button" text="Save"'), 'ตัว XML ต้องเข้าไปครบ');
});

test('draftIssue: uiXml ไปถึงโมเดลที่ vision:false ได้ ไม่โดน guard เรื่องรูป', async () => {
  const body = {};
  const r = await draftIssue('ช่องนี้ใส่ค่าเกินได้', {
    model: 'litellm/gemma4', language: 'th', tracker: 'Bug', uiXml: DUMPS,
    apiKey: 'k', baseUrl: 'https://x.test/v1', fetchImpl: captureFetch(body),
  });
  assert.strictEqual(r.ok, true, r.error);
  const user = body.value.messages.find(m => m.role === 'user');
  assert.strictEqual(typeof user.content, 'string', 'ไม่มีรูป content ต้องยังเป็นสตริงเหมือนเดิม');
  assert.ok(user.content.includes('<ui-hierarchy index="1"'), 'XML ต้องอยู่ใน user message');
  assert.ok(body.value.messages[0].content.includes('bounds='), 'กฎต้องอยู่ใน system message');
});

test('draftIssue: ไม่ส่ง uiXml แล้ว user message ต้องเป็นโน้ตดิบล้วน ๆ เหมือนเดิมเป๊ะ', async () => {
  const body = {};
  await draftIssue('โน้ตดิบล้วน', {
    model: 'litellm/gemma4', language: 'th', tracker: 'Bug',
    apiKey: 'k', baseUrl: 'https://x.test/v1', fetchImpl: captureFetch(body),
  });
  const user = body.value.messages.find(m => m.role === 'user');
  assert.strictEqual(user.content, 'โน้ตดิบล้วน');
  assert.ok(!body.value.messages[0].content.includes('ui-hierarchy'));
});

test('draftIssue: uiXml ที่ไม่มี xml จริงถูกกรองทิ้ง ไม่สร้างบล็อกเปล่า', async () => {
  const body = {};
  await draftIssue('โน้ต', {
    model: 'litellm/gemma4', language: 'th', tracker: 'Bug', uiXml: [{ label: 'ว่าง' }, null],
    apiKey: 'k', baseUrl: 'https://x.test/v1', fetchImpl: captureFetch(body),
  });
  const user = body.value.messages.find(m => m.role === 'user');
  assert.strictEqual(user.content, 'โน้ต');
});
