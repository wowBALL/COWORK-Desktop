const test = require('node:test');
const assert = require('node:assert');

// tab-grafana.js หยิบ esc จาก global.COWORK.util ตอนโหลด — ตั้งไว้ก่อน require
// (แบบเดียวกับ datefilter.test.js) ฟังก์ชันที่เทสในไฟล์นี้ไม่มีตัวไหนเรียก esc
globalThis.COWORK = { util: { esc: (v) => String(v), hashN: () => 0 } };
const {
  stripAnsi, guessLevel, normLevel, parseLine, isProbe, isSql, makeDrain, needleOf,
} = require('../tab-grafana.js');

const ESC = '';

// ===== ANSI =====
// Loki 2.6.1 ไม่มี `decolorize` (ต้อง 2.9+) การล้างสีจึงต้องเกิดฝั่ง renderer
test('stripAnsi ตัด escape sequence จริงออก แต่ไม่แตะข้อความในวงเล็บเหลี่ยม', () => {
  const gorm = `${ESC}[0m${ESC}[33m[0.723ms] ${ESC}[34;1m[rows:0]${ESC}[0m SELECT * FROM "x"`;
  assert.strictEqual(stripAnsi(gorm), '[0.723ms] [rows:0] SELECT * FROM "x"');
  // payment-gateway พ่น "[App]" ออกมาจริง — regex ที่ไม่ต้องมี ESC นำหน้าจะกินอันนี้ไปด้วย
  assert.strictEqual(stripAnsi('[2026-07-30T08:58:00.152Z] ERROR [App] boom'),
    '[2026-07-30T08:58:00.152Z] ERROR [App] boom');
  // ESC ที่ค้างอยู่เดี่ยว ๆ ต้องหายไปด้วย ไม่ปล่อยเป็นอักขระขยะบนจอ
  assert.strictEqual(stripAnsi(`a${ESC}b`), 'ab');
});

// ===== ระดับ =====
test('normLevel: FATAL/PANIC ยุบเป็น ERROR และ WARNING เป็น WARN', () => {
  assert.strictEqual(normLevel('FATAL', 'x'), 'ERROR');
  assert.strictEqual(normLevel('panic', 'x'), 'ERROR');
  assert.strictEqual(normLevel('WARNING', 'x'), 'WARN');
  assert.strictEqual(normLevel('info', 'x'), 'INFO');
});

test('normLevel: level "-" ของ GORM ต้องกลายเป็น SQL ไม่ใช่ระดับที่ไม่มีชิปรองรับ', () => {
  // menutable-api ส่ง {"level":"-"} มากับบรรทัด SQL จริง ปล่อยผ่านแล้วชิปจะนับไม่ครบ
  // (ผลรวมชิปย่อย 102 แต่ชิป "ทั้งหมด" 104) โดยไม่มีอะไรฟ้อง
  assert.strictEqual(normLevel('-', '/app/x.go:390 [10.3ms] [rows:0] SELECT "bookings"."id"'), 'SQL');
  assert.strictEqual(normLevel('', 'SELECT * FROM t'), 'SQL');
  assert.strictEqual(normLevel('?', 'INSERT INTO t VALUES (1)'), 'SQL');
});

test('normLevel: ERROR ที่บอกว่า upstream ตอบ 2xx แยกเป็นระดับ 2xx', () => {
  // Odoo ตอบ HTTP 200 พร้อม error body — 33,400 ครั้ง/7 วันบน mondev
  // ถ้ากองรวมใน ERROR ก้อนเดียว "ปลายทางตอบ OK แต่งานล้ม" จะมองไม่ออก
  assert.strictEqual(normLevel('ERROR', 'Error creating Odoo client: odoo error (code 200): Odoo Server Error'), '2xx');
  assert.strictEqual(normLevel('ERROR', 'upstream failed code=204'), '2xx');
  // 4xx/5xx ที่อยู่ในข้อความต้องไม่ถูกเหมาเป็น 2xx
  assert.strictEqual(normLevel('ERROR', 'odoo error (code 500)'), 'ERROR');
  assert.strictEqual(normLevel('ERROR', 'plain failure'), 'ERROR');
  // WARN ที่มี code 200 ต้องยังเป็น WARN — กฎนี้ใช้กับ ERROR เท่านั้น
  assert.strictEqual(normLevel('WARN', 'retrying, code 200'), 'WARN');
});

test('guessLevel เดาจากคำในบรรทัดเมื่อไม่มี field level', () => {
  assert.strictEqual(guessLevel('something Exception here'), 'ERROR');
  assert.strictEqual(guessLevel('WARN: disk almost full'), 'WARN');
  assert.strictEqual(guessLevel('API_METRIC: GET /api/live - 200 - 0.36ms'), 'INFO');
});

// ===== parseLine: 4 รูปแบบที่ mondev มีปนกันในสตรีมเดียว =====
test('parseLine: Echo access log กลายเป็นระดับตามชั้นของ status', () => {
  const mk = (status) => JSON.stringify({
    time: '2026-07-30T09:00:00Z', id: '', remote_ip: '1.2.3.4', host: 'h', method: 'GET',
    uri: '/api/x', user_agent: 'curl', status, error: '', latency: 1000, latency_human: '1ms',
  });
  assert.strictEqual(parseLine(mk(200)).level, 'HTTP');
  assert.strictEqual(parseLine(mk(304)).level, 'HTTP');
  assert.strictEqual(parseLine(mk(404)).level, '4xx');
  assert.strictEqual(parseLine(mk(500)).level, '5xx');
  const p = parseLine(mk(404));
  assert.strictEqual(p.kind, 'http');
  assert.strictEqual(p.msg, 'GET /api/x');
  assert.strictEqual(p.uri, '/api/x');
});

test('parseLine: app log JSON, GORM ที่มีสี, และข้อความเปล่า', () => {
  const app = parseLine('{"time":"t","level":"INFO","prefix":"schedule","file":"cron.go","line":"38","message":"Job done"}');
  assert.strictEqual(app.kind, 'app');
  assert.strictEqual(app.level, 'INFO');
  assert.strictEqual(app.msg, 'Job done');
  assert.match(app.where, /schedule/);

  const gorm = parseLine(`${ESC}[33m[0.7ms] ${ESC}[34;1m[rows:0]${ESC}[0m SELECT 1`);
  assert.strictEqual(gorm.level, 'SQL');
  assert.ok(!gorm.text.includes(ESC), 'ต้องไม่มี ESC ค้างใน text');

  const plain = parseLine('API_METRIC: GET /api/health - 200 - 0.35ms');
  assert.strictEqual(plain.kind, 'text');
  assert.strictEqual(plain.level, 'INFO');

  // JSON ที่พังต้องไม่โยน ต้องตกไปเป็นข้อความเปล่า
  const broken = parseLine('{"time": unterminated');
  assert.strictEqual(broken.kind, 'text');
});

// ===== noise =====
test('isProbe: non-2xx ห้ามถูกจัดเป็น noise เด็ดขาด', () => {
  // health probe ที่ตอบ 500 คือสัญญาณสำคัญที่สุด ไม่ใช่สิ่งรบกวน
  const probe = (status, ua, uri) => parseLine(JSON.stringify({
    time: 't', method: 'GET', uri, user_agent: ua, status, error: '',
  }));
  assert.strictEqual(isProbe(probe(200, 'kube-probe/1.31', '/api/healthz')), true);
  assert.strictEqual(isProbe(probe(500, 'kube-probe/1.31', '/api/healthz')), false);
  assert.strictEqual(isProbe(probe(404, 'kube-probe/1.31', '/api/healthz')), false);
});

test('isProbe: Go-http-client ไม่ใช่ UA ของ probe', () => {
  // เป็น UA เริ่มต้นของ Go ที่ webhook และ service-to-service ใช้ด้วย —
  // กฎเดิมที่เหมา UA นี้ทำให้ 500 ของ POST /api/order/webhook/complete หายไปทั้งบรรทัด
  const webhook = parseLine(JSON.stringify({
    time: 't', method: 'POST', uri: '/api/order/webhook/complete',
    user_agent: 'Go-http-client/2.0', status: 200, error: '',
  }));
  assert.strictEqual(isProbe(webhook), false);
  // แต่ Go-http-client ที่ยิง /metrics ยังนับเป็น probe เพราะเข้าเงื่อนไข path
  const metrics = parseLine(JSON.stringify({
    time: 't', method: 'GET', uri: '/metrics', user_agent: 'Go-http-client/2.0', status: 200, error: '',
  }));
  assert.strictEqual(isProbe(metrics), true);
});

test('isProbe: จับ health path ทุกแบบ และ API_METRIC ของ saas-ai-backend', () => {
  const at = (uri) => parseLine(JSON.stringify({ time: 't', method: 'GET', uri, user_agent: 'x', status: 200, error: '' }));
  for (const u of ['/healthz', '/api/health', '/live', '/readiness', '/metrics']) {
    assert.strictEqual(isProbe(at(u)), true, u + ' ควรเป็น probe');
  }
  assert.strictEqual(isProbe(at('/api/orders')), false);
  assert.strictEqual(isProbe(parseLine('API_METRIC: GET /api/health - 200 - 0.35ms')), true);
  assert.strictEqual(isProbe(parseLine('API_METRIC: GET /api/orders - 200 - 5ms')), false);
});

test('isSql จับทั้งจากระดับและจากรูปแบบบรรทัด', () => {
  assert.strictEqual(isSql(parseLine('SELECT * FROM t')), true);
  assert.strictEqual(isSql(parseLine('[1.2ms] [rows:3] anything')), true);
  assert.strictEqual(isSql(parseLine('{"level":"INFO","message":"hello"}')), false);
});

// ===== Drain =====
test('Drain รวมบรรทัดที่ต่างกันแค่ค่า และทำ token ที่เปลี่ยนเป็น wildcard', () => {
  const d = makeDrain();
  const a = d.add("ERROR [App] Failed to execute cron job 'payment_status_check': PrismaError");
  const b = d.add("ERROR [App] Failed to execute cron job 'health_check': PrismaError");
  assert.strictEqual(a.id, b.id, 'สองบรรทัดนี้ควรอยู่ cluster เดียวกัน');
  assert.match(d.tplOf(a), /<\*>/, 'ตำแหน่งที่ต่างกันต้องกลายเป็น wildcard');
  assert.strictEqual(a.n, 2);
});

test('Drain ไม่ทำบรรทัดหาย — ผลรวม n ของทุก cluster เท่าจำนวนที่ใส่เข้าไป', () => {
  const d = makeDrain();
  const lines = [
    'worker-payment-request[worker-aaa-1] processing',
    'worker-payment-request[worker-bbb-2] processing',
    'Error creating Odoo client: odoo error (code 200): boom',
    'Error authenticating Odoo client: odoo error (code 200): boom',
    'prisma:error',
    'prisma:error',
    'totally different message shape here with many more tokens than the rest',
  ];
  lines.forEach((l) => d.add(l));
  const sum = d.clusters.reduce((acc, c) => acc + c.n, 0);
  assert.strictEqual(sum, lines.length);
  assert.ok(d.clusters.length >= 2 && d.clusters.length < lines.length,
    'ควรรวมได้บ้าง แต่ไม่ยุบทุกอย่างเป็นก้อนเดียว');
});

test('Drain แต่ละตัวเป็นอิสระ — ข้อมูลชุดใหม่ต้องได้ต้นไม้ใหม่', () => {
  // ถ้าใช้ตัวเดียวตลอดอายุแอป template จะค่อย ๆ กว้างขึ้นจนรวมของที่ไม่ควรรวม
  // และ id จะโตไม่หยุดทุกครั้งที่ refresh
  const d1 = makeDrain(); d1.add('hello world one');
  const d2 = makeDrain();
  assert.strictEqual(d2.clusters.length, 0);
  assert.strictEqual(d2.add('hello world two').id, 0);
});

// ===== needle =====
test('needleOf คืนข้อความที่มีอยู่จริงในบรรทัด เพื่อใช้เป็น line filter ของ Loki', () => {
  const p = parseLine('{"level":"ERROR","message":"Error creating Odoo client: odoo error (code 200): boom 12345"}');
  const n = needleOf(p);
  assert.ok(n && n.length >= 8, 'ต้องได้ needle ที่ยาวพอ');
  assert.ok(p.msg.includes(n), 'needle ต้องเป็น substring ของข้อความจริง ไม่งั้น |= จะหาไม่เจอ');
  assert.ok(!/\d{3,}/.test(n), 'needle ไม่ควรมีเลขที่เปลี่ยนไปเรื่อย ๆ');
});

test('needleOf ของ access log ใช้ path โดยตัด query string ทิ้ง', () => {
  const p = parseLine(JSON.stringify({
    time: 't', method: 'GET', uri: '/api/auth/token?level=basic&x=1', user_agent: 'x', status: 500, error: '',
  }));
  assert.strictEqual(needleOf(p), '/api/auth/token');
});

test('needleOf คืน null เมื่อไม่มีชิ้นคงที่ที่ยาวพอ ไม่ใช่สตริงว่าง', () => {
  // สตริงว่างจะกลายเป็น line filter ที่แมตช์ทุกบรรทัด ทำให้ประวัติของปัญหานั้นผิดทั้งหมด
  assert.strictEqual(needleOf(parseLine('12345 6789')), null);
});
