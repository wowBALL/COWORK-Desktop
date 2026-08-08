// ยิงเส้นทาง BlueStacks ของจริงผ่าน Electron — ส่วนที่ node --test แตะไม่ถึง
// (adb ตัวจริง + desktopCapturer ตัวจริง) เฟส 1 มีเทสเขียว 724 ตัวขณะที่โค้ดฉีดทำงานผิด
// จับได้ตอนยิงผ่าน Electron เท่านั้น เส้นทางนี้จึงต้องมีของพิสูจน์แบบเดียวกัน
//
// รัน: npx electron tools/probe-bluestacks.js
// ต้องเปิด BlueStacks อย่างน้อยหนึ่ง instance ก่อน ถ้าอยากเห็นทาง fallback ให้เปิดแอปที่ตั้ง
// FLAG_SECURE (เช่น Zinga) ค้างไว้บน instance นั้น
//
// ทำตามลำดับจริงของ ipcMain.handle('bs-grab', ...) ใน main.js เป๊ะ ไม่ใช่ทำเวอร์ชันย่อของตัวเอง —
// ถ้าลำดับต่างกัน probe อาจเขียวทั้งที่ทางที่ผู้ใช้กดจริงพัง (เหตุผลเดียวกับที่ต้องมีสคริปต์นี้)
const { app, desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { parseConf, pairWithWindows, findWindow, labelFor, countNodes } = require('../bluestacks.js');
// ตัวเดียวกับที่ main.js ใช้ — ถ้าก๊อปมาไว้ที่นี่ สคริปต์นี้จะพิสูจน์คนละโค้ดกับที่แอปรันจริง
const { adb } = require('../bluestacks-adb.js');

const BS_CONF = 'C:/ProgramData/BlueStacks_nxt/bluestacks.conf';

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const conf = parseConf(fs.readFileSync(BS_CONF, 'utf8'));
  console.log('RESULT conf:', conf.map(i => `${i.name}=${i.adbPort}`).join(' · ') || '(ว่าง)');

  const t0 = Date.now();
  const names = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })).map(s => s.name);
  console.log(`RESULT นับหน้าต่าง ${names.length} บาน ใน ${Date.now() - t0} ms`);

  const { ready, duplicates } = pairWithWindows(conf, names);
  console.log('RESULT จับคู่ได้:', ready.map(i => `${i.name}→${i.adbPort}`).join(' · ') || '(ไม่มี)',
    '· ชื่อซ้ำ:', duplicates.join(',') || '(ไม่มี)');
  if (!ready.length) { console.log('RESULT หยุด — ไม่มีเครื่องให้ทดสอบ เปิด BlueStacks ก่อน'); return app.exit(1); }

  for (const inst of ready) {
    const serial = `127.0.0.1:${inst.adbPort}`;
    const conn = await adb(['connect', serial], 5);
    console.log(`RESULT ${inst.name} connect exit=${conn.code} ${conn.stdout.toString().trim()}`);
    // main.js คืน error ทันทีถ้า connect ไม่ผ่าน ไม่ลองยิงต่อ — probe เดินตามเพื่อไม่ให้เห็น
    // dump/pull ล้มเหลวซ้อนกันจนอ่านสาเหตุจริงไม่ออก
    if (conn.code !== 0) { console.log(`RESULT ${inst.name} ข้าม — connect ไม่ผ่าน`); continue; }

    // ชื่อไฟล์ไม่ซ้ำต่อรอบ (pid + เวลา) เหมือน main.js เป๊ะ — ชื่อคงที่ทำให้ไฟล์ค้างจากรอบก่อน
    // (ลบไม่สำเร็จหรือลบไม่ทัน) กลายเป็นผลของรอบนี้แบบเงียบ ๆ
    const token = `${process.pid}-${Date.now().toString(36)}`;
    const devFile = `/sdcard/cowork-ui-${token}.xml`;
    // ใช้ app.getPath('temp') ตัวเดียวกับที่ main.js ใช้ ไม่ใช่ os.tmpdir() — โฟลเดอร์ temp ที่
    // Electron คืนมาไม่ได้การันตีว่าตรงกับของ Node เป๊ะทุกเครื่อง
    const hostFile = path.join(app.getPath('temp'), `cowork-ui-${token}.xml`);

    const tD = Date.now();
    const dump = await adb(['-s', serial, 'shell', 'uiautomator', 'dump', devFile], 30);
    const dumpOut = dump.stdout.toString().trim();
    // ตัดสินด้วย exit code อย่างเดียว เหมือน main.js — ไม่เช็คถ้อยคำ "dumped to:" เพราะสำนวนที่
    // uiautomator พิมพ์ตอนสำเร็จต่างกันไปตามรุ่น/locale ของแต่ละอิมเมจ Android
    if (dump.code !== 0) {
      console.log(`RESULT ${inst.name} dump exit=${dump.code} ล้มเหลว: ${dump.stderr || dumpOut || '(ไม่มีข้อความ)'}`);
      continue;
    }

    let xml = '';
    try {
      const pull = await adb(['-s', serial, 'pull', devFile, hostFile], 15);
      if (pull.code !== 0) {
        console.log(`RESULT ${inst.name} pull exit=${pull.code} ล้มเหลว: ${pull.stderr || dumpOut || '(ไม่มีข้อความ)'}`);
      } else {
        // adb รุ่นเก่าบางตัวคืน exit 0 ทั้งที่ pull ไม่ได้ไฟล์จริง — กันด้วย try แล้วปล่อย xml ว่าง
        try { xml = fs.readFileSync(hostFile, 'utf8'); } catch {}
      }
    } finally {
      // เก็บกวาดทุกทางออกรวมทั้งทางที่ throw เหมือน main.js — ลบฝั่งเครื่องแบบ fire-and-forget
      // เพราะชื่อไม่ซ้ำอยู่แล้ว ไม่กระทบรอบถัดไปแม้ลบไม่ทัน
      adb(['-s', serial, 'shell', 'rm', '-f', devFile], 10).catch(() => {});
      try { fs.unlinkSync(hostFile); } catch {}
    }
    console.log(`RESULT ${inst.name} dump exit=${dump.code} ${countNodes(xml)} nodes `
      + `${Math.round(xml.length / 1024)} KB ใน ${Date.now() - tD} ms · ชื่อชิป "${labelFor(inst.name, xml)}"`);

    const tS = Date.now();
    const shot = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], 15);
    const viaAdb = shot.code === 0 && shot.stdout.length > 0;
    console.log(`RESULT ${inst.name} screencap ${shot.stdout.length} bytes ใน ${Date.now() - tS} ms `
      + `→ ${viaAdb ? 'ใช้ทางหลัก' : 'ตกไปทางสำรอง (FLAG_SECURE)'}`);

    if (!viaAdb) {
      const tW = Date.now();
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 2000 } });
      const { index, count } = findWindow(sources.map(s => s.name), inst.name);
      if (index < 0 || count !== 1) { console.log(`RESULT ${inst.name} ทางสำรองไม่แคป (index=${index} count=${count})`); continue; }
      const sz = sources[index].thumbnail.getSize();
      const png = sources[index].thumbnail.toPNG();
      const out = path.join(app.getPath('temp'), `cowork-probe-${inst.name}.png`);
      fs.writeFileSync(out, png);
      console.log(`RESULT ${inst.name} ทางสำรอง ${sz.width}x${sz.height} ${png.length} bytes `
        + `ใน ${Date.now() - tW} ms → ${out}  (เปิดดูว่าเป็นจอของเครื่องนี้จริงไหม)`);
    }
  }
  app.exit(0);
});
