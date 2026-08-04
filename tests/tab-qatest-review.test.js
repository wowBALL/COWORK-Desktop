const test = require('node:test');
const assert = require('node:assert');
require('../util.js');
// tab-qatest.js destructure global.COWORK.dateFilter ตอนโหลด — require datefilter.js ก่อน
// (แบบเดียวกับ tests/tab-meeting.test.js)
require('../datefilter.js');
const { buildReviewLines } = require('../tab-qatest.js');

test('buildReviewLines: แปล priority/assignee/tracker กลับเป็นชื่อคนอ่านได้ ไม่ใช่ id ดิบ', () => {
  const lines = buildReviewLines(
    {
      projectName: 'Wallet', trackerName: 'Bug', subject: 'กดไม่ติด', priorityName: 'High',
      assigneeId: 7, riskLevel: 'High', customFieldValues: { '8': 'rollback text' },
      uploads: [{ filename: 'shot.png' }],
    },
    { members: [{ id: 7, name: 'kom' }], customFields: [{ id: 8, name: 'Rollback Plan' }] },
  );
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]));
  assert.strictEqual(byLabel['โปรเจกต์'], 'Wallet');
  assert.strictEqual(byLabel['Priority'], 'High');
  assert.strictEqual(byLabel['ผู้รับผิดชอบ'], 'kom');
  assert.strictEqual(byLabel['Rollback Plan'], 'rollback text');
  assert.ok(byLabel['ไฟล์แนบ'].includes('shot.png'));
});

test('buildReviewLines: ไม่มี assignee แสดง "(ไม่ระบุ)" ไม่ใช่ id ว่างเปล่า', () => {
  const lines = buildReviewLines(
    { projectName: 'Wallet', trackerName: 'Bug', subject: 's', priorityName: 'Normal', customFieldValues: {} },
    { members: [], customFields: [] },
  );
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]));
  assert.strictEqual(byLabel['ผู้รับผิดชอบ'], '(ไม่ระบุ)');
});
