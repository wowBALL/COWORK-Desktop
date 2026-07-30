// Grafana / Loki reader for the Grafana tab — main process only, so the API token
// never reaches the renderer. Same shape as workspace.js / meetings.js / qatest.js:
// pure data in, plain objects out, no Electron imports.
//
// Everything here was verified against the real mondev instance before being written.
// See docs/superpowers/specs/2026-07-30-grafana-tab-design.md
//
// The instance is Grafana 9.3.8 OSS with **Loki 2.6.1** behind it, which is what
// actually constrains the queries:
//   • `drop`, `decolorize`, `approx_topk` do not exist (2.9+/3.x) — ANSI colour codes
//     must be stripped in the renderer, they cannot be removed server-side
//   • Grafana's automatic "Log patterns" needs Loki 3.x, so the pattern mining
//     (Drain) lives in the renderer instead
//   • chained comparisons are a parse error: `| status>=400 < 500` must be written
//     as two filters, `| status>=400 | status<500`
//
// Three guards appear on nearly every query below. Each of them returns a wrong
// number *silently* if you forget it, which is why they are not optional:
//   1. `| json | __error__=""` — several apps interleave non-JSON lines into the same
//      stream. Without the guard one unparseable line poisons the whole aggregation
//      with JSONParserErr and a naive caller reads the result as 0.
//   2. `| latency!=""` before `unwrap latency` — otherwise SampleExtractionErr kills
//      the query on any line lacking the field.
//   3. the selector must name our apps explicitly, never `{app=~".+"}`. Loki logs
//      every query it serves, including the query text, so a regex looking for
//      "error" matches Loki's own log of our `__error__=""` — that manufactured a
//      convincing ×24 error spike during design. The ingress logs the HTTP request too.

'use strict';

// Apps this tab is about, grouped the way the UI offers them. Everything else in the
// `app` label is cluster infrastructure (calico, etcd, apisix, casdoor, zitadel,
// promtail, grafana, loki…) and is deliberately not listed: `loki` alone emits more
// lines per hour than every real service combined, and including it buries the rest.
const APP_GROUPS = {
  payment:   ['payment-api', 'payment-cms', 'payment-cms-api', 'payment-gateway', 'payment-worker'],
  menutable: ['menutable-api', 'menutable-cms'],
  wallet:    ['wallet-api'],
  other:     ['ms-airalo', 'saas-ai-backend', 'tw'],
};
const ALL_APPS = Object.values(APP_GROUPS).flat();

// ช่วงเวลาที่หน้าจอให้เลือก (นาที) — Loki เก็บย้อนหลังได้ ≥90 วัน เพดานจริงคือ "รอไหว"
// ไม่ใช่ "มีข้อมูลไหม" วัดมาแล้ว: 7 วันด้วยวิธีสแกนต่อเนื่องใช้ 46 วินาที ซึ่งใช้งานจริงไม่ได้
// จึงตัดออก และเพดานอยู่ที่ 3 วัน ส่วนที่ยาวกว่านั้นให้กรอกวันเวลาเองเป็นครั้ง ๆ ไป
const RANGES = { '15m': 15, '30m': 30, '1h': 60, '1d': 1440, '2d': 2880, '3d': 4320 };
// จำนวนหน้าต่างตรวจและความยาวของแต่ละอัน ตอนที่ช่วงเวลากว้างกว่าที่ดึงหมดได้
// วัดกับ mondev (ช่วง 3 วัน): สแกนต่อเนื่อง 12 slice = 29.6s ได้ 3000 บรรทัด ครอบ 2.78 วัน
//                            หน้าต่างตรวจ 12×15 นาที = 4.7s ได้ 622 บรรทัด ครอบ 2.76 วัน
// เร็วขึ้น 6 เท่าโดยครอบช่วงได้เท่ากัน เพราะไม่ต้องสแกนทั้งช่วง แค่เจาะเป็นจุด ๆ
// จำนวนบรรทัดที่ได้น้อยลงไม่เป็นไร เพราะ "ตัวเลข" มาจาก windowSummary ซึ่งเป็นค่าจริงทั้งช่วง
// ช่วงที่กว้างกว่านี้ให้สุ่มเสมอ ไม่ต้องนับก่อน — 1 ชั่วโมงบนคลัสเตอร์นี้มีราว 26,000 บรรทัด
// ซึ่งเกินเพดานที่ดึงได้อยู่แล้ว การนับเพื่อยืนยันจึงเป็นการจ่ายเวลาเพื่อคำตอบที่รู้อยู่แล้ว
const SAMPLE_ABOVE_MINUTES = 60;
const PROBES = 10;
const PROBE_MINUTES = 12;

const nsOf = (ms) => String(Math.round(ms) * 1e6);
// ตัวคั่นสำหรับคีย์ dedupe — ต้องเป็นอักขระที่ไม่มีทางโผล่ใน log จริง
const KEY_SEP = '\u0001';
const escLit = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// A backtick-quoted LogQL string can hold anything except a backtick, which cannot be
// escaped inside one. Regex-quote the term and drop backticks rather than switch to
// double quotes, where every backslash would need doubling as well.
const escRe = (s) => String(s).replace(/`/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function selectorFor(apps) {
  const list = (apps && apps.length ? apps : ALL_APPS).filter(a => ALL_APPS.includes(a));
  // An empty result would mean `{app=~""}`, which matches nothing and looks like an
  // outage. Fall back to the full set instead.
  return `{app=~"${(list.length ? list : ALL_APPS).join('|')}"}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Grafana {
  constructor({ url, token }) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.token = String(token || '');
    this.lokiUid = null;
    // Requests go through a semaphore, not a single chain. Loki 2.6.1 here answers
    // **HTTP 429 "too many outstanding requests"** when pushed — five parallel instant
    // queries was enough to fail four of them — but measured limits: 20 queries across
    // 2 lanes and 24 across 3 lanes all succeeded. So 3 is safe, and it matters a lot:
    // a sampled range is 10 probe queries, and at ~1.2s each serial that is 12s of
    // waiting for something three lanes finish in about four.
    // The retry below is the safety net if the real limit turns out to be lower.
    this.limit = 3;
    this.active = 0;
    this.waiting = [];
  }

  // Bounded concurrency + retry on the two failures worth retrying: 429 (we asked too
  // fast) and 5xx from Grafana itself (transient). Anything else — 401, a bad query —
  // is a real answer and must surface immediately rather than after three waits.
  enqueue(fn) {
    const run = async () => {
      let lastErr;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { return await fn(); }
        catch (e) {
          lastErr = e;
          if (!/HTTP (429|5\d\d)/.test(e.message)) throw e;
          await sleep(300 * (attempt + 1) * (attempt + 1));
        }
      }
      throw lastErr;
    };
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        run().then(resolve, reject).finally(() => {
          this.active--;
          const next = this.waiting.shift();
          if (next) next();
        });
      };
      if (this.active < this.limit) start();
      else this.waiting.push(start);
    });
  }

  get configured() { return Boolean(this.url && this.token); }

  // An HTTP header value must be Latin-1. A token pasted with a Thai character in it
  // (or with the surrounding UI text copied by accident) makes fetch throw
  // "Cannot convert argument to a ByteString…", which tells the user nothing.
  // The settings card lets people paste anything, so this has to be checked here.
  tokenProblem() {
    if (/\s/.test(this.token)) return 'token มีช่องว่างหรือขึ้นบรรทัดใหม่ปนอยู่ — ต้องเป็นบรรทัดเดียวติดกัน';
    if (/[^\x20-\xFF]/.test(this.token)) return 'token มีอักขระที่ไม่ใช่ภาษาอังกฤษปนอยู่ — น่าจะ copy ข้อความรอบ ๆ ติดมาด้วย';
    return null;
  }

  req(pathname, opts) { return this.enqueue(() => this.rawReq(pathname, opts)); }

  async rawReq(pathname, { timeoutMs = 30000 } = {}) {
    if (!this.configured) throw new Error('ยังไม่ได้ตั้งค่า Grafana');
    const tp = this.tokenProblem();
    if (tp) throw new Error(tp);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(this.url + pathname, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: ctl.signal,
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      if (!res.ok) {
        const msg = (body && body.message) || (typeof body === 'string' ? body.slice(0, 200) : '');
        throw new Error(`HTTP ${res.status}${msg ? ' — ' + msg : ''}`);
      }
      return body;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('หมดเวลารอ Grafana');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // The Loki datasource uid differs per instance, so it is discovered rather than
  // hardcoded — a hardcoded uid works on mondev and silently 404s everywhere else.
  resolveLoki() {
    if (this.lokiUid) return Promise.resolve(this.lokiUid);
    // Memoise the in-flight lookup, not just the result: several queries starting at
    // once would each fire their own /api/datasources before the first one answered.
    if (!this.lokiP) {
      this.lokiP = (async () => {
        const list = await this.req('/api/datasources');
        const loki = (Array.isArray(list) ? list : []).find(d => /^loki$/i.test(d.type));
        if (!loki) throw new Error('Grafana ตัวนี้ไม่มี datasource ชนิด Loki');
        this.lokiUid = loki.uid;
        return this.lokiUid;
      })().catch(e => { this.lokiP = null; throw e; });   // let a failure be retried
    }
    return this.lokiP;
  }

  async loki(pathname, params, opts) {
    const uid = await this.resolveLoki();
    const qs = params ? '?' + new URLSearchParams(params) : '';
    return this.req(`/api/datasources/proxy/uid/${uid}/loki/api/v1${pathname}${qs}`, opts);
  }

  // `/api/health` answers without a token, so it proves only that the host is up.
  // `/api/datasources` is what proves the token works. `/api/user` is NOT usable here:
  // it returns 404 "user not found" for API-key and service-account tokens, which
  // looks exactly like a broken token and is not.
  async test() {
    const health = await this.req('/api/health', { timeoutMs: 10000 });
    const list = await this.req('/api/datasources', { timeoutMs: 10000 });
    const names = (Array.isArray(list) ? list : []).map(d => `${d.name} (${d.type})`);
    const loki = (Array.isArray(list) ? list : []).find(d => /^loki$/i.test(d.type));
    return {
      version: (health && health.version) || '?',
      datasources: names,
      lokiFound: Boolean(loki),
      lokiName: loki ? loki.name : null,
    };
  }

  // ---- log lines ----------------------------------------------------------------
  //
  // Two modes, because at this cluster's volume a single mode has to lie about
  // something. Measured over 24h on the apps above: 651,676 lines total. Dropping
  // health probes and GORM SQL only gets that to 454,793 — `payment-worker` alone is
  // 259,228 of them. So "the most recent 3000 lines" covers **15 minutes of a 24-hour
  // range**, and a chip reading `24h` above it would be a lie.
  //
  //   mode 'issues' (default) — a server-side filter for lines that are actually a
  //     problem: non-2xx responses plus ERROR/WARN/exception/panic/fatal app lines.
  //     24h → 9,169 lines, so a range chip means what it says. Verified lossless for
  //     what matters: 5xx and `"level":"ERROR"` counts are identical before and after.
  //   mode 'all' — no such filter. Honest but inherently a recent-lines view; the
  //     caller gets windowTotal/coveredFrom so the UI can say so instead of implying
  //     full coverage.
  //
  // Level filtering and the noise toggles still happen in the renderer: the chip
  // counts describe the fetched set, and the "your result is hidden by another filter"
  // banner can only exist if the hidden lines were actually fetched.
  //
  // `search` becomes one case-insensitive `|~` per term (AND across terms) so that
  // multi-word search reaches the whole retention window, not just the page already
  // in the renderer.
  //
  // Careful with regex-based error counting: **every Echo access log line carries an
  // `error` field**, so `|~ "(?i)error"` matches all 103,517 access lines in 24h and
  // not the 22,041 real ones. That is why the filter below keys on `"level":"ERROR"`
  // and word-boundary ERROR/WARN rather than the bare substring.
  static issuesFilter() {
    return ' !~ `"status":[23]` != "[rows:"'
      + ' |~ `(?i)"level":"(ERROR|WARN)"|\\bERROR\\b|\\bWARN\\b|exception|panic|fatal|"status":[45]`';
  }

  // `from`/`to` (ms) ถ้าส่งมาจะชนะ rangeKey — ใช้กับช่วงเวลาที่ผู้ใช้กำหนดวันเอง
  // เก็บไว้ที่นี่ที่เดียว ไม่ให้ทุก method ต้องคิดเรื่องนี้เอง
  static windowOf({ rangeKey = '1h', from, to } = {}) {
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      const minutes = Math.max(1, Math.round((to - from) / 60000));
      return { start: from, end: to, minutes, absolute: true };
    }
    const minutes = RANGES[rangeKey] || RANGES['1h'];
    const end = Date.now();
    return { start: end - minutes * 60000, end, minutes, absolute: false };
  }
  // LogQL duration สำหรับ count_over_time — ต้องครอบทั้งช่วงพอดี
  static durOf(minutes) {
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  }

  async queryLogs({ apps, rangeKey = '1h', from, to, search = '', limit = 3000, mode = 'issues' } = {}) {
    const w = Grafana.windowOf({ rangeKey, from, to });
    const minutes = w.minutes, start = w.start, end = w.end;
    const cap = Math.min(Math.max(Number(limit) || 3000, 50), 5000);

    const sel = selectorFor(apps);
    let expr = sel + (mode === 'issues' ? Grafana.issuesFilter() : '');
    for (const term of String(search).trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      expr += ` |~ \`(?i)${escRe(term)}\``;
    }

    // ไม่นับอะไรที่นี่เลย — เมื่อก่อนยิง count 2 ตัวก่อนดึงบรรทัด และเพราะคิวเป็น serial
    // มันกลายเป็นตัวบล็อก: ช่วง 3 วันเสียไปราว 11 วินาทีแค่กับการนับ ทั้งที่ผู้ใช้อยากเห็นรายการ
    // ตัวเลขทั้งหมดย้ายไป windowSummary() ซึ่งฝั่ง main รันบนอีก client ขนานกันไป
    //
    // การตัดสินว่าจะสุ่มหรือไม่จึงดูจาก "ความกว้างของช่วง" แทนยอดนับ — บนคลัสเตอร์นี้
    // ช่วงเกิน 1 ชั่วโมงไม่มีทางดึงหมดใน ${cap} บรรทัดอยู่แล้ว (1 ชั่วโมงมีราว 26,000 บรรทัด)
    const needSample = minutes > SAMPLE_ABOVE_MINUTES;
    const chunks = needSample ? PROBES : 1;
    const perChunk = Math.max(1, Math.floor(cap / chunks));
    const spanMs = (end - start) / chunks;
    // ไม่สแกน slice เต็ม ๆ — เจาะแค่ท้าย slice ยาว PROBE_MINUTES นาที
    // ต้นทุนของ query_range โตตามความกว้างที่สแกน ไม่ใช่ตาม limit จึงเป็นจุดที่ประหยัดได้จริง
    const probeMs = Math.min(spanMs, PROBE_MINUTES * 60000);

    // ยิงทุกหน้าต่างตรวจพร้อมกัน แล้วให้ semaphore เป็นตัวคุมว่าวิ่งจริงกี่ตัว —
    // ถ้า await เรียงทีละอันในลูป ตัวคุมจะไม่มีอะไรให้คุม และ 10 หน้าต่างจะกลายเป็น 10 คิว
    const bodies = await Promise.all(
      Array.from({ length: chunks }, (_, i) => {
        const ce = chunks === 1 ? end : start + (i + 1) * spanMs;
        const cs = chunks === 1 ? start : Math.max(start, ce - probeMs);
        return this.loki('/query_range', {
          query: expr, start: nsOf(cs), end: nsOf(ce),
          limit: String(chunks === 1 ? cap : perChunk), direction: 'backward',
        }, { timeoutMs: 45000 }).catch((e) => {
          // หน้าต่างเดียวล้มต้องไม่ทำให้ทั้งช่วงหาย · ถ้าเป็นการยิงเดี่ยว (ไม่สุ่ม) ล้มคือล้มจริง
          if (chunks === 1) throw e;
          return null;
        });
      }));

    const seen = new Set();
    const lines = [];
    for (const body of bodies) {
      if (!body) continue;
      for (const stream of (body && body.data && body.data.result) || []) {
        const s = stream.stream || {};
        for (const [tsNs, line] of stream.values || []) {
          const ts = new Date(Number(tsNs) / 1e6).toISOString();
          const k = ts + KEY_SEP + (s.pod || '') + KEY_SEP + line;
          if (seen.has(k)) continue;         // ขอบ slice ทับกันได้ตรงมิลลิวินาทีเดียวกัน
          seen.add(k);
          lines.push({
            app: s.app || '?', pod: s.pod || '', container: s.container || '',
            ns: s.namespace || '', stream: s.stream || '', ts, line,
          });
        }
      }
    }
    lines.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return {
      lines, mode,
      // truncated = "ยังไม่ได้เห็นทุกบรรทัดในช่วงนี้" · sampled = "ที่เห็นกระจายทั่วช่วง
      // ไม่ใช่กระจุกอยู่ท้าย" — สองอย่างนี้ต้องบอกคนละแบบ คำแนะนำที่ตามมาไม่เหมือนกัน
      // ครบหรือไม่ ตัดสินได้จริงเมื่อรู้ยอดของทั้งช่วง ซึ่งมาจาก windowSummary ทีหลัง
      // ที่นี่บอกได้แค่ว่า "ดึงมาเต็มเพดานแล้ว" หรือ "สุ่มมา" ห้ามเดาว่าครบ
      truncated: chunks > 1 || lines.length >= cap,
      sampled: chunks > 1,
      chunks,
      probeMinutes: chunks > 1 ? Math.round(probeMs / 60000) : null,
      limit: cap,
      coveredFrom: lines.length ? lines[lines.length - 1].ts : null,
      coveredTo: lines.length ? lines[0].ts : null,
      rangeKey, windowMinutes: minutes,
      windowFrom: new Date(start).toISOString(),
      queriedAt: new Date(end).toISOString(),
    };
  }


  // นับต่อระดับ "ทั้งช่วง" ด้วย aggregation ไม่ใช่จากบรรทัดที่ดึงมา
  //
  // จำเป็นเพราะเมื่อช่วงเวลากว้าง queryLogs คืนเป็น *กลุ่มตัวอย่าง* ที่กระจายทั่วช่วง และ
  // ตัวอย่างนั้นเอียงตามแอปที่พ่น log ถี่สุดในแต่ละ slice: ที่ 7 วัน menutable-api กิน
  // 2,406 จาก 2,997 บรรทัด ทำให้เลข Error ในแถบสรุปเหลือ 181 ทั้งที่ของจริงเป็นหลักหมื่น
  // การเอาเลขจากตัวอย่างไปโชว์เป็นยอดรวมคือตัวเลขที่โกหก — ต้องถาม Loki ตรง ๆ
  //
  // ระดับที่นับต้องตรงกับที่ฝั่งหน้าจอจัด: appError ไม่รวม err2xx เพราะ normLevel()
  // ย้ายบรรทัด ERROR ที่บอกว่า upstream ตอบ 2xx ออกไปเป็นระดับ 2xx แล้ว
  async windowSummary({ apps, rangeKey = '1h', from, to, search = '', mode = 'issues' } = {}) {
    const w = Grafana.windowOf({ rangeKey, from, to });
    const win = Grafana.durOf(w.minutes);
    const sel = selectorFor(apps);
    let base = sel + (mode === 'issues' ? Grafana.issuesFilter() : '');
    for (const term of String(search).trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      base += ` |~ \`(?i)${escRe(term)}\``;
    }
    // 3 query แทน 6 — ถูกกว่าและได้มากกว่า:
    //   sum by (level)  → ERROR / WARN / ที่ไม่มี level
    //   sum by (status) → ทุก status code ที่มีจริง ไม่ใช่แค่ยอดรวม 4xx/5xx
    //   err2xx          → ERROR ที่ upstream ตอบ 2xx (ต้องดูเนื้อข้อความ จัดกลุ่มด้วย label ไม่ได้)
    // ตรวจแล้วว่า | json ครอบบรรทัดที่เป็นปัญหา 100% บนคลัสเตอร์นี้ (28,014/28,014 ที่ 72 ชม.)
    // จึงเอายอดรวมจาก sum by (level) มาใช้เป็น total ได้ ไม่ต้องยิงนับซ้ำอีกตัว
    const J = base + ' | json | __error__=""';
    const [tot, lv, st, e2] = await Promise.all([
      // total มี query ของตัวเอง ไม่เอายอดรวมของ sum by (level) มาใช้แทน
      // ตรวจแล้วว่าสองทางให้ค่าเท่ากัน (4 รูปแบบ รวมถึง query ที่ไฟล์นี้ส่งจริง ได้ 19,114 ตรงกัน)
      // แต่ยอดรวมจาก sum by ขึ้นกับว่า | json แตกบรรทัดเป็น series อย่างไร ซึ่งเปลี่ยนได้
      // ตามรูปร่าง log ที่แอปพ่นออกมา — query นับตรง ๆ ไม่มีเงื่อนไขนั้น และวิ่งขนานอยู่แล้ว
      this.instant(`sum(count_over_time(${base} [${win}]))`, w.end)
        .then(Grafana.firstValue).catch(() => null),
      this.instant(`sum by (level) (count_over_time(${J} [${win}]))`, w.end)
        .then(r => Object.fromEntries(r.map(x => [String(x.metric.level || ''), Number(x.value[1])])))
        .catch(() => null),
      this.instant(`sum by (status) (count_over_time(${J} [${win}]))`, w.end)
        .then(r => Object.fromEntries(r.map(x => [String(x.metric.status || ''), Number(x.value[1])])))
        .catch(() => null),
      this.instant(`sum(count_over_time(${base} |~ \`"level":"ERROR"\` |~ \`code[ =:(]*2[0-9][0-9]\` [${win}]))`, w.end)
        .then(Grafana.firstValue).catch(() => null),
    ]);

    const sumOf = (obj, pred) => obj
      ? Object.entries(obj).reduce((a, [k, v]) => a + (pred(k) ? v : 0), 0)
      : null;
    const errRaw = lv ? (lv.ERROR || 0) : null;
    const out = {
      windowMinutes: w.minutes,
      from: new Date(w.start).toISOString(),
      to: new Date(w.end).toISOString(),
      total: tot,
      // appError ต้องหัก err2xx ออก เพราะฝั่งหน้าจอ normLevel() ย้ายบรรทัด ERROR ที่บอกว่า
      // upstream ตอบ 2xx ไปเป็นระดับ 2xx แล้ว ถ้าไม่หักจะนับซ้ำสองที่
      appError: errRaw == null ? null : Math.max(0, errRaw - (e2 || 0)),
      err2xx: e2,
      appWarn: lv ? (lv.WARN || 0) : null,
      err5xx: sumOf(st, k => /^5\d\d$/.test(k)),
      err4xx: sumOf(st, k => /^4\d\d$/.test(k)),
      statusSeen: st,     // เผื่อหน้าจออยาก breakdown ราย code (401 auth ล้ม ต่างจาก 404 บอตสแกน)
    };
    return out;
  }

  // Which problems exist in the window, as aggregations rather than lines — this is
  // what lets the tab answer "what is broken in the last 7 days" without fetching
  // 2.3 million lines. Grouped by app so the UI can attribute them.
  async issueCounts({ apps, rangeKey = '24h', from, to } = {}) {
    const minutes = Grafana.windowOf({ rangeKey, from, to }).minutes;
    const win = Grafana.durOf(minutes);
    const sel = selectorFor(apps);
    const classes = {
      err5xx: '|~ `"status":5`',
      err4xx: '|~ `"status":4`',
      appError: '|~ `"level":"ERROR"`',
      appWarn: '|~ `"level":"WARN"`',
      // "upstream answered 2xx and the work still failed" — Odoo returns HTTP 200 with
      // an error body, 33,400 times a week on menutable-api. Folded into one ERROR
      // total it is invisible.
      err2xx: '|~ `"level":"ERROR"` |~ `code[ =:(]*2[0-9][0-9]`',
    };
    const out = {};
    await Promise.all(Object.entries(classes).map(async ([k, f]) => {
      try {
        const res = await this.instant(`sum by (app) (count_over_time(${sel} ${f} [${win}]))`);
        out[k] = Object.fromEntries(res.map(x => [x.metric.app, Number(x.value[1])]));
      } catch { out[k] = null; }
    }));
    return out;
  }

  // ---- overview: history, slow endpoints, status inventory ----------------------
  //
  // Expensive (dozens of queries), so main caches it. Split from queryLogs so the log
  // list can paint immediately and this can land afterwards.

  async instant(query, atMs) {
    const body = await this.loki('/query', { query, time: nsOf(atMs || Date.now()) });
    return (body && body.data && body.data.result) || [];
  }
  static firstValue(result) {
    return Number((result[0] && result[0].value && result[0].value[1]) || 0);
  }

  // Per-problem daily counts over the last `days` days. Comparing a signature's count
  // per day is the single most useful triage signal on this cluster: it separates a
  // cron job that has been failing 1537×/day for over a week from a regression that
  // first appeared today with 2 occurrences — which absolute counts rank dead last.
  //
  // `needle` is a literal substring of the message, matched with `|=` (faster than a
  // regex and nothing to escape). Deliberately a line filter and not `| json`: on a
  // mixed-format stream the json parser trap above turns a real count into 0.
  async history(problems, days = 8) {
    // ปัญหาแต่ละตัวไล่วันเรียงกัน แต่หลายปัญหาไปพร้อมกันได้ — semaphore คุมเพดานอยู่แล้ว
    // ก่อนหน้านี้ 6 ปัญหา × 8 วัน = 48 query เรียงกันใช้ 14 วินาที
    const settled = await Promise.all(problems.map(async (p) => {
      const filters = p.level === '5xx'
        ? `|= "${escLit(p.needle)}" |= "\\"status\\":5"`
        : `|= "${escLit(p.needle)}"`;
      const sel = `{app="${escLit(p.app)}"} ${filters}`;
      const counts = [];
      let failed = false;
      for (let d = 0; d < days; d++) {
        try {
          counts.push(Grafana.firstValue(
            await this.instant(`sum(count_over_time(${sel} [24h]))`, Date.now() - d * 864e5)));
        } catch { failed = true; break; }
      }
      if (failed) return null;
      return {
        app: p.app, needle: p.needle, level: p.level,
        days: counts,
        activeDays: counts.filter(v => v > 0).length,
        // "new today" means it happened today and on none of the days checked before.
        newToday: counts[0] > 0 && counts.slice(1).every(v => v === 0),
        // Say "every day we looked", not "chronic" — the window is what it is.
        chronic: counts.every(v => v > 0),
      };
    }));
    return settled.filter(Boolean);
  }

  // Requests that succeed but are slow — a whole class of problem no error view can
  // see. Overall p95 looks harmless because health probes dominate, so this is per
  // endpoint. p50 and the request count travel with p95 because p95 alone misleads:
  // p95 from a single request *is* that request, and p95 high with p50 low means
  // "slow sometimes" while both high means "slow every time" — different bugs.
  async slowEndpoints({ apps, rangeKey = '24h', from, to, topk = 14 } = {}) {
    const minutes = Grafana.windowOf({ rangeKey, from, to }).minutes;
    const win = Grafana.durOf(minutes);
    const base = `${selectorFor(apps)} | json | __error__="" | latency!=""`;
    const [p95, p50, cnt] = await Promise.all([
      this.instant(`topk(${topk}, quantile_over_time(0.95, ${base} | unwrap latency [${win}]) by (app,uri))`),
      this.instant(`quantile_over_time(0.50, ${base} | unwrap latency [${win}]) by (app,uri)`),
      this.instant(`sum by (app,uri) (count_over_time(${base} [${win}]))`),
    ]);
    const key = m => `${m.app} ${m.uri}`;
    const p50m = {}, cntm = {};
    for (const x of p50) p50m[key(x.metric)] = Number(x.value[1]);
    for (const x of cnt) cntm[key(x.metric)] = Number(x.value[1]);
    const rows = [];
    for (const x of p95) {
      const uri = x.metric.uri || '';
      // Probes are fast and numerous; they are not what this section is for.
      if (/\/(healthz|health|live|liveness|ready|readiness|metrics)\b/i.test(uri)) continue;
      const k = key(x.metric);
      rows.push({
        app: x.metric.app, uri,
        // `latency` is nanoseconds.
        p95ms: +(Number(x.value[1]) / 1e6).toFixed(1),
        p50ms: p50m[k] != null ? +(p50m[k] / 1e6).toFixed(1) : null,
        count: cntm[k] != null ? Math.round(cntm[k]) : null,
      });
    }
    rows.sort((a, b) => b.p95ms - a.p95ms);
    return rows;
  }

  // What status codes actually exist, so the UI builds buckets from fact instead of
  // assuming 2xx/4xx/5xx. On mondev over 7 days there is no 3xx at all, 500 is the
  // only 5xx, and the largest bucket by far has no `status` field — those are app
  // logs rather than access logs, and treating "missing" as a status value is wrong.
  async statusInventory({ apps, rangeKey = '24h', from, to } = {}) {
    const minutes = Grafana.windowOf({ rangeKey, from, to }).minutes;
    const win = Grafana.durOf(minutes);
    const res = await this.instant(
      `sum by (status) (count_over_time(${selectorFor(apps)} | json | __error__="" [${win}]))`);
    const out = {};
    for (const x of res) out[x.metric.status || ''] = Number(x.value[1]);
    return out;
  }
}

module.exports = { Grafana, APP_GROUPS, ALL_APPS, RANGES };
