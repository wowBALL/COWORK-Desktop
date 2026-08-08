// ตัวเรียก adb ตัวเดียวของทั้งโปรเจกต์ — main.js กับ tools/probe-bluestacks.js require ตัวนี้
// ทั้งคู่ ถ้าก๊อปไปไว้สองที่ สคริปต์ probe จะพิสูจน์คนละโค้ดกับที่แอปรันจริง
// ไม่ require electron จึงรันได้ทั้งใน main process และใน node เปล่า ๆ
const { spawn } = require('node:child_process');
const { makeBsError } = require('./bluestacks.js');

const DEFAULT_TIMEOUT_SEC = 30;

// spawn พร้อม array ของ argument ไม่ผ่าน shell — ชื่อ instance กับพอร์ตจึงไม่มีทางกลายเป็นคำสั่ง
// คืน stdout เป็น Buffer เพราะ screencap ส่ง PNG ดิบมาทาง exec-out ไม่ใช่ข้อความ
function adb(args, timeoutSec) {
  // ไฟล์นี้เป็น export ที่สคริปต์ probe เรียกด้วย ผู้เรียกลืมใส่ timeout เมื่อไหร่จะได้
  // setTimeout(fn, NaN) ที่ยิงทันทีแล้วบอกผู้ใช้ว่า "adb ไม่ตอบภายใน undefined วินาที"
  const secs = Number(timeoutSec) > 0 ? Number(timeoutSec) : DEFAULT_TIMEOUT_SEC;
  return new Promise((resolve, reject) => {
    const p = spawn('adb', args, { windowsHide: true });
    const out = [], err = [];
    let done = false;
    const finish = fn => (...a) => { if (done) return; done = true; clearTimeout(timer); fn(...a); };
    // adb ที่ค้าง (เช่น emulator กำลังบูต) ต้องกลายเป็นข้อความ error ไม่ใช่ปุ่มที่หมุนตลอดกาล
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      // ปลด listener กับล้าง buffer ก่อนฆ่า — ถ้าฆ่าไม่ลง โพรเซสที่ยังวิ่งจะดันข้อมูลเข้า array
      // ที่ไม่มีใครอ่านแล้วไปเรื่อย ๆ (screencap ส่ง PNG ทั้งใบ ไม่ใช่ไม่กี่ไบต์)
      p.stdout.removeAllListeners('data');
      p.stderr.removeAllListeners('data');
      out.length = 0;
      err.length = 0;
      // แอปนี้รันบน Windows เท่านั้น (ดู config path C:/ProgramData/... ของ BlueStacks) — บน
      // Windows Node ไม่สนใจชื่อ signal เลย ยิง TerminateProcess ให้ทั้ง SIGTERM และ SIGKILL
      // เหมือนกัน แค่ p.kill() เฉย ๆ จึงพอแล้ว ไม่ต้องมีตัวไล่ฆ่าซ้ำรอบสอง
      try { p.kill(); } catch { /* ตายไปก่อนแล้วก็ถือว่าจบ */ }
      reject(makeBsError('timeout', secs));
    }, secs * 1000);
    p.on('error', finish(e => reject(e.code === 'ENOENT' ? makeBsError('no-adb') : e)));
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('close', finish(code => resolve({
      code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString().trim(),
    })));
  });
}

module.exports = { adb };
