// Turns an Android UI dump (failure.xml) into a standalone interactive viewer document,
// meant to be dropped into an <iframe srcdoc>. Renderer-side: uses DOMParser, no Node APIs.
//
// This is a JS port of the user's uidump2html.py (~/Downloads/uidump2html.py) — deliberately
// ported rather than shelled out to, because the app ships packaged via GitHub releases and a
// machine without Python on PATH would break the feature silently.
//
// Works with both dump flavours:
//   adb shell uiautomator dump  -> <node class="..." bounds="..." />
//   Appium / espresso source    -> <android.widget.Button bounds="..." />
(function (global) {
  'use strict';

  // '[0,160][1080,1920]' -> [0,160,1080,1920] (null if unparseable)
  function parseBounds(value) {
    if (!value) return null;
    const nums = String(value).match(/-?\d+/g);
    if (!nums || nums.length !== 4) return null;
    let [x1, y1, x2, y2] = nums.map(Number);
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    return [x1, y1, x2, y2];
  }

  function buildTree(elem, counter) {
    counter = counter || { n: 0 };
    const attrs = {};
    for (const a of elem.attributes) attrs[a.name] = a.value;
    const node = {
      id: counter.n++,
      tag: elem.tagName,
      // uiautomator dump puts the widget name in @class; Appium puts it in the tag
      cls: attrs['class'] || elem.tagName,
      attrs,
      box: parseBounds(attrs.bounds || ''),
      children: [],
    };
    for (const child of elem.children) node.children.push(buildTree(child, counter));
    return node;
  }

  // prefer @width/@height on <hierarchy>; otherwise fall back to the widest box found
  function screenSize(root) {
    const w0 = parseInt(root.attrs.width, 10), h0 = parseInt(root.attrs.height, 10);
    if (w0 > 0 && h0 > 0) return [w0, h0];
    let w = 0, h = 0;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n.box) { w = Math.max(w, n.box[2]); h = Math.max(h, n.box[3]); }
      stack.push(...n.children);
    }
    return [w || 1080, h || 1920];
  }

  function summarise(root) {
    const pkgs = new Set();
    let total = 0;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      total++;
      if (n.attrs.package) pkgs.add(n.attrs.package);
      stack.push(...n.children);
    }
    return { pkgs: [...pkgs].sort(), total };
  }

  // Palette — defaults reproduce the standalone script's look. Callers may pass COWORK
  // theme tokens instead so the viewer follows Carbon / Warm Sand.
  const DEFAULT_PALETTE = {
    bg: '#08131d', panel: '#0b1a26', panelSoft: 'rgba(9,22,32,.72)', line: '#16303f',
    lineSoft: '#1e3d4e', edge: '#2b5468', ink: '#cfe4ee', muted: '#5d7b8c', deep: '#22485c',
    accent: '#5fd3e8', amber: '#f2b134', rose: '#ef6f8e', clsInk: '#9fd7ea', ridInk: '#7fa9bd',
    bdInk: '#4a6c7d', fitInk: '#ffd9e3', fitClkInk: '#ffdf9c', onAccent: '#0b1a26',
    grid: 'rgba(80,160,190,.07)', shadow: 'rgba(0,0,0,.6)',
  };

  function tpl(p) {
    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UI Hierarchy</title>
<style>
:root{--grid:${p.grid}}
*{box-sizing:border-box}
body{margin:0;background:${p.bg};
  background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:24px 24px;color:${p.ink};font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
header{padding:12px 16px 10px;border-bottom:1px solid ${p.line};display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
h1{margin:0;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:${p.accent}}
.meta{color:${p.muted};font-size:11px;letter-spacing:.05em}
.chip{font-size:10px;letter-spacing:.08em;border:1px solid ${p.edge};color:${p.accent};padding:1px 7px;border-radius:99px}
.wrap{display:grid;grid-template-columns:minmax(240px,340px) 1fr;gap:18px;padding:16px;align-items:start}
@media(max-width:820px){.wrap{grid-template-columns:1fr}}
/* grid item ตั้งต้นเป็น min-width:auto — แถวใน .tree เป็น nowrap เลยดันคอลัมน์ให้กว้างเกิน
   จนทั้งหน้ามี scrollbar แนวนอน ต้องบังคับ 0 ให้ .tree เลื่อนในกรอบตัวเองแทน */
.wrap>*{min-width:0}

.stage{position:sticky;top:12px}
.phone{position:relative;width:100%;border:1px solid ${p.edge};border-radius:14px;background:${p.panel};
  overflow:hidden;box-shadow:0 0 0 6px ${p.bg},0 18px 50px ${p.shadow}}
.node{position:absolute;border:1px solid ${p.accent}47;cursor:pointer}
.node.clk{border-color:${p.amber}bf;background:${p.amber}10}
.node.txt{border-color:${p.rose}99}
.node.hot{background:${p.accent}38!important;border-color:${p.accent};box-shadow:0 0 0 1px ${p.accent} inset}
.node .fit{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
  padding:0 2px;overflow:hidden;pointer-events:none;line-height:1.15;color:${p.fitInk};font-weight:600}
.node.clk .fit{color:${p.fitClkInk}}
.node .cap{position:absolute;left:0;top:0;transform:translateY(-100%);font-size:calc(var(--u)*26px);
  padding:0 calc(var(--u)*6px);white-space:nowrap;pointer-events:none;background:${p.rose};color:${p.onAccent};
  border-radius:2px 2px 0 0;font-weight:700;letter-spacing:.04em}
.node.clk .cap{background:${p.amber}}
.node.desc{border-style:dashed}
.node.desc .fit,.node.desc .cap{font-style:italic}
.node.desc .cap{background:${p.accent}}
body.nolabel .fit,body.nolabel .cap{display:none}
body.simple .skip{display:none}
body.simple .g-full{display:none}
.g-simple{display:none}
body.simple .g-simple{display:inline}
.row.skip{opacity:.42}

.ctrl{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:11px;color:${p.muted};letter-spacing:.06em;flex-wrap:wrap}
input[type=range]{flex:1;min-width:80px;accent-color:${p.accent}}
.sw{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.sw input{accent-color:${p.accent}}
.legend{margin-top:9px;display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;color:${p.muted};letter-spacing:.05em}
.legend i{display:inline-block;width:9px;height:9px;border:1px solid;margin-right:5px;vertical-align:-1px}

.panel{border:1px solid ${p.line};background:${p.panelSoft};border-radius:8px;overflow:hidden}
.panel h2{margin:0;padding:9px 12px;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;
  color:${p.muted};border-bottom:1px solid ${p.line};font-weight:600;display:flex;gap:10px;align-items:center}
.panel h2 input{flex:1;min-width:0;background:${p.panel};border:1px solid ${p.lineSoft};color:${p.ink};border-radius:4px;
  padding:3px 8px;font:inherit;font-size:11px;letter-spacing:0;text-transform:none}
.tree{padding:8px 0;max-height:52vh;overflow:auto}
.row{display:flex;align-items:center;gap:8px;padding:2px 12px;cursor:pointer;white-space:nowrap;overflow:hidden}
.row:hover,.row.hot{background:${p.accent}1f}
.row.sel{background:${p.accent}33}
.row.hide{display:none}
.guide{color:${p.deep}}.cls{color:${p.clsInk}}.rid{color:${p.ridInk}}.tx{color:${p.rose}}.cd{color:${p.accent};font-style:italic}
.bd{color:${p.bdInk};font-size:11px}
.tag{font-size:9px;letter-spacing:.08em;padding:0 4px;border:1px solid ${p.amber};color:${p.amber};border-radius:2px}
.det{padding:12px;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:11.5px;max-height:30vh;overflow:auto}
.det dt{color:${p.muted}}.det dd{margin:0;word-break:break-all}.det .on{color:${p.amber}}
.empty{padding:14px;color:${p.muted};font-size:11.5px}
</style>
</head>
<body class="simple">
<header>
  <h1>UI Hierarchy</h1>
  <span class="meta" id="meta"></span>
  <span class="chip" id="chip"></span>
</header>

<div class="wrap">
  <div class="stage">
    <div class="phone" id="phone"></div>
    <div class="ctrl">
      <span>DEPTH</span>
      <input type="range" id="depth" min="1" max="12" value="12">
      <span id="dval">all</span>
      <label class="sw"><input type="checkbox" id="lbl" checked>LABELS</label>
      <label class="sw"><input type="checkbox" id="simp" checked>SIMPLIFY</label>
    </div>
    <div class="legend">
      <span><i style="border-color:${p.accent}"></i>container</span>
      <span><i style="border-color:${p.amber};background:${p.amber}26"></i>clickable</span>
      <span><i style="border-color:${p.rose}"></i>has text</span>
      <span><i style="border-color:${p.accent};border-style:dashed"></i>content-desc</span>
    </div>
  </div>

  <div>
    <div class="panel">
      <h2>Tree <input id="q" placeholder="filter: text / class / id"></h2>
      <div class="tree" id="tree"></div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h2>Attributes</h2>
      <div id="det" class="empty">เลือก node จาก tree หรือคลิกกล่องบนจอ</div>
    </div>
  </div>
</div>

<script>
const DATA = __DATA__;
const W = __W__, H = __H__;

const phone = document.getElementById('phone');
const tree  = document.getElementById('tree');
phone.style.aspectRatio = W + ' / ' + H;

const flat = [];
(function walk(n, d, parent){ n.depth = d; n.parent = parent; flat.push(n); n.children.forEach(c => walk(c, d + 1, n)); })(DATA, 0, null);
const nodes = flat.filter(n => n.box);

// ---------- which boxes actually carry information ----------
const GENERIC_ID = /^android:id\\//;
const bkey = n => (n && n.box) ? n.box.join(',') : null;

function isWrapper(n){
  const a = n.attrs;
  if (!n.box) return true;
  if ((a.text || '').trim() || (a['content-desc'] || '').trim()) return false;
  if (['clickable','scrollable','checkable','focused','long-clickable'].some(k => a[k] === 'true')) return false;
  if (a['resource-id'] && !GENERIC_ID.test(a['resource-id'])) return false;
  const kids = n.children.filter(c => c.box);
  if (kids.length !== 1) return false;                              // leaf or branch point = a real region
  return bkey(n) === bkey(n.parent) || bkey(n) === bkey(kids[0]);   // adds no new area
}
flat.forEach(n => n.wrap = isWrapper(n));
(function sd(n, d){ n.sdepth = d; n.children.forEach(c => sd(c, n.wrap ? d : d + 1)); })(DATA, 0);

const maxD = Math.max(1, ...flat.map(n => n.depth));
const slider = document.getElementById('depth'), dval = document.getElementById('dval');
slider.max = maxD; slider.value = maxD;
document.getElementById('meta').textContent = __META__;
document.getElementById('chip').textContent =
  nodes.filter(n => !n.wrap).length + ' / ' + nodes.length + ' boxes carry data';

// ---------- wireframe ----------
const boxEls = {}, rowEls = {};
const esc = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

nodes.forEach(n => {
  const [x1, y1, x2, y2] = n.box, a = n.attrs;
  const el = document.createElement('div');
  el.className = 'node' + (n.wrap ? ' skip' : '');
  if (a.clickable === 'true') el.classList.add('clk');
  else if ((a.text || '').trim()) el.classList.add('txt');
  el.style.left   = (x1 / W * 100) + '%';
  el.style.top    = (y1 / H * 100) + '%';
  el.style.width  = ((x2 - x1) / W * 100) + '%';
  el.style.height = ((y2 - y1) / H * 100) + '%';

  const name = (a.text || '').trim() || (a['content-desc'] || '').trim();
  if (name) {
    if (!(a.text || '').trim()) el.classList.add('desc');
    if (n.children.length === 0) {                 // leaf -> text inside the box
      const f = document.createElement('span');
      f.className = 'fit';
      f.textContent = name;
      const fs = Math.max(14, Math.min((y2 - y1) * .55, ((x2 - x1) * 1.7) / name.length, 46));
      f.style.fontSize = 'calc(var(--u) * ' + fs.toFixed(1) + 'px)';
      el.appendChild(f);
    } else {                                       // container -> caption on the frame
      const c = document.createElement('span');
      c.className = 'cap';
      c.textContent = name;
      el.appendChild(c);
    }
  }
  el.onmouseenter = () => hover(n.id, true);
  el.onmouseleave = () => hover(n.id, false);
  el.onclick = e => { e.stopPropagation(); select(n); };
  phone.appendChild(el);
  boxEls[n.id] = el;
});

// ---------- tree ----------
flat.forEach(n => {
  if (n === DATA) return;
  const a = n.attrs;
  const short = (n.cls || n.tag).split('.').pop();
  const rid = (a['resource-id'] || '').split('/').pop();
  const row = document.createElement('div');
  row.className = 'row' + (n.wrap ? ' skip' : '');
  row.innerHTML =
    '<span class="guide g-full">'   + '│ '.repeat(Math.max(0, n.depth  - 1)) + '├─</span>' +
    '<span class="guide g-simple">' + '│ '.repeat(Math.max(0, n.sdepth - 1)) + '├─</span>' +
    '<span class="cls">' + esc(short) + '</span>' +
    (rid ? '<span class="rid">#' + esc(rid) + '</span>' : '') +
    ((a.text || '').trim() ? '<span class="tx">“' + esc(a.text) + '”</span>' : '') +
    ((a['content-desc'] || '').trim() ? '<span class="cd">⟨' + esc(a['content-desc']) + '⟩</span>' : '') +
    (a.clickable === 'true' ? '<span class="tag">CLICK</span>' : '') +
    '<span class="bd">' + (a.bounds || '') + '</span>';
  row.dataset.hay = (short + ' ' + rid + ' ' + (a.text || '') + ' ' + (a['content-desc'] || '')).toLowerCase();
  row.onmouseenter = () => hover(n.id, true);
  row.onmouseleave = () => hover(n.id, false);
  row.onclick = () => select(n);
  tree.appendChild(row);
  rowEls[n.id] = row;
});

function hover(id, on){
  if (boxEls[id]) boxEls[id].classList.toggle('hot', on);
  if (rowEls[id]) rowEls[id].classList.toggle('hot', on);
}

let cur = null;
function select(n){
  if (cur !== null && rowEls[cur]) rowEls[cur].classList.remove('sel');
  cur = n.id;
  if (rowEls[n.id]) { rowEls[n.id].classList.add('sel'); rowEls[n.id].scrollIntoView({block: 'nearest'}); }
  const det = document.getElementById('det');
  det.className = 'det'; det.innerHTML = '';
  Object.entries(n.attrs).forEach(([k, v]) => {
    if (v === 'false' || v === '') return;
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (v === 'true') dd.className = 'on';
    det.append(dt, dd);
  });
}

// ---------- controls ----------
document.getElementById('lbl').onchange  = e => document.body.classList.toggle('nolabel', !e.target.checked);
document.getElementById('simp').onchange = e => document.body.classList.toggle('simple',   e.target.checked);
slider.oninput = () => {
  const d = +slider.value;
  dval.textContent = d >= maxD ? 'all' : d;
  nodes.forEach(n => boxEls[n.id].style.display = n.depth <= d ? '' : 'none');
};
document.getElementById('q').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  flat.forEach(n => {
    const r = rowEls[n.id];
    if (r) r.classList.toggle('hide', !!q && !r.dataset.hay.includes(q));
  });
};

const setU = () => phone.style.setProperty('--u', (phone.clientWidth / W).toFixed(5));
new ResizeObserver(setU).observe(phone);
setU();
<\/script>
</body>
</html>`;
  }

  // xmlText -> full HTML document string, ready for <iframe srcdoc>.
  // Throws on unparseable XML so the caller can show its own error state.
  function uidumpHtml(xmlText, opts) {
    opts = opts || {};
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const bad = doc.querySelector('parsererror');
    if (bad) throw new Error('XML ไม่ถูกต้อง: ' + (bad.textContent || '').trim().slice(0, 200));
    const rootEl = doc.documentElement;
    if (!rootEl) throw new Error('XML ว่างเปล่า');

    const tree = buildTree(rootEl);
    const [w, h] = screenSize(tree);
    const { pkgs, total } = summarise(tree);
    const meta = [
      opts.label || 'failure.xml',
      pkgs.slice(0, 2).join(', ') + (pkgs.length > 2 ? '…' : ''),
      total + ' nodes',
      w + '×' + h,
    ].filter(Boolean).join(' · ');

    const palette = Object.assign({}, DEFAULT_PALETTE, opts.palette || {});
    // </ inside the JSON would close the <script> block early
    const payload = JSON.stringify(tree).replace(/<\//g, '<\\/');
    return tpl(palette)
      .replace('__DATA__', payload)
      .replace('__META__', JSON.stringify(meta))
      .replace('__W__', String(w))
      .replace('__H__', String(h));
  }

  global.uidumpHtml = uidumpHtml;
  global.uidumpDefaultPalette = DEFAULT_PALETTE;
})(window);
