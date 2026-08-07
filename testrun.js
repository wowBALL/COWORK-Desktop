'use strict';
// แปลง "ข้อ auto ในใบเทส" เป็นคำสั่งที่เอาไป spawn ได้จริง
//
// อยู่แยกจาก main.js เพราะเป็นด่านความปลอดภัย: renderer ส่งมาแค่ (ระบบ, ชื่อไฟล์) เท่านั้น
// คำสั่งถูกประกอบที่นี่จากรายชื่อไฟล์ที่อ่านจากดิสก์จริง ไม่เคยเชื่อ path หรือ command ที่
// ส่งข้ามมา — คลาสเดียวกับที่ save-qtest จำกัดปลายทางไว้ใน qtestDir
//
// pure ล้วน ไม่มี fs/Electron — รับ sources ที่อ่านมาแล้วเข้ามา จึงรันผ่าน node --test ได้ตรง
const path = require('path');

// ชื่อไฟล์เทสที่ยอมให้สั่งรัน แคบไว้ก่อน เพราะบน Windows ต้อง spawn ผ่าน shell เพื่อเรียก
// .cmd/.bat ได้ ซึ่งแปลว่าอักขระพิเศษในชื่อไฟล์จะมีความหมายกับ cmd.exe
// (ชื่อยังถูกเช็คซ้ำว่ามีอยู่จริงในโฟลเดอร์ที่ตั้งค่าไว้อีกชั้น ไม่ได้พึ่ง regex อย่างเดียว)
const SAFE_TEST_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;

// run-test.bat กับ playwright.config.js อยู่ระดับเดียวกับโฟลเดอร์ tests\ ไม่ใช่ข้างใน
// ส่วน autoTestSources ชี้ไปที่โฟลเดอร์ไฟล์เทส คำสั่งจึงต้องถอยขึ้นมาหนึ่งชั้น
// playwright หา config จาก cwd — สั่งจากในโฟลเดอร์ tests/ จะไม่เจอ testDir แล้วรันไม่ออกเลย
function repoRootOf(p) {
  return String(p || '').replace(/[\\/]+$/, '').replace(/[\\/]tests$/i, '');
}

// เลือกแหล่งของไฟล์: ยึด label ที่ใบเทสจดไว้ก่อน · ใบเก่าที่ยังไม่มี label ค้นให้ แต่ต้องเจอ
// แหล่งเดียวเท่านั้น ชื่อซ้ำสองแหล่งแล้วเดาผิด = ไปรันเทสคนละตัวโดยที่ผลดูเหมือนถูกต้อง
function planStep(sources, system, test) {
  const list = Array.isArray(sources) ? sources : [];
  const name = String(test == null ? '' : test);
  if (!SAFE_TEST_NAME.test(name)) return { ok: false, test: name, error: `ชื่อไฟล์เทสไม่ปลอดภัยพอจะสั่งรัน: ${name}` };
  const hits = list.filter(s => (s.tests || []).includes(name));
  const byLabel = system ? hits.find(s => s.label === system) : null;
  const src = byLabel || (hits.length === 1 ? hits[0] : null);
  if (!src) {
    return {
      ok: false, test: name, system: system || '',
      error: hits.length > 1
        ? `ไฟล์ "${name}" มีอยู่ในหลายระบบ — เปิดใบเทสแล้วกดเลือกไฟล์ใหม่เพื่อระบุว่าใช้ระบบไหน`
        : `หา "${name}" ในโฟลเดอร์ไฟล์เทสที่ตั้งค่าไว้ไม่เจอ`,
    };
  }
  const cwd = repoRootOf(src.path);
  // .spec.js = ชุด Playwright · ที่เหลือคือชุดมือถือที่ต้องผ่าน run-test.bat
  // เรียก binary ในเครื่องโปรเจกต์ ไม่ใช่ npx — npx จะไปโหลดจากเน็ตถ้าหาในเครื่องไม่เจอ
  // ซึ่งกลายเป็นรันคนละเวอร์ชันกับที่ทีมใช้อยู่โดยไม่มีใครรู้
  const spec = /\.spec\.js$/i.test(name);
  const cmd = spec ? path.join(cwd, 'node_modules', '.bin', 'playwright') : path.join(cwd, 'run-test.bat');
  const args = spec ? ['test', name] : [name];
  return {
    ok: true, system: src.label, test: name, cwd, kind: spec ? 'playwright' : 'appium',
    cmd, args,
    // ครอบ path ด้วยเครื่องหมายคำพูดเอง — node ครอบให้เฉพาะ args ไม่ครอบตัวคำสั่ง
    // โฟลเดอร์ที่มีช่องว่างในชื่อจะพังทันที (แอปนี้เองก็อยู่ใน "COWORK Desktop")
    line: `"${cmd}" ${args.join(' ')}`,
  };
}

// ทั้งชุด — คงลำดับเดิมไว้เสมอ ขั้นที่ประกอบคำสั่งไม่ได้ยังอยู่ในลิสต์ในฐานะขั้นที่ล้มเหลว
// ไม่ใช่หายไปเงียบ ๆ แล้วทำให้เข้าใจว่ารันครบ
function planRun(sources, items) {
  return (Array.isArray(items) ? items : []).map(it => planStep(sources, it && it.system, it && it.test));
}

module.exports = { SAFE_TEST_NAME, repoRootOf, planStep, planRun };
