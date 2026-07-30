const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// `build.files` ใน package.json เป็น allowlist — ไฟล์ที่ไม่ได้ใส่จะไม่ถูกแพ็กเข้า asar
// ตอน `npm start` อ่านจากดิสก์ตรง ๆ ทุกอย่างจึงทำงานปกติ ความพลาดโผล่เฉพาะในตัวติดตั้ง
// v1.9.0 ปล่อยออกไปแบบ grafana.js หายทั้งไฟล์ แอปตายที่ require ก่อนเปิดหน้าต่างได้เลย
// เทสชุดนี้กันไว้: ทุกไฟล์ที่แอปอ้างถึงจริงต้องอยู่ใน list
const REPO = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const listed = new Set(pkg.build.files);
const has = f => listed.has(f) || [...listed].some(p => p.endsWith('/**/*') && f.startsWith(p.slice(0, -5)));

// ไฟล์ที่ renderer โหลดผ่านแท็ก — <script src> / <link href> เฉพาะ path ในเครื่อง
function htmlRefs(file) {
  const html = fs.readFileSync(path.join(REPO, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');   // คอมเมนต์ในไฟล์นี้มี <style> กับตัวอย่างมาร์กอัปปนอยู่
  const out = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
    if (/^(https?:|data:|#|mailto:)/i.test(m[1])) continue;
    out.add(m[1].replace(/^\.\//, ''));
  }
  return out;
}

// require('./x') ฝั่ง main process — ไล่ต่อเป็นทอด ๆ เพราะโมดูลที่ถูก require อาจ require ต่อ
function localRequires(entries) {
  const seen = new Set(), out = new Set();
  const walk = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) return;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      let t = m[1].replace(/^\.\//, '');
      if (!/\.[a-z]+$/i.test(t)) t += '.js';   // require('./grafana') → grafana.js
      out.add(t);
      walk(t);
    }
  };
  entries.forEach(walk);
  return out;
}

const HTML = ['widget.html', 'screensaver.html'];
const refs = new Set(HTML.flatMap(f => [...htmlRefs(f)]));
const reqs = localRequires(['main.js', 'preload.js']);

test('build.files มีทุกไฟล์ที่ widget.html โหลด', () => {
  assert.ok(refs.size >= 10, 'ดึง ref ไม่ออก — regex พัง ไม่ใช่ว่าไฟล์ไม่อ้างอะไรเลย');
  const missing = [...refs].filter(f => !has(f));
  assert.deepStrictEqual(missing, [], 'ไฟล์เหล่านี้จะหายจากตัวติดตั้ง: ' + missing.join(' '));
});

test('build.files มีทุกโมดูลที่ main/preload require', () => {
  assert.ok(reqs.size >= 3, 'ไล่ require ไม่ออก — regex พัง ไม่ใช่ว่า main ไม่ require อะไรเลย');
  const missing = [...reqs].filter(f => !has(f));
  assert.deepStrictEqual(missing, [], 'แอปจะตายที่ require: ' + missing.join(' '));
});

// กันคนละแบบ: ถ้าลบไฟล์ทิ้งแต่ลืมลบ <script src> เทสสองตัวบนจะเขียวหลอก
// เพราะมันเช็คแค่ว่าอยู่ใน list ไม่ได้เช็คว่ามีไฟล์จริง
test('ทุกไฟล์ที่อ้างถึงมีอยู่จริงบนดิสก์', () => {
  const ghost = [...refs, ...reqs].filter(f => !fs.existsSync(path.join(REPO, f)));
  assert.deepStrictEqual(ghost, [], 'อ้างถึงไฟล์ที่ไม่มี: ' + ghost.join(' '));
});

// เวอร์ชันใน CHANGELOG ต้องตรง package.json — ปล่อยเวอร์ชันแล้วลืมเขียน changelog เจอบ่อย
test('CHANGELOG มีหัวข้อของเวอร์ชันปัจจุบัน', () => {
  const cl = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  assert.ok(cl.includes('## v' + pkg.version), 'ไม่มี ## v' + pkg.version + ' ใน CHANGELOG.md');
});
