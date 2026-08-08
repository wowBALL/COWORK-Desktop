// ตัวเรียก adb ตัวเดียวของทั้งโปรเจกต์ — main.js กับ tools/probe-bluestacks.js require ตัวนี้
// ทั้งคู่ ถ้าก๊อปไปไว้สองที่ สคริปต์ probe จะพิสูจน์คนละโค้ดกับที่แอปรันจริง
// ไม่ require electron จึงรันได้ทั้งใน main process และใน node เปล่า ๆ
const { spawn } = require('node:child_process');
const { bsError } = require('./bluestacks.js');

// spawn พร้อม array ของ argument ไม่ผ่าน shell — ชื่อ instance กับพอร์ตจึงไม่มีทางกลายเป็นคำสั่ง
// คืน stdout เป็น Buffer เพราะ screencap ส่ง PNG ดิบมาทาง exec-out ไม่ใช่ข้อความ
function adb(args, timeoutSec) {
  return new Promise((resolve, reject) => {
    const p = spawn('adb', args, { windowsHide: true });
    const out = [], err = [];
    let done = false;
    const finish = fn => (...a) => { if (done) return; done = true; clearTimeout(timer); fn(...a); };
    // adb ที่ค้าง (เช่น emulator กำลังบูต) ต้องกลายเป็นข้อความ error ไม่ใช่ปุ่มที่หมุนตลอดกาล
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      p.kill();
      reject(new Error(bsError('timeout', timeoutSec)));
    }, timeoutSec * 1000);
    p.on('error', finish(e => reject(new Error(e.code === 'ENOENT' ? bsError('no-adb') : e.message))));
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('close', finish(code => resolve({
      code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString().trim(),
    })));
  });
}

module.exports = { adb };
