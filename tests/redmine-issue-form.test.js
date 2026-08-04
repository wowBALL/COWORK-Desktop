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
