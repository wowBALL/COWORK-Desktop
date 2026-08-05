const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWorkspace, parseFrontmatter } = require('../workspace.js');

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-ws-test-'));
  for (const d of ['projects', 'daily/2026/08', 'lessons', 'refs', 'rules', 'playbooks']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  return root;
}
function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

// ── parseFrontmatter ────────────────────────────────────────────────────
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

// ── readWorkspace: flat folders ─────────────────────────────────────────
test('readWorkspace อ่าน projects/ แบบแบนราบ ไม่ต้องมี Public/Private', () => {
  const root = makeVault();
  writeFile(root, 'projects/meeting-notes.md', `---
type: project
status: active
repo_visibility: public
repo: wowBALL/meeting-notes
path: D:/COWORK/meeting-notes
updated: 2026-08-05
tags: [project]
---

# meeting-notes

## ภาพรวม

ระบบอัดและสรุปประชุม`);
  const { projects } = readWorkspace(root);
  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].name, 'meeting-notes');
  assert.strictEqual(projects[0].status, 'active');
  assert.strictEqual(projects[0].visibility, 'Public');
  assert.strictEqual(projects[0].repo, 'wowBALL/meeting-notes');
  assert.strictEqual(projects[0].desc, 'ระบบอัดและสรุปประชุม');
});

test('readWorkspace รู้จักสถานะ dropped (⛔)', () => {
  const root = makeVault();
  writeFile(root, 'projects/old.md', `---
type: project
status: dropped
repo_visibility: none
---

# old`);
  const { projects } = readWorkspace(root);
  assert.strictEqual(projects[0].status, 'dropped');
});

test('readWorkspace ยัง fallback อ่านตาราง Markdown เดิมได้ถ้าไม่มี frontmatter', () => {
  const root = makeVault();
  writeFile(root, 'projects/legacy.md', `# legacy

| | |
|---|---|
| **สถานะ** | 🟢 กำลังทำ |
| **ที่อยู่โปรเจกต์** | D:\\COWORK\\legacy |
| **อัปเดตล่าสุด** | 2026-07-01 |

## ภาพรวม

โปรเจกต์เก่าที่ยังไม่ได้ migrate`);
  const { projects } = readWorkspace(root);
  assert.strictEqual(projects[0].status, 'active');
  assert.strictEqual(projects[0].desc, 'โปรเจกต์เก่าที่ยังไม่ได้ migrate');
  // path/updated ก็ต้อง fallback อ่านจากตารางเดิมได้เหมือนกัน ไม่ใช่แค่ status/desc
  assert.strictEqual(projects[0].path, 'D:\\COWORK\\legacy');
  assert.strictEqual(projects[0].updated, '2026-07-01');
});

test('readWorkspace: daily แบบเดิม (ไม่มี frontmatter) อ่าน date จากชื่อไฟล์', () => {
  const root = makeVault();
  writeFile(root, 'daily/2026/07/2026-07-01.md', `# บันทึกงาน 2026-07-01

## legacy

- **ทำอะไรไปบ้าง:** งานเก่าก่อน migrate`);
  const { daily } = readWorkspace(root);
  assert.strictEqual(daily[0].date, '2026-07-01');
});

test('readWorkspace: lessons/refs/rules แบบเดิม (ชื่อไฟล์นำวันที่, ไม่มี frontmatter) อ่าน date+name fallback ได้', () => {
  const root = makeVault();
  writeFile(root, 'lessons/2026-07-01-legacy-lesson-name.md', `เนื้อความบทเรียนเก่าก่อน migrate ไม่มี frontmatter และไม่มี heading #`);
  const { lessons } = readWorkspace(root);
  assert.strictEqual(lessons.length, 1);
  assert.strictEqual(lessons[0].date, '2026-07-01');
  assert.strictEqual(lessons[0].name, 'legacy lesson name');
});

test('readWorkspace อ่าน daily/ แบบแบนราบ', () => {
  const root = makeVault();
  writeFile(root, 'daily/2026/08/2026-08-03.md', `---
type: daily
date: 2026-08-03
tags: [daily]
---

# บันทึกงาน 2026-08-03

## COWORK Desktop

- **ทำอะไรไปบ้าง:**
  - เพิ่มโมเดล Qwen 3.6
  - รันเทสต์ครบ 257/257
- **เจออะไร / ค้นพบอะไร:** —
`);
  const { daily } = readWorkspace(root);
  const entries = daily[0].entries.filter((e) => e.project === 'COWORK Desktop');
  assert.deepStrictEqual(entries.map((e) => e.text), ['เพิ่มโมเดล Qwen 3.6', 'รันเทสต์ครบ 257/257']);
});

test('readWorkspace ข้ามส่วนที่ยังไม่มีเนื้อหา', () => {
  const root = makeVault();
  writeFile(root, 'daily/2026/08/2026-08-03.md', `# บันทึกงาน 2026-08-03

## Empty Project

- **ทำอะไรไปบ้าง:** —
- **เจออะไร / ค้นพบอะไร:**
`);
  const { daily } = readWorkspace(root);
  assert.deepStrictEqual(daily[0].entries, []);
});

test('readWorkspace อ่าน refs/ พร้อม subject และ projects link', () => {
  const root = makeVault();
  writeFile(root, 'refs/windows-file-lock-after-close.md', `---
type: ref
updated: 2026-08-05
subject: windows
projects: ["[[COWORK-Desktop]]"]
tags: [ref, when/windows]
---

# ไฟล์ที่เพิ่งปิดบน Windows ถูกล็อกอยู่ ~900ms

เนื้อความเต็ม`);
  const { refs } = readWorkspace(root);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].subject, 'windows');
  assert.deepStrictEqual(refs[0].projects, ['[[COWORK-Desktop]]']);
  assert.deepStrictEqual(refs[0].tags, ['ref', 'when/windows']);
});

test('readWorkspace อ่าน rules/', () => {
  const root = makeVault();
  writeFile(root, 'rules/gate-push-not-commit.md', `---
type: rule
tags: [rule, when/push-publish]
---

# Commit อิสระเมื่อเทสต์ผ่าน แต่ push ต้องขอทุกครั้ง

เนื้อความ`);
  const { rules } = readWorkspace(root);
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].name, 'Commit อิสระเมื่อเทสต์ผ่าน แต่ push ต้องขอทุกครั้ง');
});

test('readWorkspace ดึงงานค้าง (- [ ]) จากหน้าโปรเจกต์', () => {
  const root = makeVault();
  writeFile(root, 'projects/x.md', `---
type: project
status: active
repo_visibility: none
---

# x

## สถานะปัจจุบัน / งานค้าง

- [ ] เขียนเทสต์เพิ่ม
- [x] ทำเสร็จแล้ว ไม่นับ
- [ ] ปล่อยเวอร์ชัน v2`);
  const { projects, stats } = readWorkspace(root);
  assert.deepStrictEqual(projects[0].tasks, ['เขียนเทสต์เพิ่ม', 'ปล่อยเวอร์ชัน v2']);
  assert.strictEqual(stats.tasks, 2);
});

test('readWorkspace stats.dropped นับสถานะ ⛔', () => {
  const root = makeVault();
  writeFile(root, 'projects/a.md', '---\ntype: project\nstatus: active\nrepo_visibility: none\n---\n\n# a');
  writeFile(root, 'projects/b.md', '---\ntype: project\nstatus: dropped\nrepo_visibility: none\n---\n\n# b');
  const { stats } = readWorkspace(root);
  assert.strictEqual(stats.active, 1);
  assert.strictEqual(stats.dropped, 1);
});
