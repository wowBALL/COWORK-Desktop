const test = require('node:test');
const assert = require('node:assert');
const { fieldSchemaKey, buildFieldSchema } = require('../redmine-issue-form.js');

test('fieldSchemaKey: ประกอบ key จาก projectId + trackerName', () => {
  assert.strictEqual(fieldSchemaKey(12, 'Bug'), '12||Bug');
});

test('buildFieldSchema: รวม custom field ที่เจอ กลุ่มตาม project+tracker', () => {
  const issues = [
    { project: { id: 12, name: 'Wallet' }, tracker: { name: 'Bug' }, custom_fields: [
      { id: 5, name: 'Risk Level', value: 'High' },
      { id: 8, name: 'Rollback Plan', value: 'x' },
      { id: 9, name: 'Impact Analysis', value: 'y' },
    ] },
    { project: { id: 12, name: 'Wallet' }, tracker: { name: 'Bug' }, custom_fields: [
      { id: 5, name: 'Risk Level', value: 'Low' },
      { id: 10, name: 'Test Results', value: '' },
    ] },
  ];
  const schema = buildFieldSchema(issues);
  const fields = schema[fieldSchemaKey(12, 'Bug')];
  assert.deepStrictEqual(
    fields.map(f => f.name).sort(),
    ['Impact Analysis', 'Risk Level', 'Rollback Plan', 'Test Results'].sort(),
  );
});

test('buildFieldSchema: project/tracker ต่างกันไม่ปนกัน', () => {
  const issues = [
    { project: { id: 12, name: 'Wallet' }, tracker: { name: 'Bug' }, custom_fields: [{ id: 8, name: 'Rollback Plan' }] },
    { project: { id: 20, name: 'Menutable' }, tracker: { name: 'Bug' }, custom_fields: [{ id: 5, name: 'Risk Level' }] },
    { project: { id: 12, name: 'Wallet' }, tracker: { name: 'Feature' }, custom_fields: [{ id: 5, name: 'Risk Level' }] },
  ];
  const schema = buildFieldSchema(issues);
  assert.strictEqual(schema[fieldSchemaKey(12, 'Bug')].length, 1);
  assert.strictEqual(schema[fieldSchemaKey(20, 'Bug')].length, 1);
  assert.strictEqual(schema[fieldSchemaKey(12, 'Feature')].length, 1);
  assert.strictEqual(schema[fieldSchemaKey(20, 'Feature')], undefined);
});

test('buildFieldSchema: issue ที่ไม่มี project หรือ tracker ถูกข้าม ไม่ throw', () => {
  const issues = [{ custom_fields: [{ id: 1, name: 'x' }] }, null, undefined];
  assert.deepStrictEqual(buildFieldSchema(issues), {});
});

test('buildFieldSchema: ไม่มี custom_fields เลยก็ไม่ throw คืน array ว่าง', () => {
  const issues = [{ project: { id: 1 }, tracker: { name: 'Bug' } }];
  const schema = buildFieldSchema(issues);
  assert.deepStrictEqual(schema[fieldSchemaKey(1, 'Bug')], []);
});

test('buildFieldSchema: project ที่มีทั้ง id และ identifier ต้องค้นได้ทั้งสองคีย์', () => {
  const issues = [
    { project: { id: 12, identifier: 'wallet' }, tracker: { name: 'Bug' }, custom_fields: [
      { id: 5, name: 'Risk Level' },
    ] },
  ];
  const schema = buildFieldSchema(issues);
  assert.deepStrictEqual(schema[fieldSchemaKey(12, 'Bug')].map(f => f.name), ['Risk Level']);
  assert.deepStrictEqual(schema[fieldSchemaKey('wallet', 'Bug')].map(f => f.name), ['Risk Level']);
});

const { composeDescription } = require('../redmine-issue-form.js');

test('composeDescription: th-only คืนเนื้อหาไทยตรง ๆ ไม่มีหัวข้อลอย', () => {
  const d = composeDescription('th', 'อาการ: กดไม่ติด', '');
  assert.strictEqual(d, 'อาการ: กดไม่ติด');
});

test('composeDescription: en-only คืนเนื้อหาอังกฤษตรง ๆ ไม่มีหัวข้อลอย', () => {
  const d = composeDescription('en', '', 'Symptom: not clickable');
  assert.strictEqual(d, 'Symptom: not clickable');
});

test('composeDescription: both มีครบสองภาษา คั่นด้วย --- (EN ก่อน TH) ไม่มีหัวข้อ 🇬🇧/🇹🇭', () => {
  const d = composeDescription('both', 'อาการ: กดไม่ติด', 'Symptom: not clickable');
  assert.ok(!d.includes('🇹🇭'));
  assert.ok(!d.includes('🇬🇧'));
  assert.ok(d.includes('---'));
  assert.ok(d.indexOf('Symptom: not clickable') < d.indexOf('---'));
  assert.ok(d.indexOf('---') < d.indexOf('อาการ: กดไม่ติด'));
});

test('composeDescription: th-only แต่ text ว่างเปล่า คืนสตริงว่าง ไม่ใช่หัวข้อลอย ๆ', () => {
  assert.strictEqual(composeDescription('th', '', ''), '');
});

const { buildIssuePayload } = require('../redmine-issue-form.js');

const IDS = {
  trackerIdByName: { Bug: 1, Feature: 2, Epic: 3, Support: 4 },
  priorityIdByName: { Low: 1, Normal: 2, High: 3, Urgent: 4, Immediate: 5 },
  riskLevelFieldId: 5,
};

test('buildIssuePayload: ฟิลด์ตายตัวครบ', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 'กดไม่ติด', description: 'รายละเอียด',
    priorityName: 'High',
  }, IDS);
  assert.strictEqual(issue.project_id, 12);
  assert.strictEqual(issue.tracker_id, 1);
  assert.strictEqual(issue.subject, 'กดไม่ติด');
  assert.strictEqual(issue.description, 'รายละเอียด');
  assert.strictEqual(issue.priority_id, 3);
});

test('buildIssuePayload: ไม่มี assignee ไม่ใส่ assigned_to_id เลย (ไม่ใช่ null)', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal',
  }, IDS);
  assert.ok(!('assigned_to_id' in issue));
});

test('buildIssuePayload: มี assignee ใส่ assigned_to_id', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal', assigneeId: 99,
  }, IDS);
  assert.strictEqual(issue.assigned_to_id, 99);
});

test('buildIssuePayload: riskLevel ประกอบเป็น custom_fields ด้วย riskLevelFieldId', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal', riskLevel: 'High',
  }, IDS);
  assert.deepStrictEqual(issue.custom_fields, [{ id: 5, value: 'High' }]);
});

test('buildIssuePayload: customFieldValues อื่น ๆ ต่อท้ายใน custom_fields ด้วย', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal',
    riskLevel: 'High', customFieldValues: { '8': 'Rollback text', '9': 'Impact text' },
  }, IDS);
  assert.deepStrictEqual(issue.custom_fields, [
    { id: 5, value: 'High' }, { id: 8, value: 'Rollback text' }, { id: 9, value: 'Impact text' },
  ]);
});

test('buildIssuePayload: customFieldValues ที่เป็นสตริงว่างไม่ถูกส่ง', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal',
    customFieldValues: { '8': '' },
  }, IDS);
  assert.ok(!('custom_fields' in issue));
});

test('buildIssuePayload: ไม่มี custom field เลยไม่ใส่ key custom_fields', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal',
  }, IDS);
  assert.ok(!('custom_fields' in issue));
});

test('buildIssuePayload: uploads ต่อเข้า issue.uploads ตรง ๆ', () => {
  const uploads = [{ token: 'abc.def', filename: 'shot.png', content_type: 'image/png' }];
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal', uploads,
  }, IDS);
  assert.deepStrictEqual(issue.uploads, uploads);
});

test('buildIssuePayload: ไม่มี status_id/watcher_user_ids/start_date เลย (นอก scope ของฟอร์มนี้)', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal',
  }, IDS);
  assert.ok(!('status_id' in issue));
  assert.ok(!('watcher_user_ids' in issue));
  assert.ok(!('start_date' in issue));
});

const { parseValidationErrors } = require('../redmine-issue-form.js');

test('parseValidationErrors: จับชื่อ field จากข้อความ error ได้ (ไม่สนตัวพิมพ์เล็กใหญ่)', () => {
  const result = parseValidationErrors(
    ["Rollback plan can't be blank", "Impact analysis can't be blank"],
    ['Rollback Plan', 'Impact Analysis', 'Risk Level'],
  );
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].fieldName, 'Rollback Plan');
  assert.strictEqual(result[1].fieldName, 'Impact Analysis');
});

test('parseValidationErrors: field ที่จับชื่อไม่ได้ยังคืน message พร้อม fieldName เป็น null', () => {
  const result = parseValidationErrors(["Subject can't be blank"], ['Rollback Plan']);
  assert.strictEqual(result[0].fieldName, null);
  assert.strictEqual(result[0].message, "Subject can't be blank");
});

test('parseValidationErrors: array ว่างคืน array ว่าง', () => {
  assert.deepStrictEqual(parseValidationErrors([], ['Rollback Plan']), []);
  assert.deepStrictEqual(parseValidationErrors(undefined, ['Rollback Plan']), []);
});

const { canonicalRiskLevel } = require('../redmine-issue-form.js');

test('canonicalRiskLevel: ค่าตรงเป๊ะคืนค่าเดิม', () => {
  assert.strictEqual(canonicalRiskLevel('Very High'), 'Very High');
  assert.strictEqual(canonicalRiskLevel('Low'), 'Low');
});

test('canonicalRiskLevel: จับคู่แบบไม่สนตัวพิมพ์เล็กใหญ่/ช่องว่างหัวท้าย', () => {
  assert.strictEqual(canonicalRiskLevel('very high'), 'Very High');
  assert.strictEqual(canonicalRiskLevel('  Fairly Low  '), 'Fairly Low');
  assert.strictEqual(canonicalRiskLevel('MODERATE'), 'Moderate');
});

test('canonicalRiskLevel: ค่าที่ไม่รู้จัก/ว่าง คืน string ว่าง', () => {
  assert.strictEqual(canonicalRiskLevel('extremely risky'), '');
  assert.strictEqual(canonicalRiskLevel(''), '');
  assert.strictEqual(canonicalRiskLevel(undefined), '');
});

const { findFieldIdByName, fieldAvailability } = require('../redmine-issue-form.js');

// id ของ custom field เป็นตัวเดียวกันทั้ง Redmine instance (ยืนยันกับของจริง: Risk Level = 7
// ทุกโปรเจกต์) — คู่ที่ยังไม่เคยเห็น issue จึงยืมจากคู่อื่นได้
const SCHEMA = {
  '12||Bug': [{ id: 7, name: 'Risk Level' }, { id: 4, name: 'Rollback Plan' }],
  '12||Support': [],
};

test('findFieldIdByName: เจอใน key ของตัวเองคืน id นั้น', () => {
  assert.strictEqual(findFieldIdByName(SCHEMA, 'Risk Level', '12||Bug'), 7);
});

test('findFieldIdByName: key ที่ไม่มี field นี้ ยืม id จาก key อื่นได้', () => {
  assert.strictEqual(findFieldIdByName(SCHEMA, 'Risk Level', '12||Support'), 7);
  assert.strictEqual(findFieldIdByName(SCHEMA, 'Risk Level', '99||Epic'), 7);
});

test('findFieldIdByName: ไม่รู้จักชื่อนี้ทั้งแคช คืน null', () => {
  assert.strictEqual(findFieldIdByName(SCHEMA, 'Sprint', '12||Bug'), null);
  assert.strictEqual(findFieldIdByName({}, 'Risk Level', '12||Bug'), null);
});

test('fieldAvailability: true เมื่อคู่นั้นมี field นี้', () => {
  assert.strictEqual(fieldAvailability(SCHEMA, 'Risk Level', '12||Bug'), true);
});

test('fieldAvailability: false เมื่อเคยเห็น issue ของคู่นั้นแล้วไม่มี field นี้', () => {
  assert.strictEqual(fieldAvailability(SCHEMA, 'Risk Level', '12||Support'), false);
  assert.strictEqual(fieldAvailability(SCHEMA, 'Sprint', '12||Bug'), false);
});

test('fieldAvailability: null เมื่อยังไม่เคยเห็น issue ของคู่นั้นเลย (ตอบไม่ได้ ไม่ใช่ไม่มี)', () => {
  assert.strictEqual(fieldAvailability(SCHEMA, 'Risk Level', '99||Epic'), null);
  assert.strictEqual(fieldAvailability({}, 'Risk Level', '12||Bug'), null);
});

const { embedImageAttachments } = require('../redmine-issue-form.js');

test('embedImageAttachments: แปะ <img> ไว้บนสุด คั่นเนื้อหาด้วยบรรทัดว่าง', () => {
  const out = embedImageAttachments('อาการ: กดแล้วไม่บันทึก', [
    { token: 't1', filename: 'shot.png', content_type: 'image/png' },
  ]);
  assert.strictEqual(out, '<img src="shot.png">\n\nอาการ: กดแล้วไม่บันทึก');
});

test('embedImageAttachments: หลายรูปเรียงตามลำดับที่แนบ', () => {
  const out = embedImageAttachments('x', [
    { filename: 'a.png', content_type: 'image/png' },
    { filename: 'b.jpg', content_type: 'image/jpeg' },
  ]);
  assert.strictEqual(out, '<img src="a.png">\n<img src="b.jpg">\n\nx');
});

test('embedImageAttachments: ไฟล์ที่ไม่ใช่รูปไม่ถูกฝัง (แนบท้ายตามปกติ)', () => {
  const out = embedImageAttachments('x', [
    { filename: 'log.txt', content_type: 'text/plain' },
    { filename: 'report.pdf', content_type: 'application/pdf' },
  ]);
  assert.strictEqual(out, 'x');
});

test('embedImageAttachments: รูปที่ผู้ใช้วางเองในเนื้อหาแล้ว ไม่ถูกแปะซ้ำที่หัวเรื่อง', () => {
  const typed = 'ขั้นตอน:\n\n<img src="shot.png">\n\nแล้วกดบันทึก';
  const out = embedImageAttachments(typed, [
    { filename: 'shot.png', content_type: 'image/png' },
  ]);
  assert.strictEqual(out, typed);
});

test('embedImageAttachments: แปะเฉพาะรูปที่ยังไม่ถูกอ้างในเนื้อหา', () => {
  const out = embedImageAttachments('ดู <img src="a.png"> ประกอบ', [
    { filename: 'a.png', content_type: 'image/png' },
    { filename: 'b.png', content_type: 'image/png' },
  ]);
  assert.strictEqual(out, '<img src="b.png">\n\nดู <img src="a.png"> ประกอบ');
});

test('embedImageAttachments: ไม่มีไฟล์แนบคืน description เดิมไม่แตะต้อง', () => {
  assert.strictEqual(embedImageAttachments('x', []), 'x');
  assert.strictEqual(embedImageAttachments('x', undefined), 'x');
});

test('embedImageAttachments: ดูนามสกุลได้เมื่อไม่มี content_type', () => {
  const out = embedImageAttachments('x', [{ filename: 'shot.PNG' }]);
  assert.strictEqual(out, '<img src="shot.PNG">\n\nx');
});

test('embedImageAttachments: escape ชื่อไฟล์กัน HTML attribute แตก', () => {
  const out = embedImageAttachments('', [{ filename: 'a"b&c.png', content_type: 'image/png' }]);
  assert.strictEqual(out, '<img src="a&quot;b&amp;c.png">');
});

test('buildIssuePayload: description ที่ส่งจริงมีแท็ก <img> ของรูปที่แนบ', () => {
  const { issue } = buildIssuePayload({
    projectId: 12, trackerName: 'Bug', subject: 's', description: 'd', priorityName: 'Normal',
    uploads: [{ token: 't1', filename: 'shot.png', content_type: 'image/png' }],
  }, IDS);
  assert.strictEqual(issue.description, '<img src="shot.png">\n\nd');
  // ยังต้องแนบไฟล์ตามปกติด้วย ไม่ใช่ฝังอย่างเดียว
  assert.strictEqual(issue.uploads.length, 1);
});
