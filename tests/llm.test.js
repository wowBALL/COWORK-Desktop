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
