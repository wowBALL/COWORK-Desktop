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

test('composeDescription: th-only ไม่มี block ภาษาอังกฤษเลย', () => {
  const d = composeDescription('th', 'อาการ: กดไม่ติด', '');
  assert.ok(d.includes('🇹🇭'));
  assert.ok(!d.includes('🇬🇧'));
});

test('composeDescription: en-only ไม่มี block ภาษาไทยเลย', () => {
  const d = composeDescription('en', '', 'Symptom: not clickable');
  assert.ok(d.includes('🇬🇧'));
  assert.ok(!d.includes('🇹🇭'));
});

test('composeDescription: both มีครบสองภาษา คั่นด้วย ---', () => {
  const d = composeDescription('both', 'อาการ: กดไม่ติด', 'Symptom: not clickable');
  assert.ok(d.includes('🇹🇭'));
  assert.ok(d.includes('🇬🇧'));
  assert.ok(d.includes('---'));
  assert.ok(d.indexOf('🇹🇭') < d.indexOf('---'));
  assert.ok(d.indexOf('---') < d.indexOf('🇬🇧'));
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
