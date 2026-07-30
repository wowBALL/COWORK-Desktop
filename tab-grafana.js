// แท็บ Grafana — ดู log จาก Loki หลัง Grafana ที่ตั้งค่าไว้ (Dev / Prod)
//
// แท็บนี้ "ดึงเอง" ต่างจากอีกสี่แท็บที่ main เป็นคน push ให้ เพราะ query ขึ้นอยู่กับตัวกรอง
// ที่ผู้ใช้กำลังขยับ (ช่วงเวลา, กลุ่ม app, คำค้น) main จะเดาแทนไม่ได้
// token ไม่เคยเข้ามาถึงฝั่งนี้ — main คืนมาแค่ว่ามีหรือยัง กับสี่ตัวท้าย
//
// การแบ่งหน้าที่ระหว่าง server กับ renderer เป็นเรื่องที่วัดมาแล้ว ไม่ใช่ความชอบ:
//   ฝั่ง Loki : ช่วงเวลา, โหมด (เฉพาะปัญหา/ทุกบรรทัด), คำค้น
//   ฝั่งนี้   : ระดับ, กลุ่ม app, สวิตช์ลดสิ่งรบกวน, การรวมกลุ่ม, การนับเลขบนชิป
// เลขบนชิปต้องบรรยาย "ชุดที่ดึงมาแล้ว" และแถบ "ผลถูกซ่อน" จะมีได้ก็ต่อเมื่อบรรทัดที่ถูกซ่อน
// ถูกดึงมาจริง ถ้าดันสองอย่างนี้ลงไปฝั่ง Loki ทั้งคู่จะโกหก
//
// ตัวเลขที่วัดจาก mondev (24 ชม.): ทั้งหมด 651,676 บรรทัด · ตัด probe+SQL แล้วยังเหลือ
// 454,793 (payment-worker ตัวเดียว 259,228) · เหลือ 19,159 เมื่อเอาแต่บรรทัดที่เป็นปัญหา
// จึงต้องมีสองโหมด: โหมดปัญหาครอบทั้งช่วงได้จริง โหมดทุกบรรทัดครอบได้ ~15 นาทีเท่านั้น
// และต้องเขียนกำกับให้ชัด ไม่ใช่ปล่อยให้ชิป "24h" สื่อว่าเห็นทั้งวัน
//
// CSS อยู่ใน tab-grafana.css
(function (global) {
  'use strict';
  const { esc } = global.COWORK.util;
  const shell = () => global.COWORK.shell;   // เปลือกสร้างทีหลังไฟล์นี้ ต้องหยิบตอนเรียกใช้

  // ---- ตัวแปลบรรทัด log -------------------------------------------------------
  // mondev มี 4 รูปแบบปนกันในสตรีมเดียว:
  //   1) Echo access log (JSON) {time,method,uri,status,latency,error,…}  ← ส่วนใหญ่
  //   2) Echo app log   (JSON) {time,level,prefix,file,line,message}
  //   3) Go/GORM ที่มี ANSI escape จริง + บรรทัดถัดไปเป็น path:line
  //   4) ข้อความเปล่า เช่น "API_METRIC: GET /api/live - 200 - 0.36ms"
  // Loki 2.6.1 ไม่มี `decolorize` (ต้อง 2.9+) ANSI จึงต้องล้างที่นี่ ไม่ใช่ฝั่งเซิร์ฟเวอร์
  //
  // ต้องมี ESC (\x1b) นำหน้าจริง ๆ ถ้าจับแค่ "[33m" จะไม่ได้ลบ ESC ที่ค้าง และเสี่ยงกิน
  // ข้อความปกติที่มีวงเล็บเหลี่ยม เช่น "[App]" ของ payment-gateway
  const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
  const stripAnsi = (s) => String(s).replace(ANSI, '').replace(/\x1b/g, '');

  const KNOWN_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
  function guessLevel(text) {
    return /\b(FATAL|PANIC)\b/i.test(text) ? 'ERROR'
      : /\b(ERROR|ERR)\b|Exception|Traceback/i.test(text) ? 'ERROR'
      : /\bWARN(ING)?\b/i.test(text) ? 'WARN'
      : /\bDEBUG\b/i.test(text) ? 'DEBUG' : 'INFO';
  }
  // "Error 2xx" มีจริงในข้อมูลนี้ แต่ไม่ได้อยู่ในสถานะ HTTP: access log ที่ status 2xx
  // แล้ว field error ไม่ว่างมี 0 บรรทัดใน 7 วัน ที่มีคือ app log ระดับ ERROR ที่ข้างในบอกว่า
  // upstream ตอบ code 200 — Odoo ตอบ HTTP 200 พร้อม error body 33,400 ครั้ง/7 วัน
  // ถ้ากองรวมใน ERROR ก้อนเดียว "ปลายทางตอบ OK แต่งานล้ม" จะมองไม่ออกเลย
  const UPSTREAM_2XX = /\bcode[\s=:(]*2\d\d\b/i;
  function normLevel(raw, text) {
    let v = String(raw || '').trim().toUpperCase();
    if (v === 'WARNING') v = 'WARN';
    if (v === 'FATAL' || v === 'PANIC') v = 'ERROR';
    if (!KNOWN_LEVELS.includes(v)) {
      // menutable-api ส่ง {"level":"-"} มากับบรรทัด SQL ของ GORM — ปล่อยค่าดิบผ่านไป
      // จะได้ระดับที่ไม่มีชิปรองรับ = ตัวกรองล่องหน (บรรทัดหายจากแถวโดยไม่มีอะไรฟ้อง)
      if (/\[rows:\d+\]/.test(text) ||
          /^\s*(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i.test(text)) return 'SQL';
      v = guessLevel(text);
    }
    if (v === 'ERROR' && UPSTREAM_2XX.test(text)) return '2xx';
    return v;
  }

  function parseLine(raw) {
    const text = stripAnsi(raw).replace(/\s+$/, '');
    let o = null;
    if (text.startsWith('{')) { try { o = JSON.parse(text); } catch { /* ไม่ใช่ JSON */ } }

    if (o && o.method && o.uri) {                       // (1) HTTP access
      const st = Number(o.status) || 0;
      // 5xx / 4xx / 2xx เป็นระดับของตัวเอง ไม่ยุบเป็น ERROR/WARN ไม่งั้นไปปนกับ error
      // ของแอปแล้วแยกไม่ออกว่าพังฝั่งไหน ในข้อมูลจริงคนละเรื่องกันสิ้นเชิง:
      // 5xx = โค้ดเราพัง · 4xx เกือบทั้งหมดเป็นบอตสแกนช่องโหว่ยิง ms-airalo
      return {
        kind: 'http', level: st >= 500 ? '5xx' : st >= 400 ? '4xx' : 'HTTP', status: st,
        msg: `${o.method} ${o.uri}`, uri: String(o.uri || ''),
        latency: o.latency_human || '', ua: o.user_agent || '', ip: o.remote_ip || '',
        err: o.error || '', json: o, text,
      };
    }
    if (o && (o.level || o.message)) {                  // (2) app log
      return {
        kind: 'app', level: normLevel(o.level, text), msg: String(o.message || text),
        where: [o.prefix, o.file && o.file + ':' + o.line].filter(Boolean).join(' · '),
        json: o, text,
      };
    }
    return {                                            // (3)(4) ข้อความเปล่า
      kind: 'text', level: normLevel('', text),
      msg: text.replace(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z?\]\s*/, '')
               .replace(/^\d{4}\/\d{2}\/\d{2}\s[\d:]+\s*/, '') || text,
      json: null, text,
    };
  }

  // health probe = สิ่งที่กลบทุกอย่าง: kube-probe ยิง /healthz ทุก 10 วิ ต่อ pod ต่อ app
  function isProbe(p) {
    // กฎเหล็ก: 4xx/5xx ห้ามถูกจัดเป็นสิ่งรบกวนเด็ดขาด — health probe ที่ตอบ 500
    // คือสัญญาณสำคัญที่สุด ไม่ใช่ noise (เคยพลาด: 500 ของ POST /api/order/webhook/complete
    // หายไปทั้งบรรทัดเพราะกฎ UA)
    if (p.kind === 'http' && p.status >= 400) return false;
    const healthPath = /\/(healthz|health|live|liveness|ready|readiness|metrics)\b/i.test(p.msg);
    if (p.kind === 'http') {
      // เชื่อ UA ได้แค่ kube-probe เพราะมันยิงแต่ health check เท่านั้น
      // ห้ามใส่ Go-http-client: เป็น UA เริ่มต้นของ Go ที่ webhook และ service-to-service ใช้ด้วย
      // Prometheus ไม่ต้องระบุ เพราะมันยิง /metrics ซึ่งเข้าเงื่อนไข path อยู่แล้ว
      return /kube-probe/i.test(p.ua) || healthPath;
    }
    return /^API_METRIC:.*\/(health|live|ready)\b/i.test(p.msg);
  }
  const isSql = (p) => p.level === 'SQL' ||
    /^\s*(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i.test(p.msg) ||
    /\[rows:\d+\]/.test(p.text);

  // ---- Drain: ให้มันเรียน template ของ log เอง --------------------------------
  // แทน regex ที่ต้องมาไล่แก้ทุกครั้งที่เจอรูปแบบใหม่ Drain เป็นอัลกอริทึมมาตรฐานของงานนี้
  // (ต้นไม้ความลึกคงที่ แยกกิ่งด้วยจำนวน token แล้วด้วย token ตัวแรก ๆ) — ตัวเดียวกับที่
  // Loki 3.x ใช้ทำ Log patterns ซึ่ง Loki 2.6.1 ของ mondev ยังไม่มี จึงต้องทำฝั่งนี้
  // ref: https://github.com/logpai/Drain3
  //
  // สร้างใหม่ทุกครั้งที่ได้ข้อมูลชุดใหม่ ไม่ใช่ตัวเดียวตลอดอายุแอป — ไม่งั้น template
  // จะค่อย ๆ กว้างขึ้นจนรวมของที่ไม่ควรรวม และ id ก็โตไม่หยุดทุกครั้งที่ refresh
  function makeDrain() {
    const DEPTH = 4, SIM = 0.5, MAX_CHILD = 100, WILD = '<*>';
    const root = new Map(), clusters = [];
    const toks = (msg) => msg
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, WILD)
      .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, WILD)
      .replace(/\b[0-9a-f]{12,}\b/gi, WILD)
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, WILD)
      .replace(/\b\d+(\.\d+)?(ms|s|µs|ns|MB|KB|B)?\b/g, WILD)
      .split(/\s+/).filter(Boolean);
    function sim(tpl, t) {
      let same = 0;
      for (let i = 0; i < tpl.length; i++) if (tpl[i] === t[i] || tpl[i] === WILD) same++;
      return tpl.length ? same / tpl.length : 0;
    }
    function add(msg) {
      const t = toks(msg);
      const len = Math.min(t.length, 60);
      let node = root.get(len);
      if (!node) { node = { kids: new Map(), leaf: [] }; root.set(len, node); }
      for (let d = 0; d < Math.min(DEPTH, t.length); d++) {
        let nx = node.kids.get(t[d]);
        if (!nx) {
          if (node.kids.size >= MAX_CHILD) {            // กิ่งเต็มแล้วยุบไปกิ่ง wildcard
            nx = node.kids.get(WILD);
            if (!nx) { nx = { kids: new Map(), leaf: [] }; node.kids.set(WILD, nx); }
          } else { nx = { kids: new Map(), leaf: [] }; node.kids.set(t[d], nx); }
        }
        node = nx;
      }
      let best = null, bs = -1;
      for (const c of node.leaf) {
        if (c.tpl.length !== t.length) continue;
        const s = sim(c.tpl, t);
        if (s > bs) { bs = s; best = c; }
      }
      if (best && bs >= SIM) {
        for (let i = 0; i < best.tpl.length; i++) if (best.tpl[i] !== t[i]) best.tpl[i] = WILD;
        best.n++; return best;
      }
      const c = { id: clusters.length, tpl: t.slice(), n: 1 };
      node.leaf.push(c); clusters.push(c);
      return c;
    }
    return { add, clusters, tplOf: (c) => c.tpl.join(' ') };
  }
  let DRAIN = makeDrain();

  // access log จัดกลุ่มด้วย endpoint + ชั้นสถานะ ไม่ผ่าน Drain —
  // "GET /api/a" กับ "GET /api/b" จะถูกยุบเป็น "GET <*>" ซึ่งผิด
  function signatureOf(app, p) {
    if (p.kind === 'http') {
      return app + ' ' + p.msg.replace(/\?.*$/, '')
        .replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, '/‹id›')
        .replace(/\/\d+(?=\/|$)/g, '/‹id›') + ' → ' + String(p.status)[0] + 'xx';
    }
    const c = DRAIN.add(p.msg);
    p.drain = c;
    return app + ' ' + p.level + ' drain#' + c.id;
  }

  // ---- สถานะ ------------------------------------------------------------------
  const GROUP_LABEL = { payment: 'Payment', menutable: 'Menutable', wallet: 'Wallet', other: 'อื่น ๆ' };
  // ตัด 7 วันออกตามที่ใช้จริง — ช่วงยาวกว่านี้ให้กรอกวันเวลาเองเป็นครั้ง ๆ ไป
  const RANGE_LABEL = [['15m', '15m'], ['30m', '30m'], ['1h', '1h'],
                       ['1d', '1 วัน'], ['2d', '2 วัน'], ['3d', '3 วัน']];
  const LV_ORDER = ['ERROR', '5xx', '4xx', '2xx', 'WARN', 'SQL', 'INFO', 'DEBUG', 'TRACE', 'HTTP'];
  const LV_HUE = {
    ERROR: 'var(--rose)', '5xx': 'var(--orange)', '4xx': 'var(--amber)', '2xx': 'var(--violet)',
    WARN: 'var(--amber)', SQL: 'var(--dim)', INFO: 'var(--cyan)',
    DEBUG: 'var(--dim)', TRACE: 'var(--dim)', HTTP: 'var(--green)',
  };
  const LV_LABEL = { ERROR: 'Error', '5xx': 'Error 5xx', '4xx': 'Error 4xx', '2xx': 'Error 2xx', HTTP: 'HTTP 2xx' };
  const LV_TIP = {
    ERROR: 'error ของแอปเอง ไม่ผ่าน HTTP',
    '5xx': 'HTTP 5xx — คำขอล้มที่ฝั่งเซิร์ฟเวอร์',
    '4xx': 'HTTP 4xx — คำขอไม่ถูกต้อง / ไม่มีสิทธิ์ / ไม่พบ',
    '2xx': 'upstream ตอบ 2xx แต่งานล้ม (เช่น Odoo ตอบ HTTP 200 พร้อม error body)',
    HTTP: 'คำขอที่สำเร็จ 2xx/3xx',
  };
  // Error 2xx อยู่ชั้นเดียวกับ ERROR/5xx — upstream ตอบ OK แต่งานล้ม ก็คือล้ม
  // ต้องเป็น "ชั้น" ไม่ใช่เรียงทีละระดับ ไม่งั้นของเรื้อรังที่เป็น ERROR จะทับของใหม่ที่เป็น 5xx
  // เสมอ ซึ่งทำให้ป้าย 🆕 ไร้ความหมาย
  const TIER = { ERROR: 0, '5xx': 0, '2xx': 0, WARN: 1, '4xx': 1, SQL: 2, INFO: 2, DEBUG: 3, TRACE: 3, HTTP: 3 };
  const OURS = new Set(['ERROR', '5xx', '2xx']);   // 4xx เป็นฝั่งผู้เรียก/บอตสแกน ไม่นับเป็นปัญหาเรา

  let APP_GROUPS = { payment: [], menutable: [], wallet: [], other: [] };
  let APP_GROUP = {};                       // app -> group
  let APP_ORDER = [];                       // ลำดับคงที่ ใช้เลือกสี
  const apIdx = (a) => { const i = APP_ORDER.indexOf(a); return (i < 0 ? 0 : i) % 8; };

  const sel = {
    env: 'dev', mode: 'issues', rangeKey: '1h',
    // ช่วงกำหนดเอง — เมื่อ custom เป็น true ค่า from/to (ms) ชนะ rangeKey
    custom: false, from: null, to: null,
    groups: new Set(), level: 'all', q: '',
    hideProbe: true, hideSql: true,
    view: 'g', limit: 60,
  };
  let data = null;          // ผลจาก grafana-query ล่าสุด
  let ALL = [];             // บรรทัดที่แปลแล้ว
  let loading = false, loadErr = null, notConfigured = false;
  let envAvail = { dev: false, prod: false };
  let overview = null;      // issueCounts / slowEndpoints / statusSeen
  // ตัวเลขจริงของทั้งช่วงจาก aggregation — ไม่ใช่นับจากบรรทัดที่ดึงมา
  // พอช่วงกว้าง บรรทัดที่ดึงมาเป็นกลุ่มตัวอย่างที่เอียงตามแอปที่ log ถี่สุด
  let summary = null, summaryKey = '';
  let HIST = [];            // ประวัติรายวันต่อปัญหา
  let histKey = '';         // กัน re-query ประวัติเดิมซ้ำ
  let pollTimer = null, reqSeq = 0;
  // คำขอที่ค้างอยู่เป็นการ poll เงียบหรือผู้ใช้สั่ง — ถ้าไม่แยก การกดชิป (ซึ่งกรองในเครื่อง)
  // ระหว่าง poll เงียบจะทำให้แถบ "กำลังค้นหา" โผล่ขึ้นมาทั้งที่ผู้ใช้ไม่ได้สั่งดึงอะไร
  let loadingSilent = false;

  const el = (id) => document.getElementById(id);
  const visible = () => { const v = el('grafanaView'); return v && !v.classList.contains('hidden'); };

  // ---- ตัวกรอง ----------------------------------------------------------------
  // หลายคำ = AND ทุกคำต้องเจอ · "ในอัญประกาศ" = ต้องติดกันเป๊ะ
  // อัญประกาศไม่ใช่ของแถม: การแยกคำด้วยเว้นวรรคทำให้ค้นวลีไม่ได้อีก มันคือทางเดียวที่จะเอากลับมา
  function qTerms() {
    const raw = sel.q.trim().toLowerCase();
    if (!raw) return [];
    const out = [], re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(raw))) {
      // อัญประกาศที่เปิดแล้วไม่ปิดจะตกมาทาง \S+ พร้อมตัว " ติดมา — ปัดออก ไม่งั้นพิมพ์
      // ค้างกลางทางแล้วผลกลายเป็น 0 แบบไม่มีเหตุผลให้ผู้ใช้เห็น
      const t = (m[1] !== undefined ? m[1] : m[2].replace(/"/g, '')).trim();
      if (t) out.push(t);
    }
    return out;
  }
  const qMatch = (x, terms) => (terms || qTerms()).every((t) => x.hay.includes(t));

  const EMPTY = new Set();
  // predicate เดียวที่ข้ามได้หลายมิติพร้อมกัน — ต้องเป็นชุดไม่ใช่ตัวเดียว เพราะแถบ
  // "ผลถูกซ่อน" ต้องถามทีละมิติว่า "ถ้าคลายมิตินี้มิติเดียว จะโผล่มากี่บรรทัด"
  function passes(x, skips) {
    const s = skips ? (skips instanceof Set ? skips : new Set([].concat(skips))) : EMPTY;
    return (s.has('group') || sel.groups.size === 0 || sel.groups.has(x.grp))
      && (s.has('level') || sel.level === 'all' || x.p.level === sel.level)
      && (s.has('probe') || !noiseOn() || !sel.hideProbe || !x.probe)
      && (s.has('sql') || !noiseOn() || !sel.hideSql || !x.sql)
      // คำค้นถูกส่งลงไปให้ Loki กรองแล้ว แต่ยังกรองซ้ำที่นี่ด้วย เพราะ Loki กรอง "บรรทัด"
      // ส่วนที่นี่ค้นถึง label (app/pod/container/namespace) ที่ไม่ได้อยู่ในตัวบรรทัด
      && (s.has('q') || qMatch(x));
  }
  // สวิตช์ลดสิ่งรบกวนมีความหมายแค่โหมด "ทุกบรรทัด" — โหมดปัญหา Loki ตัด
  // คำขอที่สำเร็จออกไปแล้วตั้งแต่ต้นทาง
  const noiseOn = () => sel.mode === 'all';
  const SKIP_OF = { group: ['group'], level: ['level'], noise: ['probe', 'sql'], q: ['q'] };
  const except = (row) => ALL.filter((x) => passes(x, SKIP_OF[row] || []));
  const view = () => ALL.filter((x) => passes(x));

  // ---- ตัวช่วยแสดงผล ---------------------------------------------------------
  const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);
  const p2 = (n) => String(n).padStart(2, '0');
  // ต้องมีวันที่ ไม่ใช่แค่เวลา — คำอธิบายเดิมพิมพ์ "08:42:53–18:45:50" สำหรับช่วงที่กิน
  // 24 ก.ค. ถึง 30 ก.ค. ซึ่งอ่านแล้วเข้าใจว่า 10 ชั่วโมง (ผมเองก็อ่านผลเทสตัวเองผิดแบบนี้)
  const dtText = (t) => { const d = new Date(t); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  // ช่วงสองปลาย: ใส่วันที่เมื่อคนละวัน ไม่ใส่เมื่อวันเดียวกัน (สั้นกว่าและไม่กำกวม)
  function spanText(fromIso, toIso) {
    const a = new Date(fromIso), b = new Date(toIso);
    const sameDay = a.toDateString() === b.toDateString();
    return sameDay
      ? `${p2(a.getDate())}/${p2(a.getMonth() + 1)} ${p2(a.getHours())}:${p2(a.getMinutes())}–${p2(b.getHours())}:${p2(b.getMinutes())}`
      : `${dtText(a)} → ${dtText(b)}`;
  }
  // ค่าสำหรับ <input type="datetime-local"> ต้องเป็นเวลาท้องถิ่น ไม่ใช่ ISO ที่เป็น UTC
  const dtLocal = (t) => { const d = new Date(t);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${Math.max(s, 0)} วิที่แล้ว`
      : s < 3600 ? `${Math.floor(s / 60)} นาทีที่แล้ว`
      : s < 86400 ? `${Math.floor(s / 3600)} ชม.ที่แล้ว` : `${Math.floor(s / 86400)} วันที่แล้ว`;
  }
  const nf = (n) => (n == null ? '—' : Number(n).toLocaleString('th-TH'));
  const ms = (v) => v == null ? '—'
    : v >= 10000 ? (v / 1000).toFixed(1) + ' s'
    : v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms';
  function prettyJson(o) {
    return esc(JSON.stringify(o, null, 2))
      .replace(/&quot;([^&]+)&quot;:/g, '<span class="k">"$1"</span>:')
      .replace(/: &quot;([^&]*)&quot;/g, ': <span class="s">"$1"</span>')
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="num">$1</span>');
  }
  // ช่วงห่างสม่ำเสมอ = cron/retry loop — พูดออกมาเลยว่า "ทุก ~1 นาที"
  function cadence(times) {
    if (times.length < 3) return '';
    const ts = [...times].sort((a, b) => a - b), gaps = [];
    for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
    const med = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (!med) return '';
    if (gaps.filter((g) => Math.abs(g - med) <= med * 0.25).length / gaps.length < 0.7) return '';
    const s = Math.round(med / 1000);
    return s < 90 ? `ทุก ~${s} วิ` : `ทุก ~${Math.round(s / 60)} นาที`;
  }
  // 60 ช่องกระจายทั่วช่วงที่เลือก ขวาสุด = ล่าสุด — ต้องหารตามช่วง ไม่ใช่ตรึงช่องละนาที
  // ไม่งั้นเลือก 24h แล้วจะเห็นแค่ชั่วโมงสุดท้าย
  function sparkHtml(times) {
    const N = 60, mins = (data && data.windowMinutes) || 60;
    const newest = Date.now(), binMs = mins * 60000 / N;
    const bins = new Array(N).fill(0);
    for (const t of times) {
      const i = N - 1 - Math.floor((newest - t) / binMs);
      if (i >= 0 && i < N) bins[i]++;
    }
    const max = Math.max(1, ...bins);
    return `<div class="gf-spark">` + bins.map((n) => n
      ? `<i style="height:${Math.max(12, Math.round(n / max * 100))}%"></i>`
      : `<i class="z"></i>`).join('') + `</div>`;
  }

  // ---- อายุของปัญหา ----------------------------------------------------------
  // ผูกกับการ์ดด้วย {app, needle} ไม่ใช่ด้วยค่า signature — ถ้าผูกด้วย signature ก็ต้องมี
  // ตัวคำนวณ signature อีกชุดในฝั่ง main แล้วสองชุดนั้นจะ drift กัน
  function ageOf(g) {
    const c = HIST.filter((h) => h.app === g.app && g.sample.p.msg.includes(h.needle));
    return c.length ? c.sort((a, b) => b.needle.length - a.needle.length)[0] : null;
  }
  function ageBadge(h) {
    if (!h) return '';
    if (h.newToday) return `<span class="gf-age age-new" title="ไม่เคยเกิดในวันก่อนหน้าที่ตรวจเลย">🆕 ใหม่วันนี้</span>`;
    if (h.chronic) return `<span class="gf-age age-chronic" title="เกิดทุกวันที่ตรวจ — ไม่ใช่ของใหม่">⏳ ทุกวัน ${h.days.length} วัน</span>`;
    return `<span class="gf-age age-inter" title="เกิดเป็นพัก ๆ ไม่ใช่ทุกวัน">เกิด ${h.activeDays}/${h.days.length} วัน</span>`;
  }
  function daysBar(h) {
    if (!h) return '';
    const d = [...h.days].reverse();          // days[] เก็บวันนี้ตัวแรก จึงต้องกลับด้าน
    const max = Math.max(1, ...d);
    return `<div class="gf-days">` + d.map((n, i) => n
      ? `<i class="${i === d.length - 1 ? 'today' : ''}" style="height:${Math.max(14, Math.round(n / max * 100))}%" title="${n} ครั้ง"></i>`
      : `<i class="z" title="ไม่เกิด"></i>`).join('') + `</div>`
      + `<div class="gf-dayscap">${h.days.length} วันย้อนหลัง (ซ้าย=เก่า) · วันนี้ ${nf(h.days[0])} ครั้ง</div>`;
  }
  // ของใหม่มาก่อน ของที่เป็นทุกวันไปท้าย · ไม่รู้ประวัติอยู่กลาง ๆ ไม่ควรถูกดันลงไปเท่าของเรื้อรัง
  const novelty = (h) => !h ? 2 : h.newToday ? 0 : h.chronic ? 3 : 1;

  // ---- วาด --------------------------------------------------------------------
  let APP_TOTALS = {};
  function pctOfApp(g) {
    const t = APP_TOTALS[g.app] || 0;
    if (!t) return '0';
    const p = g.times.length / t * 100;
    return p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2);
  }

  // แถบสรุปใช้ "เลขจริงของทั้งช่วง" เมื่อมี ไม่ใช่นับจากบรรทัดที่ดึงมา
  //
  // เหตุผล: พอช่วงเวลากว้าง บรรทัดที่ดึงมาเป็นกลุ่มตัวอย่างที่เอียงตามแอปที่ log ถี่สุด
  // ที่ 3 วัน menutable-api กิน 2,406 จาก 2,997 บรรทัด ทำให้เลข Error ที่นับจากตัวอย่าง
  // ออกมา 181 ทั้งที่ของจริง 662 — เลขน้อยลงเมื่อขยายช่วงเวลา ซึ่งกลับหัวกับความเป็นจริง
  //
  // ถ้ามีตัวกรองฝั่งหน้าจอ (กลุ่ม/ระดับ) เลขจริงจะไม่ตรงกับที่เห็นในลิสต์ จึงต้องกลับไป
  // ใช้เลขจากตัวอย่างในกรณีนั้น และเขียนกำกับให้รู้ว่าเลขมาจากไหน
  function renderStats() {
    const v = view();
    const n = (lv) => v.filter((x) => x.p.level === lv).length;
    const sigs = new Set(v.filter((x) => OURS.has(x.p.level)).map((x) => x.sig)).size;
    const filteredHere = sel.groups.size > 0 || sel.level !== 'all';
    // ใช้เลขจริงทุกครั้งที่มี ไม่ใช่เฉพาะตอนสุ่ม — ถ้าดึงมาครบ เลขจริงกับเลขจากตัวอย่าง
    // ก็เท่ากันอยู่แล้ว ส่วนกรณี "ถูกตัดแต่ไม่ได้สุ่ม" (ช่วงสั้นแต่ log แน่นเกินเพดาน)
    // เคยตกหล่น: โชว์เลขจากตัวอย่างที่น้อยกว่าจริงโดยไม่มีอะไรบอก
    const useReal = Boolean(summary) && !filteredHere;
    const pick = (real, sample) => useReal ? (real == null ? null : real) : sample;
    const cells = [
      ['บรรทัด', pick(summary && summary.total, v.length), 'var(--accent)'],
      ['ปัญหาไม่ซ้ำ', sigs, sigs ? 'var(--accent)' : 'var(--dim)'],
      ['Error', pick(summary && summary.appError, n('ERROR')), 'var(--rose)'],
      ['Error 5xx', pick(summary && summary.err5xx, n('5xx')), 'var(--orange)'],
      ['Error 4xx', pick(summary && summary.err4xx, n('4xx')), 'var(--amber)'],
      ['Error 2xx', pick(summary && summary.err2xx, n('2xx')), 'var(--violet)'],
    ];
    el('gfStats').innerHTML = cells.map(([l, c, col]) =>
      `<div class="stat" style="--sc:${c ? col : 'var(--dim)'}"><div class="n">${c == null ? '…' : nf(c)}</div><div class="l">${l}</div></div>`).join('');
    const note = el('gfStatsNote');
    if (!note) return;
    if (!data || !data.truncated) note.textContent = '';   // ดึงมาครบ เลขไม่กำกวม
    else if (filteredHere) note.textContent = 'ตัวเลขนับจากบรรทัดที่ดึงมา เพราะมีตัวกรองกลุ่ม/ระดับอยู่ — เอาตัวกรองออกเพื่อดูยอดจริงของทั้งช่วง';
    else if (!summary) note.textContent = 'กำลังนับยอดจริงของทั้งช่วง...';
    else note.textContent = 'ยอดจริงของทั้งช่วง (นับฝั่ง Loki) — ไม่ใช่จำนวนบรรทัดในลิสต์ ซึ่งเป็นเพียงตัวอย่าง';
  }

  // บรรทัดนี้คือความซื่อสัตย์ของแท็บ: ชิปบอก 24h แต่ของจริงอาจไม่ได้เห็นทุกบรรทัด
  // truncated กับ sampled ต้องพูดคนละแบบ — "ยังไม่เห็นครบ" กับ "ที่เห็นกระจายทั่วช่วง"
  // คำแนะนำที่ตามมาไม่เหมือนกัน และถ้าบอกว่า "ย่อช่วงเวลา" ตอนที่มันสุ่มกระจายอยู่แล้วก็ผิด
  function renderCover() {
    const box = el('gfCover');
    if (!data) { box.innerHTML = ''; return; }
    const shown = view().length;
    const bits = [`เห็น <b>${nf(shown)}</b> บรรทัด`];
    // ยอดของทั้งช่วงมาจาก grafana-summary (อีก client) ไม่ใช่จาก queryLogs —
    // เมื่อก่อน queryLogs นับเองก่อนดึงบรรทัด ซึ่งกลายเป็นตัวบล็อก 11 วินาทีที่ช่วง 3 วัน
    if (summary && summary.total != null) {
      bits.push(sel.mode === 'issues'
        ? `จาก <b>${nf(summary.total)}</b> บรรทัดที่เป็นปัญหาในช่วงนี้`
        : `จาก <b>${nf(summary.total)}</b> บรรทัดในช่วงนี้`);
    } else if (data.truncated) {
      bits.push('กำลังนับยอดทั้งช่วง...');
    }
    if (data.coveredFrom) {
      // ต้องมีวันที่ ไม่ใช่แค่เวลา — "08:42–18:45" สำหรับช่วง 24 ก.ค. → 30 ก.ค. อ่านแล้ว
      // เข้าใจว่า 10 ชั่วโมง ทั้งที่เป็น 6 วัน
      bits.push(data.truncated
        ? `ครอบ ${spanText(data.coveredFrom, data.coveredTo)}`
        : `ครบทั้งช่วง (${spanText(data.coveredFrom, data.coveredTo)})`);
    }
    let html = bits.join(' · ');
    if (data.sampled) {
      html += `<br>สุ่มกระจาย <b>${data.chunks}</b> ช่วงย่อย ละ <b>${data.probeMinutes || '?'}</b> นาที ทั่ว ${esc(rangeText())}`
        + ` — ไม่ใช่ทุกบรรทัด แต่ครอบทั้งช่วงจริง (ถ้าเอาแต่บรรทัดล่าสุดจะได้แค่ไม่กี่นาทีท้าย ๆ`
        + ` และเปลี่ยนช่วงเวลาก็จะไม่เห็นความต่าง)`;
      if (sel.mode === 'all') html += `<br><span class="warn">อยากเห็นครบทุกบรรทัด</span> — ย่อช่วงเวลาลง`;
      else html += `<br><span class="warn">อยากเห็นครบทุกบรรทัด</span> — ย่อช่วงเวลา เลือกกลุ่มให้แคบลง หรือใส่คำค้น`;
    } else if (data.truncated) {
      html += `<br><span class="warn">⚠ ถูกตัดที่ ${nf(data.limit)} บรรทัด</span> — ย่อช่วงเวลาหรือใส่คำค้นเพื่อให้ครอบทั้งช่วง`;
    }
    box.innerHTML = html;
  }

  // ระหว่างดึง: บอกให้ชัดว่ากำลังทำอะไรอยู่ และหรี่ตัวกรอง/ผลชุดเก่าลง
  // ที่ต้องมีเพราะช่วงเวลายาวยิงได้ถึง 12 query เรียงกัน (Loki 2.6.1 รับ concurrent ไม่ได้)
  // ถ้าไม่บอกอะไรเลย กดชิปแล้วหน้าจอจะดูเหมือนไม่มีอะไรเกิดขึ้นหลายวินาที
  function renderLoading() {
    const box = el('gfLoading'), body = el('gfBody');
    const show = loading && !loadingSilent;
    body.classList.toggle('gf-busy', show);
    if (!show) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const rangeLabel = rangeText();
    const what = sel.mode === 'issues' ? 'บรรทัดที่เป็นปัญหา' : 'ทุกบรรทัด';
    box.classList.remove('hidden');
    box.innerHTML = `<span class="sp"></span><span>กำลังค้นหา ${what} ย้อนหลัง <b>${esc(rangeLabel)}</b>`
      + (sel.q.trim() ? ` ที่ตรงกับ <b>${esc(sel.q.trim())}</b>` : '')
      + ` จาก <b>${sel.env === 'prod' ? 'Prod' : 'Dev'}</b>…</span>`;
  }

  function renderRange() {
    const row = el('gfRange');
    row.innerHTML = RANGE_LABEL.map(([k, l]) =>
      `<div class="chip${!sel.custom && sel.rangeKey === k ? ' active' : ''}" data-r="${k}">${l}</div>`).join('')
      + `<div class="chip${sel.custom ? ' active' : ''}" data-r="custom" title="ระบุวันเวลาเริ่ม–สิ้นสุดเอง">กำหนดเอง</div>`;
    row.querySelectorAll('.chip').forEach((c) => c.onclick = () => {
      if (c.dataset.r === 'custom') {
        // เปิดช่องกรอกโดยยังไม่ยิง query — ผู้ใช้ต้องเลือกวันก่อน
        sel.custom = true;
        if (!sel.from || !sel.to) { sel.to = Date.now(); sel.from = sel.to - 864e5; }
        renderRange(); renderCustom();
        return;
      }
      sel.custom = false; sel.rangeKey = c.dataset.r; sel.limit = 60;
      renderCustom(); fetchLogs();
    });
    renderCustom();
  }

  // ช่องกรอกช่วงเวลาเอง — โผล่เฉพาะตอนเลือก "กำหนดเอง"
  // ใช้ datetime-local เพราะเป็นตัวเลือกวันเวลาในตัวของ Chromium ไม่ต้องพก date picker มาเอง
  function renderCustom() {
    const box = el('gfCustom');
    if (!box) return;
    if (!sel.custom) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<label>จาก<input id="gfFrom" class="search" type="datetime-local" value="${dtLocal(sel.from)}"></label>`
      + `<label>ถึง<input id="gfTo" class="search" type="datetime-local" value="${dtLocal(sel.to)}"></label>`
      + `<button id="gfCustomGo" type="button">ค้นหา</button>`
      + `<span id="gfCustomWarn" class="warn"></span>`;
    const fromEl = el('gfFrom'), toEl = el('gfTo'), warn = el('gfCustomWarn');
    const check = () => {
      const a = new Date(fromEl.value).getTime(), b = new Date(toEl.value).getTime();
      if (!Number.isFinite(a) || !Number.isFinite(b)) { warn.textContent = 'กรอกวันเวลาให้ครบทั้งสองช่อง'; return null; }
      if (b <= a) { warn.textContent = 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม'; return null; }
      // เตือน ไม่ห้าม — ช่วงยาวใช้ได้ แต่ต้องรู้ว่าจะช้าและได้เป็นตัวอย่าง
      const days = (b - a) / 864e5;
      warn.textContent = days > 7
        ? `ช่วง ${days.toFixed(1)} วัน — จะใช้เวลาค้นนานและได้เป็นตัวอย่างกระจาย ไม่ใช่ทุกบรรทัด`
        : '';
      return [a, b];
    };
    fromEl.onchange = toEl.onchange = check;
    el('gfCustomGo').onclick = () => {
      const r = check();
      if (!r) return;
      sel.from = r[0]; sel.to = r[1]; sel.limit = 60;
      fetchLogs();
    };
    check();
  }

  function renderGroupChips() {
    const pool = except('group');
    const gs = Object.keys(APP_GROUPS).filter((g) => (APP_GROUPS[g] || []).length);
    // ล้างกลุ่มที่ค้างแต่ไม่มีในข้อมูลแล้ว — ต้องล้างก่อนนับ ไม่ใช่หลังนับ ไม่งั้นชิปจะ
    // นับได้ 0 ทุกอันทั้งที่ลิสต์ข้างล่างยังมีของ
    for (const g of [...sel.groups]) if (!gs.includes(g)) sel.groups.delete(g);
    el('gfGroups').innerHTML =
      `<div class="chip${sel.groups.size === 0 ? ' active' : ''}" data-g="">ทุกกลุ่ม<span class="n">${nf(pool.length)}</span></div>`
      + gs.map((g) => `<div class="chip${sel.groups.has(g) ? ' active' : ''}" data-g="${esc(g)}">`
        + `${esc(GROUP_LABEL[g] || g)}<span class="n">${nf(pool.filter((x) => x.grp === g).length)}</span></div>`).join('');
    el('gfGroups').querySelectorAll('.chip').forEach((c) => c.onclick = () => {
      const g = c.dataset.g;
      if (!g) sel.groups.clear();
      else sel.groups.has(g) ? sel.groups.delete(g) : sel.groups.add(g);
      sel.limit = 60; renderAll();
    });
  }

  function renderLevels() {
    // ชิปสร้างจากระดับที่มีอยู่จริงในข้อมูล ไม่ใช่ลิสต์ที่เขียนตายตัว — ระดับที่ parser
    // สร้างได้แต่ลิสต์ไม่มี จะกลายเป็นตัวกรองล่องหน (นับใน "ทั้งหมด" แต่ไม่มีชิปแทน)
    const present = [...new Set(ALL.map((x) => x.p.level))];
    const ordered = [...LV_ORDER.filter((k) => present.includes(k)),
                     ...present.filter((k) => !LV_ORDER.includes(k)).sort()];
    if (sel.level !== 'all' && !present.includes(sel.level)) sel.level = 'all';
    const pool = except('level');
    const cnt = {};
    pool.forEach((x) => cnt[x.p.level] = (cnt[x.p.level] || 0) + 1);
    const defs = [['all', 'ทั้งหมด'], ...ordered.map((k) => [k, LV_LABEL[k] || k])];
    el('gfLevels').innerHTML = defs.map(([k, l]) =>
      `<div class="chip${sel.level === k ? ' active' : ''}" data-l="${esc(k)}" style="--cc:${LV_HUE[k] || 'var(--dim)'}"`
      + (LV_TIP[k] ? ` title="${esc(LV_TIP[k])}"` : '') + `>`
      + (k === 'all' ? '' : '<span class="dot"></span>') + esc(l)
      + `<span class="n">${nf(k === 'all' ? pool.length : (cnt[k] || 0))}</span></div>`).join('');
    el('gfLevels').querySelectorAll('.chip').forEach((c) => c.onclick = () => {
      sel.level = c.dataset.l; sel.limit = 60; renderAll();
    });
  }

  function renderToggles() {
    const wrap = el('gfToggles'), label = el('gfToggleLabel');
    if (!noiseOn()) {                 // โหมดปัญหา: Loki ตัดออกไปแล้ว ไม่มีอะไรให้ซ่อน
      wrap.innerHTML = ''; wrap.style.display = 'none'; label.style.display = 'none';
      return;
    }
    wrap.style.display = ''; label.style.display = '';
    const pool = except('noise');
    const nP = pool.filter((x) => x.probe).length, nS = pool.filter((x) => x.sql).length;
    wrap.innerHTML =
      `<div class="gf-tg${sel.hideProbe ? ' on' : ''}" data-t="probe"><span class="box">✓</span>`
      + `ซ่อน health probe<span class="n">${nf(nP)}</span></div>`
      + `<div class="gf-tg${sel.hideSql ? ' on' : ''}" data-t="sql"><span class="box">✓</span>`
      + `ซ่อน SQL ของ GORM<span class="n">${nf(nS)}</span></div>`;
    wrap.querySelectorAll('.gf-tg').forEach((c) => c.onclick = () => {
      if (c.dataset.t === 'probe') sel.hideProbe = !sel.hideProbe; else sel.hideSql = !sel.hideSql;
      sel.limit = 60; renderAll();
    });
  }

  // แถบ "ผลถูกซ่อนอยู่" — ปัญหาที่แก้: พิมพ์คำที่มีอยู่จริงแล้วได้ 0 ซึ่งคนอ่านว่า
  // "ไม่มี log แบบนี้" ทั้งที่มันมี แค่ถูกตัวกรองอื่นซ่อน
  // นับจาก !passes(x) && passes(x,[มิตินั้น]) = "ถ้าคลายมิตินี้มิติเดียวจะโผล่มากี่บรรทัด"
  // ไม่ใช่จำนวนที่มิตินั้นกรองทิ้งทั้งหมด — บรรทัดที่ถูกกั้นด้วยสองมิติพร้อมกันจึงไม่ถูกนับซ้ำ
  const FIXERS = {
    probe: () => sel.hideProbe = false,
    sql: () => sel.hideSql = false,
    level: () => sel.level = 'all',
    group: () => sel.groups.clear(),
  };
  const FIX_LABEL = { probe: 'โชว์ health probe', sql: 'โชว์ SQL ของ GORM', level: 'เลิกกรองระดับ', group: 'เลิกกรองกลุ่ม' };
  function renderHidden() {
    const box = el('gfHidden');
    const terms = qTerms(), shown = view().length;
    const causes = [];
    for (const d of ['probe', 'sql', 'level', 'group']) {
      const n = ALL.filter((x) => !passes(x) && passes(x, [d])).length;
      if (n > 0) causes.push([d, n]);
    }
    // โชว์เฉพาะตอนที่ช่วยได้จริง: กำลังค้นอยู่ หรือหน้าว่างเปล่า — ถ้าโชว์ทุกครั้ง
    // แถบนี้จะติดอยู่ตลอดเวลาแล้วคนจะเลิกอ่านมัน
    if (!causes.length || (!terms.length && shown > 0)) { box.innerHTML = ''; return; }
    const total = causes.reduce((a, [, n]) => a + n, 0);
    const head = terms.length
      ? (shown === 0
        ? `ไม่พบใน log ที่กำลังแสดง แต่ <b>${nf(total)}</b> บรรทัดที่ตรงกับ <code>${esc(sel.q.trim())}</code> ถูกตัวกรองอื่นซ่อนไว้`
        : `มีอีก <b>${nf(total)}</b> บรรทัดที่ตรงกับ <code>${esc(sel.q.trim())}</code> ถูกตัวกรองอื่นซ่อนไว้`)
      : `ไม่มีอะไรผ่านตัวกรองชุดนี้ — แต่คลายอย่างใดอย่างหนึ่งแล้วจะเห็น <b>${nf(total)}</b> บรรทัด`;
    box.innerHTML = `<div class="gf-hid"><div class="ht">${head}</div><div class="hb">`
      + causes.map(([d, n]) => `<button data-fix="${d}">${FIX_LABEL[d]}<span class="n">${nf(n)}</span></button>`).join('')
      + `</div></div>`;
    box.querySelectorAll('button[data-fix]').forEach((b) => b.onclick = () => {
      FIXERS[b.dataset.fix](); sel.limit = 60; renderAll();
    });
  }

  function renderGrouped() {
    const v = view();
    APP_TOTALS = {};
    for (const x of v) APP_TOTALS[x.app] = (APP_TOTALS[x.app] || 0) + 1;
    const map = new Map();
    for (const x of v) {
      let g = map.get(x.sig);
      if (!g) { g = { sig: x.sig, app: x.app, level: x.p.level, sample: x, times: [], pods: new Set() }; map.set(x.sig, g); }
      g.times.push(x.t); g.pods.add(x.pod);
      if (x.t > g.sample.t) g.sample = x;
    }
    // ความใหม่ต้องมาก่อนจำนวน ไม่งั้น cron ที่พังมา 8 วัน (1537 ครั้ง/วัน) จะทับบั๊กที่
    // เพิ่งเกิดวันนี้ (2 ครั้ง) ตลอดกาล ซึ่งกลับหัวกับสิ่งที่ควรไล่ก่อน
    for (const g of map.values()) g.hist = ageOf(g);
    const groups = [...map.values()].sort((a, b) =>
      (TIER[a.level] ?? 9) - (TIER[b.level] ?? 9)
      || novelty(a.hist) - novelty(b.hist)
      || b.times.length - a.times.length || b.sample.t - a.sample.t);

    const out = el('gfOut');
    if (!groups.length) { out.innerHTML = `<div class="empty">ไม่มี log ที่ตรงกับตัวกรอง</div>`; return; }
    const shown = groups.slice(0, sel.limit);
    out.innerHTML = `<div class="gf-groups">` + shown.map((g, i) => {
      const p = g.sample.p, cad = cadence(g.times);
      const hue = LV_HUE[g.level] || 'var(--dim)';
      return `<div class="gf-g gf-ap${apIdx(g.app)}" style="--sc:${hue}" data-i="${i}">
        <div class="gtop">
          <span class="gf-lvl lv-${esc(String(g.level).toLowerCase())}"${LV_TIP[g.level] ? ` title="${esc(LV_TIP[g.level])}"` : ''}>${esc(LV_LABEL[g.level] || g.level)}</span>
          <span class="gf-app">${esc(g.app)}</span>
          ${g.times.length > 1 ? `<span class="gf-count">×${nf(g.times.length)}</span>` : ''}
          ${ageBadge(g.hist)}
          <span class="gf-when">${ago(g.sample.t)}</span>
        </div>
        <div class="gmsg">${esc(p.msg)}${p.err ? ` <span style="color:var(--rose)">· ${esc(p.err)}</span>` : ''}</div>
        <div class="gmeta">
          ${cad ? `<span>⟳ <b>${cad}</b></span>` : ''}
          ${p.status ? `<span>สถานะ <b>${p.status}</b></span>` : ''}
          ${p.latency ? `<span>ใช้เวลา <b>${esc(p.latency)}</b></span>` : ''}
          <span title="สัดส่วนของบรรทัดที่เห็นอยู่จาก ${esc(g.app)} — จำนวนดิบเทียบข้าม app กันไม่ได้"><b>${pctOfApp(g)}%</b> ของ ${esc(g.app)}</span>
          <span>pod <b>${g.pods.size > 1 ? nf(g.pods.size) + ' ตัว' : esc([...g.pods][0] || '—')}</b></span>
          <span>ล่าสุด <b>${hhmmss(g.sample.t)}</b></span>
        </div>
        ${g.times.length > 1 ? sparkHtml(g.times) : ''}
        <div class="gf-det">
          ${daysBar(g.hist)}
          ${p.drain ? `<div class="gf-tpl"><span class="tl">template ที่ Drain เรียนได้</span>`
            + `<code>${esc(DRAIN.tplOf(p.drain))}</code>`
            + `<span class="tn">คลุม ${nf(p.drain.n)} บรรทัดในชุดนี้ · <b>&lt;*&gt;</b> = ตำแหน่งที่ค่าเปลี่ยนไปเรื่อย ๆ</span></div>` : ''}
          <pre>${p.json ? prettyJson(p.json) : esc(p.text)}</pre>
          <div class="gf-occ">${g.times.slice(0, 24).sort((a, b) => b - a).map((t) => `<span>${hhmmss(t)}</span>`).join('')}${g.times.length > 24 ? `<span>+${nf(g.times.length - 24)}</span>` : ''}</div>
        </div>
      </div>`;
    }).join('') + `</div>`
      + (groups.length > shown.length ? `<button class="gf-more">โหลดเพิ่ม · เหลืออีก ${nf(groups.length - shown.length)} กลุ่ม</button>` : '')
      + `<div class="gf-noise">รวม ${nf(v.length)} บรรทัดเป็น ${nf(groups.length)} เรื่อง</div>`;
    out.querySelectorAll('.gf-g').forEach((d) => d.onclick = () => d.classList.toggle('open'));
    const more = out.querySelector('.gf-more');
    if (more) more.onclick = () => { sel.limit += 60; renderOut(); };
  }

  function renderStream() {
    const v = view(), out = el('gfOut');
    if (!v.length) { out.innerHTML = `<div class="empty">ไม่มี log ที่ตรงกับตัวกรอง</div>`; return; }
    const shown = v.slice(0, sel.limit);
    out.innerHTML = `<div class="gf-stream">` + shown.map((x, i) => {
      const p = x.p;
      const st = p.status ? `<span class="st gf-st${String(p.status)[0]}">${p.status}</span>` : '';
      return `<div class="gf-r gf-ap${apIdx(x.app)} lv${esc(p.level)}" data-i="${i}">
        <span class="t">${hhmmss(x.t)}</span>
        <span class="a" title="${esc(x.app)}">${esc(x.app)}</span>
        <span class="m">${esc(p.msg)}${p.latency ? ` <span style="color:var(--dim)">${esc(p.latency)}</span>` : ''}</span>
        ${st}
      </div>`;
    }).join('') + `</div>`
      + (v.length > shown.length ? `<button class="gf-more">โหลดเพิ่ม · เหลืออีก ${nf(v.length - shown.length)} บรรทัด</button>` : '');
    out.querySelectorAll('.gf-r').forEach((d, i) => d.onclick = () => {
      d.classList.toggle('open');
      if (d.querySelector('.gf-det')) return;      // สร้างครั้งเดียว ที่เหลือ CSS คุม
      const x = shown[i], p = x.p;
      // ห้ามใส่ display:block ที่นี่ — inline style ชนะ CSS ตลอด แล้วกดย่อกลับไม่ได้
      const det = document.createElement('div');
      det.className = 'gf-det';
      det.innerHTML = `<pre>${p.json ? prettyJson(p.json) : esc(p.text)}</pre>`
        + `<div class="gf-occ"><span>pod ${esc(x.pod || '—')}</span><span>ns ${esc(x.ns || '—')}</span>`
        + `<span>container ${esc(x.container || '—')}</span><span>stream ${esc(x.stream || '—')}</span></div>`;
      d.appendChild(det);
    });
    const more = out.querySelector('.gf-more');
    if (more) more.onclick = () => { sel.limit += 60; renderOut(); };
  }

  // endpoint ที่ช้า — คำขอสำเร็จ 200 แต่ผู้ใช้รอ 8 วินาที หน้า error ไม่มีทางเห็น
  const uriLabel = (u) => String(u).split('?')[0]
    // ย่อ id แต่เหลือหัวไว้ 6 ตัว ไม่งั้น endpoint ของ outlet ต่างตัวจะกลายเป็นป้ายเดียวกัน
    // เป๊ะ 2 แถวที่ตัวเลขไม่เท่ากัน ซึ่งอ่านแล้วเหมือนบั๊ก (จะรวมแถวก็ไม่ได้ เอา percentile
    // มาเฉลี่ยกันไม่ได้)
    .replace(/\/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m, h) => `/‹${h.slice(0, 6)}…›`)
    .replace(/\/(\d+)(?=\/|$)/g, (m, d) => `/‹${d.length > 6 ? d.slice(0, 6) + '…' : d}›`);
  const LOW_N = 5;
  function renderSlow() {
    const cap = el('gfSlowCap'), box = el('gfSlow');
    const rows = ((overview && overview.slowEndpoints) || [])
      .filter((s) => sel.groups.size === 0 || sel.groups.has(APP_GROUP[s.app] || 'other'));
    if (overview && overview.slowEndpointsError) {
      cap.innerHTML = ''; box.innerHTML = `<div class="empty">ดึงข้อมูลไม่สำเร็จ — ${esc(overview.slowEndpointsError)}</div>`;
      return;
    }
    if (!overview) { cap.innerHTML = ''; box.innerHTML = `<div class="hint">กำลังโหลด...</div>`; return; }
    if (!rows.length) { cap.innerHTML = ''; box.innerHTML = `<div class="empty">ไม่มีข้อมูลของกลุ่มที่เลือก</div>`; return; }
    cap.innerHTML = `คำขอที่สำเร็จแต่ช้า — หน้า error ด้านบนมองไม่เห็นเลย · `
      + `ช่วงเวลาคงที่ 24 ชม. <b>ไม่ขยับตามชิปช่วงเวลา</b> · `
      + `<span style="color:var(--cyan)">▮</span> p50 กลาง · <span style="color:var(--orange)">▮</span> p95`;
    const max = Math.max(...rows.map((r) => r.p95ms));
    box.innerHTML = `<div class="gf-slow">` + rows.map((s) => {
      const lowN = s.count != null && s.count < LOW_N;
      const always = s.p50ms != null && s.p50ms > s.p95ms * 0.5;
      return `<div class="gf-sr gf-ap${apIdx(s.app)}">
        <div class="st1">
          <span class="sapp">${esc(s.app)}</span>
          <span class="suri" title="${esc(s.uri)}">${esc(uriLabel(s.uri))}</span>
          <span class="sp95">${ms(s.p95ms)}</span>
        </div>
        <div class="smeta">
          <span>p50 <b>${ms(s.p50ms)}</b></span>
          <span>p95 <b>${ms(s.p95ms)}</b></span>
          <span class="${lowN ? 'lown' : ''}">คำขอ <b>${nf(s.count)}</b>${lowN ? ' ← น้อยเกินจะเชื่อ p95' : ''}</span>
          <span>${always ? 'ช้าทุกครั้ง' : 'ช้าเป็นบางครั้ง'}</span>
        </div>
        <div class="gf-bar">
          <i class="b95" style="width:${Math.max(2, s.p95ms / max * 100)}%"></i>
          <i class="b50" style="width:${Math.max(1, (s.p50ms || 0) / max * 100)}%"></i>
        </div>
      </div>`;
    }).join('') + `</div>`;
  }

  const renderOut = () => sel.view === 'g' ? renderGrouped() : renderStream();

  function renderLive() {
    const box = el('gfLive');
    box.className = 'gf-live' + (loading ? ' busy' : loadErr ? ' err' : '');
    const envName = sel.env === 'prod' ? 'Prod' : 'Dev';
    box.querySelector('span:last-child').textContent = loading ? `${envName} · กำลังโหลด...`
      : loadErr ? `${envName} · ต่อไม่ได้`
      : data ? `${envName} · ${hhmmss(new Date(data.queriedAt))}` : envName;
  }

  function renderShell() {
    el('gfEnvDev').classList.toggle('on', sel.env === 'dev');
    el('gfEnvProd').classList.toggle('on', sel.env === 'prod');
    el('gfEnvProd').disabled = !envAvail.prod;
    el('gfEnvProd').title = envAvail.prod ? 'ดู log ของ Prod' : 'ยังไม่ได้ตั้งค่า Prod — ใส่ URL กับ token ในหน้าตั้งค่า';
    el('gfModeIssues').classList.toggle('on', sel.mode === 'issues');
    el('gfModeAll').classList.toggle('on', sel.mode === 'all');
    el('gfViewG').classList.toggle('on', sel.view === 'g');
    el('gfViewS').classList.toggle('on', sel.view === 's');
  }

  function renderAll() {
    renderShell(); renderLive();
    if (notConfigured) {
      el('gfBody').classList.add('hidden');
      el('gfNotice').innerHTML = `<div class="not-configured">
        <p>ยังไม่ได้ตั้งค่า Grafana — ใส่ URL กับ API token ของ Grafana ที่ต้องการดู log</p>
        <button id="gfGoSet">ไปหน้าตั้งค่า</button></div>`;
      const b = el('gfGoSet');
      if (b) b.onclick = () => shell().openSettings('cardGrafana');
      return;
    }
    if (loadErr && !data) {
      el('gfBody').classList.add('hidden');
      el('gfNotice').innerHTML = `<div class="not-configured"><p>ต่อ Grafana ไม่ได้ — ${esc(loadErr)}</p>
        <button id="gfRetry">ลองใหม่</button></div>`;
      const b = el('gfRetry');
      if (b) b.onclick = () => fetchLogs();
      return;
    }
    el('gfNotice').innerHTML = '';
    el('gfBody').classList.remove('hidden');
    // ลำดับสำคัญ: renderGroupChips/renderLevels ล้างค่าที่ค้างในตัวมันเอง จึงต้องมาก่อน
    // renderHidden กับ renderOut ไม่งั้นแถบเตือนกับลิสต์จะคิดจากค่าที่ตายแล้วต่างกัน
    renderStats(); renderRange(); renderGroupChips(); renderLevels(); renderToggles();
    renderCover(); renderLoading(); renderHidden(); renderOut(); renderSlow();
  }

  // ---- ดึงข้อมูล --------------------------------------------------------------
  function ingest(payload) {
    data = payload;
    DRAIN = makeDrain();                 // ชุดข้อมูลใหม่ = ต้นไม้ใหม่
    ALL = (payload.lines || []).map((l) => {
      const p = parseLine(l.line);
      // hay = ทุกอย่างที่คำค้นควรแตะได้ รวม label ของ Loki (app/pod/container/ns/stream)
      // ซึ่งอยู่คนละที่กับตัวบรรทัด ไม่ใส่ไว้ พิมพ์ "wallet" แล้วจะได้ 0 ทั้งที่ wallet-api มี log
      const hay = [p.msg, p.text, l.app, l.pod, l.container, l.ns, l.stream]
        .filter(Boolean).join('  ').toLowerCase();
      return {
        ...l, p, hay, t: new Date(l.ts).getTime(),
        probe: isProbe(p), sql: isSql(p),
        sig: signatureOf(l.app, p), grp: APP_GROUP[l.app] || 'other',
      };
    });
  }

  // silent = การดึงเองทุก 1 นาที ไม่ใช่ผู้ใช้กด — ห้ามขึ้นแถบและห้ามหรี่จอ
  // ไม่งั้นหน้าจอจะกระพริบทุกนาทีทั้งที่ผู้ใช้ไม่ได้สั่งอะไร
  // พารามิเตอร์ช่วงเวลา/ตัวกรองที่ต้องส่งให้ main — ประกอบที่เดียว ไม่ให้แต่ละที่ประกอบเอง
  function queryParams() {
    const p = {
      env: sel.env, mode: sel.mode, search: sel.q,
      apps: sel.groups.size ? [...sel.groups].flatMap((g) => APP_GROUPS[g] || []) : undefined,
    };
    if (sel.custom && sel.from && sel.to) { p.from = sel.from; p.to = sel.to; }
    else p.rangeKey = sel.rangeKey;
    return p;
  }
  // ป้ายบอกช่วงที่เลือก ใช้ทั้งในแถบกำลังโหลดและคำอธิบาย
  function rangeText() {
    if (sel.custom && sel.from && sel.to) return `${dtText(sel.from)} → ${dtText(sel.to)}`;
    const f = RANGE_LABEL.find((r) => r[0] === sel.rangeKey);
    return f ? f[1] : sel.rangeKey;
  }

  function fetchLogs(opts) {
    const silent = Boolean(opts && opts.silent);
    const api = shell().api;
    if (!api || !api.grafanaQuery) return;
    const seq = ++reqSeq;
    // ต้องขึ้นตัวบอกสถานะทันทีในจังหวะเดียวกับที่กด ไม่ใช่รอผลกลับมา —
    // renderLive() ตัวเดียวเปลี่ยนแค่จุดเล็ก ๆ มุมขวาบน ซึ่งอยู่ไกลจากที่ตาผู้ใช้มอง
    loading = true; loadingSilent = silent; loadErr = null;
    renderLive(); renderLoading();
    const params = queryParams();
    api.grafanaQuery(params).then((res) => {
      if (seq !== reqSeq) return;          // มีคำขอใหม่แซงไปแล้ว ทิ้งผลเก่า
      loading = false;
      notConfigured = Boolean(res && res.notConfigured);
      if (res && res.error) { loadErr = res.error; renderAll(); return; }
      loadErr = null;
      ingest(res);
      renderAll();
      fetchSummary();
      fetchHistory();
    }, (e) => {
      if (seq !== reqSeq) return;
      loading = false; loadErr = String((e && e.message) || e); renderAll();
    });
    fetchOverview();
  }

  // ตัวเลขจริงของทั้งช่วง วิ่งบน client อีกตัวฝั่ง main จึงไม่ไปต่อคิวหลังรายการ
  function fetchSummary() {
    const api = shell().api;
    if (!api || !api.grafanaSummary) return;
    const p = queryParams();
    const key = JSON.stringify(p);
    if (key === summaryKey) return;
    summaryKey = key;
    summary = null;
    renderStats(); renderCover();          // ขึ้นสถานะ "กำลังนับ" ทันที
    api.grafanaSummary(p).then((res) => {
      if (key !== summaryKey) return;      // มีคำขอใหม่แซงไปแล้ว
      summary = res && !res.error ? res : null;
      if (visible()) { renderStats(); renderCover(); }
    }, () => { /* เป็นของเสริม ล้มได้ */ });
  }

  let overviewKey = '';
  function fetchOverview() {
    const api = shell().api;
    if (!api || !api.grafanaOverview) return;
    const key = sel.env;                  // ช่วงของส่วนนี้ตรึงไว้ 24 ชม. ไม่ผูกกับชิปช่วงเวลา
    if (overviewKey === key && overview) { renderSlow(); return; }
    overviewKey = key;
    api.grafanaOverview({ env: sel.env, rangeKey: '24h' }).then((res) => {
      if (overviewKey !== key) return;
      overview = res && !res.error ? res : null;
      if (visible()) { renderStats(); renderSlow(); }
    }, () => { /* ส่วนเสริม ล้มได้ ไม่ทำให้ลิสต์หลักพัง */ });
  }

  // ประวัติรายวัน: ส่งเฉพาะปัญหาที่กำลังเห็นอยู่ และเฉพาะที่เป็นของเรา (4xx เป็นบอตสแกน
  // ไม่ต้องตามประวัติ) needle = ชิ้นข้อความคงที่ที่ยาวสุด ใช้เป็น line filter ฝั่ง Loki
  // ตัวคั่นชั่วคราวสำหรับตัดค่าที่ไม่ซ้ำออก — ต้องเป็นอักขระจริงที่ไม่มีทางโผล่ใน log
  // ห้ามใช้สตริงว่าง: split('') ตัดข้อความเป็นตัวอักษรทีละตัว
  const NEEDLE_SEP = '\u0001';
  function needleOf(p) {
    if (p.kind === 'http') return p.uri.split('?')[0];
    const stripped = p.msg
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, NEEDLE_SEP)
      .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, NEEDLE_SEP)
      .replace(/\b[0-9a-f]{12,}\b/gi, NEEDLE_SEP)
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, NEEDLE_SEP)
      .replace(/\d+(\.\d+)?/g, NEEDLE_SEP)
      .replace(/'[^']*'/g, NEEDLE_SEP).replace(/"[^"]*"/g, NEEDLE_SEP);
    const parts = stripped.split(NEEDLE_SEP).map((s) => s.trim()).filter((s) => s.length >= 8);
    parts.sort((a, b) => b.length - a.length);
    return parts[0] ? parts[0].slice(0, 90) : null;
  }
  function fetchHistory() {
    const api = shell().api;
    if (!api || !api.grafanaHistory) return;
    const seen = new Map();
    for (const x of ALL) {
      if (!OURS.has(x.p.level)) continue;
      const needle = needleOf(x.p);
      if (!needle) continue;
      const k = x.app + '|' + needle;
      if (!seen.has(k)) seen.set(k, { app: x.app, needle, level: x.p.level });
    }
    const problems = [...seen.values()].slice(0, 12);
    if (!problems.length) { HIST = []; return; }
    const key = sel.env + '::' + problems.map((p) => p.app + '|' + p.needle).sort().join('§');
    if (key === histKey) return;          // ชุดเดิม ไม่ต้องยิง ~96 query ซ้ำ
    histKey = key;
    api.grafanaHistory({ env: sel.env, problems, days: 8 }).then((res) => {
      if (key !== histKey) return;
      HIST = (res && res.history) || [];
      if (visible()) renderOut();
    }, () => { /* ป้ายอายุเป็นของเสริม */ });
  }

  // ---- สัญญาโมดูล -------------------------------------------------------------
  let searchTimer = null;
  function mount() {
    const api = shell().api;
    if (api && api.grafanaAppGroups) {
      api.grafanaAppGroups().then((groups) => {
        if (groups) {
          APP_GROUPS = groups;
          APP_GROUP = {};
          APP_ORDER = [];
          for (const [g, apps] of Object.entries(groups)) {
            for (const a of apps) { APP_GROUP[a] = g; APP_ORDER.push(a); }
          }
        }
      });
    }
    el('gfEnvDev').onclick = () => { if (sel.env !== 'dev') { sel.env = 'dev'; resetForEnv(); } };
    el('gfEnvProd').onclick = () => { if (sel.env !== 'prod') { sel.env = 'prod'; resetForEnv(); } };
    el('gfModeIssues').onclick = () => { if (sel.mode !== 'issues') { sel.mode = 'issues'; sel.limit = 60; fetchLogs(); } };
    el('gfModeAll').onclick = () => { if (sel.mode !== 'all') { sel.mode = 'all'; sel.limit = 60; fetchLogs(); } };
    el('gfViewG').onclick = () => { sel.view = 'g'; sel.limit = 60; renderShell(); renderOut(); };
    el('gfViewS').onclick = () => { sel.view = 's'; sel.limit = 60; renderShell(); renderOut(); };
    // คำค้นถูกส่งลงไปให้ Loki จึงต้องหน่วง ไม่ยิงทุกตัวอักษร
    el('gfSearch').oninput = (e) => {
      sel.q = e.target.value; sel.limit = 60;
      renderAll();                        // กรองซ้ำในชุดที่มีอยู่ให้เห็นผลทันที
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { if (visible()) fetchLogs(); }, 450);
    };
    const rb = el('gfRefresh');
    if (rb) rb.onclick = () => fetchLogs();
    // ต้องรู้ตั้งแต่ boot ว่าตั้งค่าไว้หรือยัง — ถ้ารอให้เปิดหน้าตั้งค่าก่อน ปุ่ม Prod
    // จะดูกดได้ทั้งที่ยังไม่ได้ตั้งค่า และแบนเนอร์ "ยังไม่ได้ตั้งค่า" จะไม่ขึ้น
    if (api && api.getGrafanaConfig) {
      api.getGrafanaConfig().then((c) => {
        if (!c) return;
        cfgSnapshot = c;
        envAvail = { dev: Boolean(c.dev.url && c.dev.hasToken), prod: Boolean(c.prod.url && c.prod.hasToken) };
        notConfigured = !envAvail.dev && !envAvail.prod;
        if (!envAvail.dev && envAvail.prod) sel.env = 'prod';
        renderShell();
        if (visible()) renderAll();
      });
    }
    renderShell();
  }
  function resetForEnv() {
    data = null; ALL = []; HIST = []; histKey = ''; overview = null; overviewKey = '';
    summary = null; summaryKey = '';
    sel.limit = 60; loadErr = null;
    fetchLogs();
  }
  function onShow() {
    if (!data && !loading) fetchLogs();
    else renderAll();
    // เดินต่อเองระหว่างเปิดแท็บนี้อยู่ · ไม่มี onHide ในสัญญา จึงเช็คจาก DOM แทน
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (!visible()) return;
        if (!loading) fetchLogs({ silent: true });
      }, 60000);
    }
  }
  // ธีมเปลี่ยน = สีมาจาก CSS token ทั้งหมด ไม่มีสีที่ JS ฝังไว้ในสไตล์ inline
  // ยกเว้น --sc/--ac ที่อ้าง var() อยู่แล้ว จึงไม่ต้องวาดใหม่ — แต่ต้องทน onTheme ตอน
  // ยังไม่มีข้อมูลได้ (เช็คจาก DOM ไม่ใช่ตัวแปร) ตามสัญญาของเปลือก
  function onTheme() { /* ไม่ต้องทำอะไร ทุกสีเป็น var() */ }

  // ---- หน้าตั้งค่า ------------------------------------------------------------
  let setEnv = 'dev';
  let setUrlEl, setTokenEl, setStatusEl, setSaveEl, setTestEl, setEnvBtns, setHintEl;
  let cfgSnapshot = { dev: { url: '', hasToken: false, tokenHint: '' }, prod: { url: '', hasToken: false, tokenHint: '' } };
  function paintSettings() {
    const c = cfgSnapshot[setEnv] || { url: '', hasToken: false, tokenHint: '' };
    setUrlEl.value = c.url || '';
    setTokenEl.value = '';
    // token อ่านกลับไม่ได้ (main ไม่ส่งมาให้) จึงต้องบอกให้ชัดว่าเว้นว่าง = ไม่แก้ของเดิม
    setTokenEl.placeholder = c.hasToken ? `เก็บไว้แล้ว ${c.tokenHint} — เว้นว่างไว้ถ้าไม่เปลี่ยน` : 'glsa_… หรือ eyJrIjoi…';
    setHintEl.innerHTML = setEnv === 'dev'
      ? 'สร้าง token ที่ Grafana → ⚙ Configuration → <b>Service accounts</b> (หรือ <b>API keys</b>) → Role <b>Viewer</b> · Grafana 9.x เมนูนี้อยู่ใต้ Configuration ไม่ใช่ Administration'
      : 'Prod เป็นอีก instance คนละ token กับ Dev — ยังไม่ต้องกรอกก็ได้ แท็บจะขึ้นว่ายังไม่พร้อมใช้';
    setEnvBtns.forEach((b) => b.classList.toggle('on', b.dataset.env === setEnv));
    setStatusEl.textContent = ''; setStatusEl.className = 'set-status';
  }
  function mountSettings() {
    setUrlEl = el('setGfUrl'); setTokenEl = el('setGfToken');
    setStatusEl = el('setGfStatus'); setSaveEl = el('setGfSave'); setTestEl = el('setGfTest');
    setHintEl = el('setGfHint');
    setEnvBtns = [...document.querySelectorAll('#setGfEnv .gf-env')];
    setEnvBtns.forEach((b) => b.onclick = () => { setEnv = b.dataset.env; paintSettings(); });
    setTestEl.onclick = () => {
      setTestEl.disabled = true;
      setStatusEl.className = 'set-status'; setStatusEl.textContent = 'กำลังทดสอบ...';
      shell().api.testGrafanaConnection({ env: setEnv, url: setUrlEl.value.trim(), token: setTokenEl.value.trim() })
        .then((r) => {
          setTestEl.disabled = false;
          if (r && r.ok) {
            setStatusEl.className = 'set-status ok';
            setStatusEl.textContent = `ต่อได้ · Grafana ${r.version} · datasource: ${(r.datasources || []).join(', ')}`
              + (r.lokiFound ? '' : ' — แต่ไม่พบ datasource ชนิด Loki แท็บนี้จะใช้ไม่ได้');
          } else {
            setStatusEl.className = 'set-status err';
            setStatusEl.textContent = (r && r.error) || 'ต่อไม่ได้';
          }
        });
    };
    setSaveEl.onclick = () => {
      setSaveEl.disabled = true;
      shell().api.saveGrafanaConfig({ env: setEnv, url: setUrlEl.value.trim(), token: setTokenEl.value.trim() })
        .then((r) => {
          setSaveEl.disabled = false;
          if (r && r.config) cfgSnapshot = r.config;
          envAvail = { dev: Boolean(cfgSnapshot.dev.url && cfgSnapshot.dev.hasToken),
                       prod: Boolean(cfgSnapshot.prod.url && cfgSnapshot.prod.hasToken) };
          setStatusEl.className = 'set-status ok';
          setStatusEl.textContent = 'บันทึกแล้ว';
          setTokenEl.value = '';
          paintSettingsTokenPlaceholder();
          // ค่าเปลี่ยนแล้ว ทิ้งของเก่าทั้งหมดแล้วดึงใหม่
          data = null; ALL = []; HIST = []; histKey = ''; overview = null; overviewKey = '';
          notConfigured = false; loadErr = null;
          if (visible()) fetchLogs();
        });
    };
  }
  function paintSettingsTokenPlaceholder() {
    const c = cfgSnapshot[setEnv] || {};
    setTokenEl.placeholder = c.hasToken ? `เก็บไว้แล้ว ${c.tokenHint} — เว้นว่างไว้ถ้าไม่เปลี่ยน` : 'glsa_… หรือ eyJrIjoi…';
  }
  function loadSettings() {
    const api = shell().api;
    if (!api || !api.getGrafanaConfig) return;
    api.getGrafanaConfig().then((c) => {
      if (!c) return;
      cfgSnapshot = c;
      envAvail = { dev: Boolean(c.dev.url && c.dev.hasToken), prod: Boolean(c.prod.url && c.prod.hasToken) };
      paintSettings();
      renderShell();
    });
  }

  global.COWORK = global.COWORK || {};
  global.COWORK.tabs = global.COWORK.tabs || {};
  global.COWORK.tabs.grafana = {
    key: 'gf', settingsCard: 'cardGrafana',
    mount, mountSettings, loadSettings, onShow, onTheme,
  };

  // เปิดทาง node --test แบบเดียวกับ datefilter.js / meetingrun.js
  // เฉพาะฟังก์ชันบริสุทธิ์ที่ไม่ต้องใช้ DOM — พวกนี้คือที่เก็บกฎที่พลาดแล้วเงียบ:
  // 4xx/5xx ห้ามถูกจัดเป็น noise · level "-" ต้องไม่หลุดไปเป็นระดับล่องหน ·
  // Go-http-client ไม่ใช่ probe · Drain ต้องไม่ทำบรรทัดหาย
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { stripAnsi, guessLevel, normLevel, parseLine, isProbe, isSql, makeDrain, needleOf };
  }
})(typeof window !== 'undefined' ? window : globalThis);
