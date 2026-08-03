const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWorkspace } = require('../workspace.js');

function makeVault(dailyContent) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-ws-test-'));
  const dailyDir = path.join(root, 'Public', 'daily', '2026', '08');
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'Public', 'projects'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Private', 'daily'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Private', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(dailyDir, '2026-08-03.md'), dailyContent, 'utf8');
  return root;
}

// ── ทำอะไรไปบ้าง แบบหลายบูลเลต ──────────────────────────────────────────
// บั๊กเดิม: regex อ่านแค่บรรทัดเดียวหลัง "ทำอะไรไปบ้าง:**" ทำให้วันที่มีหลายบูลเลต
// (แบบ A_Workspace/Private/daily/2026/08/2026-08-03.md ของจริง) เห็นแค่บูลเลตแรก
// ที่เหลือหายไปเงียบๆ ต้องเปิด .md เองถึงจะเห็นครบ
test('parseDaily อ่านทุกบูลเลตใต้ "ทำอะไรไปบ้าง" ไม่ใช่แค่บรรทัดแรก', () => {
  const root = makeVault(`# บันทึกงาน 2026-08-03

## COWORK Desktop

- **ทำอะไรไปบ้าง:**
  - เพิ่มโมเดล Qwen 3.6
  - รันเทสต์ครบ 257/257
  - ปล่อยเวอร์ชัน v1.9.7
- **เจออะไร / ค้นพบอะไร:** —
`);
  const { daily } = readWorkspace(root);
  const entries = daily[0].entries.filter((e) => e.project === 'COWORK Desktop');
  assert.deepStrictEqual(entries.map((e) => e.text), [
    'เพิ่มโมเดล Qwen 3.6',
    'รันเทสต์ครบ 257/257',
    'ปล่อยเวอร์ชัน v1.9.7',
  ]);
});

test('parseDaily ยังอ่านแบบข้อความบรรทัดเดียวได้เหมือนเดิม (ไม่ regression)', () => {
  const root = makeVault(`# บันทึกงาน 2026-08-03

## meeting-notes

- **ทำอะไรไปบ้าง:** เริ่มอัดประชุม "Standup" เวลา 09:59 — ยังอัดอยู่
- **เจออะไร / ค้นพบอะไร:** —
`);
  const { daily } = readWorkspace(root);
  const entries = daily[0].entries.filter((e) => e.project === 'meeting-notes');
  assert.deepStrictEqual(entries.map((e) => e.text), [
    'เริ่มอัดประชุม "Standup" เวลา 09:59 — ยังอัดอยู่',
  ]);
});

test('parseDaily ข้ามส่วนที่ยังไม่มีเนื้อหา (แค่ — หรือว่างเปล่า)', () => {
  const root = makeVault(`# บันทึกงาน 2026-08-03

## Empty Project

- **ทำอะไรไปบ้าง:** —
- **เจออะไร / ค้นพบอะไร:**
`);
  const { daily } = readWorkspace(root);
  assert.deepStrictEqual(daily[0].entries, []);
});
