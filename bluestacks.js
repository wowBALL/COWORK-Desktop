// ตรรกะฝั่ง BlueStacks ที่ "ตัดสินใจ" ทั้งหมด — ไม่อ่านไฟล์ ไม่ spawn ไม่ require electron
// เหตุผลเดียวกับที่เฟส 1 แยก treeToXml ออกจาก collectTree: การจับคู่ผิดคู่ทำให้ได้ XML ของ
// เครื่องหนึ่งกับรูปของอีกเครื่องหนึ่งโดยไม่มีอะไรฟ้อง ต้องเทสได้โดยไม่ต้องเปิด BlueStacks สองตัว

// bluestacks.conf มีบรรทัด bst.instance.Tiramisu64.status.adb_port="5555" ปนอยู่ด้วย
// regex ที่เขียนหลวมเป็น (.+) จะได้ instance ปลอมชื่อ "Tiramisu64.status" ⇒ ต้องเป็น [^.]+
const RE_PORT = /^bst\.instance\.([^.]+)\.adb_port="(\d+)"$/;
const RE_NAME = /^bst\.instance\.([^.]+)\.display_name="([^"]*)"$/;
const LABEL_MAX = 30;

function parseConf(text) {
  const ports = new Map();
  const names = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const p = RE_PORT.exec(line);
    if (p) { ports.set(p[1], Number(p[2])); continue; }
    const n = RE_NAME.exec(line);
    if (n) names.set(n[1], n[2]);
  }
  const out = [];
  for (const [key, adbPort] of ports) {
    const name = names.get(key);
    if (!name) continue;   // instance ที่ยังไม่ตั้งชื่อ ผู้ใช้ชี้ไม่ถูกอยู่ดี
    out.push({ key, name, adbPort });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ready = เครื่องที่เลือกได้จริง (มีหน้าต่างเปิดอยู่ และชื่อไม่ซ้ำ ทั้งฝั่งหน้าต่างและฝั่ง conf)
// ชื่อซ้ำต้องไม่ตกอยู่ใน ready เพราะการเดาว่าเป็นบานไหนแล้วเดาผิด = หลักฐานผิดเครื่องแบบเงียบ ๆ
//
// ต้องนับ display_name ที่ซ้ำกันใน conf ด้วย ไม่ใช่นับแต่ชื่อหน้าต่าง — ฟังก์ชันนี้ทิ้ง key ของ
// instance ไป ตั้งแต่บรรทัดนี้ไปทั้งเส้นทาง (ข้าม IPC ไปกลับจนถึงตอนเลือกพอร์ต) จึงชี้เครื่องด้วย
// ชื่ออย่างเดียว สอง instance ที่ตั้งชื่อเหมือนกันจะถูกยุบเหลือตัวแรกโดยไม่มีอะไรฟ้อง · เคสที่ร้าย
// ที่สุดคือมีหน้าต่างเปิดอยู่บานเดียว: การ์ดทุกด่านผ่านหมด XML มาจากพอร์ตของตัวแรก ส่วนรูป (ทาง
// สำรอง desktopCapturer ตอนโดน FLAG_SECURE) จับจากหน้าต่างที่เปิดอยู่ซึ่งอาจเป็นอีกเครื่อง
function pairWithWindows(instances, windowNames) {
  const count = new Map();
  for (const n of windowNames || []) count.set(n, (count.get(n) || 0) + 1);
  const confCount = new Map();
  for (const inst of instances || []) confCount.set(inst.name, (confCount.get(inst.name) || 0) + 1);
  const ready = [];
  const duplicates = [];
  for (const inst of instances || []) {
    const c = count.get(inst.name) || 0;
    if (c === 0) continue;
    if (c > 1 || (confCount.get(inst.name) || 0) > 1) {
      // ชื่อซ้ำใน conf เดินลูปถึงสองรอบ ถ้าไม่กันจะได้ชื่อเดิมสองครั้งในลิสต์เดียว
      if (!duplicates.includes(inst.name)) duplicates.push(inst.name);
      continue;
    }
    ready.push({ name: inst.name, adbPort: inst.adbPort });
  }
  return { ready, duplicates };
}

// เครื่องที่จำไว้ถูกปิดไปแล้วเป็นเรื่องปกติของการทำงาน (ปิดตัวเก่าเปิดตัวใหม่ระหว่างวัน)
// ไม่ใช่ error ⇒ เด้งไปตัวแรกที่เหลือ ไม่ใช่คืน null แล้วให้ปุ่มกลายเป็นปุ่มตาย
function chooseInstance(ready, remembered) {
  const list = ready || [];
  if (!list.length) return null;
  return list.find(i => i.name === remembered) || list[0];
}

function findWindow(windowNames, instanceName) {
  const names = windowNames || [];
  let index = -1;
  let count = 0;
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== instanceName) continue;
    count += 1;
    if (index === -1) index = i;
  }
  return { index, count };
}

// ชื่อชิปต้องบอกได้ว่าเป็นหน้าจอไหนโดยไม่ยิง adb เพิ่ม จึงดึงจากตัว XML เอง
// อ่านทั้ง text และ content-desc ตามลำดับที่ปรากฏจริง เพราะแอป Flutter อย่าง Zinga มี text=""
// ว่างทุก node — ถ้าอ่านแต่ text จะได้ชื่อเครื่องเปล่า ๆ ทุกใบจนแยกชิปกันไม่ออก
function labelFor(instanceName, xml) {
  const re = /(?:text|content-desc)="([^"]+)"/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const v = m[1].trim();
    if (!v) continue;
    return `${instanceName} · ${v.length > LABEL_MAX ? v.slice(0, LABEL_MAX) + '…' : v}`;
  }
  return instanceName;
}

// ฝั่งเว็บนับ node ตอนเดิน DOM แต่ฝั่งนี้ได้ XML มาเป็นก้อนเดียว จึงนับจากแท็กเปิด
// \b กัน <nodes> สมมติ และไม่นับ </node> ซ้ำ · <hierarchy> ไม่ใช่ node จึงไม่ถูกนับอยู่แล้ว
function countNodes(xml) {
  const m = String(xml || '').match(/<node\b/g);
  return m ? m.length : 0;
}

// ข้อความที่ผู้ใช้เห็นทั้งเส้นทางอยู่ที่เดียว — กระจายใน main.js เมื่อไหร่ก็มีวันที่บางเคส
// หลุดเป็นภาษาอังกฤษดิบจาก adb ซึ่งผู้ใช้เอาไปทำอะไรต่อไม่ได้
const BS_ERRORS = {
  'no-conf': p => `ไม่พบไฟล์ตั้งค่าของ BlueStacks ที่ ${p} — รองรับเฉพาะ BlueStacks 5`,
  'no-window': () => 'ไม่พบหน้าต่าง BlueStacks — เปิด instance ที่ต้องการก่อนแล้วกดใหม่',
  'duplicate-window': n => `มีหน้าต่างชื่อ "${n}" มากกว่าหนึ่งบาน แยกไม่ออกว่ารูปมาจากเครื่องไหน `
    + 'ให้เปลี่ยนชื่อ instance ให้ต่างกันก่อน',
  'no-adb': () => 'ไม่พบคำสั่ง adb — ต้องมี Android platform-tools อยู่ใน PATH',
  'connect-failed': d => `ต่อ adb ไม่ได้: ${d}`,
  'dump-failed': d => `ถอดโครงหน้าจอไม่ได้: ${d}`,
  'empty-dump': () => 'ถอดโครงหน้าจอได้ไฟล์ว่าง — รอให้หน้าจอนิ่ง (ไม่มีอนิเมชัน) แล้วกดใหม่',
  'timeout': d => `adb ไม่ตอบภายใน ${d} วินาที`,
  'gone': n => `เครื่อง "${n}" ไม่ได้เปิดอยู่แล้ว — เลือกเครื่องใหม่จากเมนู`,
  // สองครั้งพร้อมกันบน adb เดียวได้ XML ของเครื่องหนึ่งคู่กับรูปของอีกเครื่อง ปุ่มฝั่ง renderer
  // กันได้แค่หน้าต่างเดียว จึงต้องมีข้อความให้ main process ตอบกลับตอนปฏิเสธด้วย
  'busy': () => 'กำลังเก็บจาก BlueStacks อยู่ — รอให้ครั้งก่อนเสร็จก่อนแล้วกดใหม่',
  // ตาข่ายรับข้อผิดพลาดที่ไม่ได้มาจาก bsError (desktopCapturer, fs, spawn EACCES) — ผู้ใช้ต้อง
  // ไม่เห็นภาษาอังกฤษดิบจาก libuv/Electron ส่วนข้อความจริงไปโผล่ที่ console ให้คนแก้โค้ดอ่าน
  'unexpected': () => 'เก็บจาก BlueStacks ไม่สำเร็จเพราะข้อผิดพลาดที่ไม่คาดคิด — '
    + 'ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลพร้อมเวลาที่กด',
};

function bsError(code, detail) {
  const f = BS_ERRORS[code];
  return f ? f(detail) : `เกิดข้อผิดพลาดที่ไม่รู้จัก (${code})`;
}

// Error ที่ข้อความเป็นไทยแล้ว ติดธง bsCode ไว้ให้ catch ปลายทางแยกออกว่าอันไหนส่งต่อให้ผู้ใช้ได้
// ใช้ธงแทนการเทียบข้อความ เพราะการเทียบข้อความจะพังเงียบ ๆ วันที่มีคนไปแก้คำใน BS_ERRORS
//
// ชื่อขึ้นต้นด้วย make ไม่ใช่ throw เพราะมัน "คืน" Error เฉย ๆ ผู้เรียกต้อง throw/reject เอง —
// ชื่อที่เป็นคำสั่งชวนให้เขียน bsThrow('busy'); ลอย ๆ เป็นทั้งประโยค ซึ่งคอมไพล์ผ่าน lint ผ่าน
// แล้วโค้ดวิ่งต่อเหมือนไม่มีอะไรเกิดขึ้น
function makeBsError(code, detail) {
  const e = new Error(bsError(code, detail));
  e.bsCode = code;
  return e;
}

module.exports = {
  parseConf, pairWithWindows, chooseInstance, findWindow, labelFor, countNodes, bsError, makeBsError,
};
