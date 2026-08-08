const test = require('node:test');
const assert = require('node:assert');
const {
  parseConf, pairWithWindows, chooseInstance, findWindow, labelFor, countNodes, bsError,
} = require('../bluestacks.js');

// คัดมาจาก C:\ProgramData\BlueStacks_nxt\bluestacks.conf ของเครื่องจริง 2026-08-08
// บรรทัด status.adb_port มีอยู่จริงและเป็นกับดัก — regex ที่ไม่ anchor จะสร้าง instance ปลอม
const CONF = [
  'bst.instance.Tiramisu64.adb_port="5555"',
  'bst.instance.Tiramisu64.display_name="Prod"',
  'bst.instance.Tiramisu64.status.adb_port="5555"',
  'bst.instance.Tiramisu64_4.adb_port="5595"',
  'bst.instance.Tiramisu64_4.display_name="DEV"',
  'bst.instance.Tiramisu64_4.status.adb_port="5595"',
  'bst.feature.rooting="0"',
].join('\n');

test('parseConf: อ่าน conf จริงได้สอง instance เรียงตามชื่อ', () => {
  assert.deepStrictEqual(parseConf(CONF), [
    { key: 'Tiramisu64_4', name: 'DEV', adbPort: 5595 },
    { key: 'Tiramisu64', name: 'Prod', adbPort: 5555 },
  ]);
});

test('parseConf: บรรทัด status.adb_port ต้องไม่กลายเป็น instance ที่สาม', () => {
  assert.ok(!parseConf(CONF).some(i => i.key.includes('status')));
});

test('parseConf: instance ที่มีพอร์ตแต่ยังไม่ตั้งชื่อถูกข้าม (ชี้ให้ผู้ใช้เลือกไม่ได้)', () => {
  const r = parseConf('bst.instance.Nougat32.adb_port="5565"');
  assert.deepStrictEqual(r, []);
});

test('parseConf: ไฟล์ว่างหรือ null คืน array ว่าง ไม่โยน', () => {
  assert.deepStrictEqual(parseConf(''), []);
  assert.deepStrictEqual(parseConf(null), []);
});

test('pairWithWindows: instance ที่ไม่มีหน้าต่างเปิดอยู่ไม่เข้า ready', () => {
  const { ready } = pairWithWindows(parseConf(CONF), ['DEV', 'Visual Studio Code']);
  assert.deepStrictEqual(ready, [{ name: 'DEV', adbPort: 5595 }]);
});

test('pairWithWindows: ชื่อซ้ำเข้า duplicates และต้องไม่อยู่ใน ready — ห้ามเดา', () => {
  const { ready, duplicates } = pairWithWindows(parseConf(CONF), ['DEV', 'DEV', 'Prod']);
  assert.deepStrictEqual(duplicates, ['DEV']);
  assert.deepStrictEqual(ready, [{ name: 'Prod', adbPort: 5555 }]);
});

// ผู้ใช้ตั้ง display_name ซ้ำกันได้ใน BlueStacks (key ของ instance ต่างกัน แต่ชื่อที่โชว์เหมือนกัน)
const CONF_SAME_NAME = [
  'bst.instance.Pie64.adb_port="5555"',
  'bst.instance.Pie64.display_name="DEV"',
  'bst.instance.Pie64_1.adb_port="5565"',
  'bst.instance.Pie64_1.display_name="DEV"',
].join('\n');

test('pairWithWindows: ชื่อซ้ำใน conf ต้องเข้า duplicates แม้หน้าต่างจะเปิดอยู่บานเดียว', () => {
  const instances = parseConf(CONF_SAME_NAME);
  assert.strictEqual(instances.length, 2, 'conf นี้ต้องได้สอง instance ที่ key ต่างกันแต่ชื่อซ้ำ');
  const { ready, duplicates } = pairWithWindows(instances, ['DEV']);
  assert.deepStrictEqual(duplicates, ['DEV'],
    'ชื่อที่ซ้ำต้องถูกปฏิเสธที่นี่ที่เดียว เพราะตั้งแต่จุดนี้ไปทั้งเส้นทาง (ข้าม IPC ไปกลับ) '
    + 'ชี้เครื่องด้วย display_name อย่างเดียว ไม่มีใครเห็น key อีกเลย');
  assert.deepStrictEqual(ready, [],
    'ปล่อยผ่านเข้า ready = การ์ดทุกด่านผ่านหมดโดยมีหน้าต่างเปิดอยู่บานเดียว: XML ถูกถอดจากพอร์ต '
    + 'ของ instance ตัวแรก ส่วนรูป (ทางสำรอง desktopCapturer ตอนโดน FLAG_SECURE) จับจากหน้าต่าง '
    + 'ที่เปิดอยู่ซึ่งอาจเป็นอีกเครื่อง แล้วแนบเข้าตั๋วใบเดียวกันโดยไม่มีอะไรฟ้อง — คนอ่านตั๋วเห็น '
    + 'รูปกับโครงหน้าจอที่ขัดกันแต่เชื่อว่าเป็นหลักฐานชุดเดียวกัน');
});

test('chooseInstance: ตัวที่จำไว้ยังอยู่ ได้ตัวนั้น', () => {
  const ready = [{ name: 'DEV', adbPort: 5595 }, { name: 'Prod', adbPort: 5555 }];
  assert.strictEqual(chooseInstance(ready, 'Prod').name, 'Prod');
});

test('chooseInstance: ตัวที่จำไว้ถูกปิดไปแล้ว ต้องเด้งไปตัวแรกที่เหลือ ไม่ใช่ null', () => {
  const ready = [{ name: 'Prod', adbPort: 5555 }];
  assert.strictEqual(chooseInstance(ready, 'DEV').name, 'Prod');
});

test('chooseInstance: ไม่มีเครื่องเหลือเลยคืน null', () => {
  assert.strictEqual(chooseInstance([], 'DEV'), null);
});

test('findWindow: เจอบานเดียวได้ index กับ count 1', () => {
  assert.deepStrictEqual(findWindow(['Code', 'DEV', 'Prod'], 'DEV'), { index: 1, count: 1 });
});

test('findWindow: เจอสองบานคืน count 2 (ผู้เรียกต้องไม่แคป)', () => {
  assert.strictEqual(findWindow(['DEV', 'DEV'], 'DEV').count, 2);
});

test('findWindow: ไม่เจอคืน index -1', () => {
  assert.deepStrictEqual(findWindow(['Code'], 'DEV'), { index: -1, count: 0 });
});

// dump จริงของ Zinga (Flutter): text="" ว่างทุก node ข้อความอยู่ใน content-desc
test('labelFor: text ว่างทุกตัว ต้องหยิบ content-desc ตัวแรกมาเป็นคำใบ้', () => {
  const xml = '<hierarchy><node text="" content-desc="" /><node text="" content-desc="Login" /></hierarchy>';
  assert.strictEqual(labelFor('DEV', xml), 'DEV · Login');
});

test('labelFor: ข้อความยาวเกิน 30 อักษรถูกตัด', () => {
  const long = 'x'.repeat(45);
  assert.strictEqual(labelFor('DEV', `<node text="${long}" />`), 'DEV · ' + 'x'.repeat(30) + '…');
});

test('labelFor: ไม่มีข้อความเลยคืนชื่อเครื่องเปล่า ๆ', () => {
  assert.strictEqual(labelFor('DEV', '<hierarchy><node text="" /></hierarchy>'), 'DEV');
});

test('labelFor: เครื่องหมายคำพูดใน dump มาเป็น &quot; อยู่แล้ว ต้องไม่ทำให้ regex หลุด', () => {
  const xml = '<node content-desc="ปุ่ม &quot;ตกลง&quot;" />';
  assert.strictEqual(labelFor('DEV', xml), 'DEV · ปุ่ม &quot;ตกลง&quot;');
});

test('countNodes: นับแท็กเปิด <node ไม่นับ <hierarchy> และไม่นับแท็กปิดซ้ำ', () => {
  const xml = '<hierarchy><node a="1"><node b="2" /></node><node c="3" /></hierarchy>';
  assert.strictEqual(countNodes(xml), 3);
});

test('countNodes: XML ว่างคืน 0 ไม่โยน', () => {
  assert.strictEqual(countNodes(''), 0);
});

test('bsError: ทุก code ที่เส้นทางนี้ใช้ต้องมีข้อความไทย ไม่หลุดเป็นค่า fallback', () => {
  const codes = ['no-conf', 'no-window', 'duplicate-window', 'no-adb', 'connect-failed',
    'dump-failed', 'empty-dump', 'timeout', 'gone', 'busy', 'unexpected'];
  for (const c of codes) {
    const msg = bsError(c, 'x');
    assert.ok(msg && !msg.includes('ไม่รู้จัก'), `${c} ยังไม่มีข้อความ`);
  }
});

test('bsError: code แปลกปลอมไม่โยน แต่บอกให้รู้ว่าไม่รู้จัก', () => {
  assert.ok(bsError('ไม่มีจริง').includes('ไม่รู้จัก'));
});

test('bsError: ข้อความชื่อซ้ำต้องมีชื่อเครื่องอยู่ในนั้น ผู้ใช้จะได้รู้ว่าต้องเปลี่ยนชื่อตัวไหน', () => {
  assert.ok(bsError('duplicate-window', 'DEV').includes('DEV'));
});
