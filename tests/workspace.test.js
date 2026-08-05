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

// ── parseFrontmatter ─────────────────────────────────────────────────────
const { parseFrontmatter } = require('../workspace.js');

test('parseFrontmatter แยก YAML frontmatter ออกจากเนื้อความ', () => {
  const { data, body } = parseFrontmatter(`---
type: project
status: active
tags: [project, when/release]
---

# หัวข้อ

เนื้อความ`);
  assert.strictEqual(data.type, 'project');
  assert.strictEqual(data.status, 'active');
  assert.deepStrictEqual(data.tags, ['project', 'when/release']);
  assert.strictEqual(body.trim(), '# หัวข้อ\n\nเนื้อความ'.trim());
});

test('parseFrontmatter คืน data ว่างเมื่อไม่มี frontmatter', () => {
  const { data, body } = parseFrontmatter('# แค่หัวข้อ\n\nเนื้อความ');
  assert.deepStrictEqual(data, {});
  assert.strictEqual(body, '# แค่หัวข้อ\n\nเนื้อความ');
});

test('parseFrontmatter อ่าน block list (บรรทัดขึ้นต้น -) ได้ด้วย', () => {
  const { data } = parseFrontmatter(`---
projects:
  - "[[meeting-notes]]"
  - "[[COWORK-Desktop]]"
---

เนื้อความ`);
  assert.deepStrictEqual(data.projects, ['[[meeting-notes]]', '[[COWORK-Desktop]]']);
});

// บั๊กที่ reviewer ของ Task 16 จับได้: heuristic เดิม startsWith('[') && endsWith(']')
// เข้าใจผิดว่า [[wikilink]] เดี่ยวๆ (scalar) เป็น flow-sequence แล้วตัดวงเล็บนอกทิ้งพร้อม
// บังคับเป็น array — ทั้งที่ค่าจริงควรเป็น string เฉยๆ
test('parseFrontmatter ไม่เข้าใจผิดว่า scalar [[wikilink]] เดี่ยวๆ เป็น flow-sequence', () => {
  const { data } = parseFrontmatter(`---
related: [[Some Note]]
tags: [project, when/release]
---

เนื้อความ`);
  assert.strictEqual(data.related, '[[Some Note]]');
  assert.deepStrictEqual(data.tags, ['project', 'when/release']);
});
