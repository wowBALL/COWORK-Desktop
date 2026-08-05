// Reads the A_Workspace markdown vault (projects / daily / lessons / playbooks)
// into a plain object for the Workspace tab. Pure fs/path — no Electron needed,
// so it can be run/tested standalone with `node workspace.js <dir>`.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['_TEMPLATE.md', 'README.md', 'INDEX.md', 'HOME.md']);

// แยก YAML frontmatter (--- ... ---) ออกจากเนื้อความ — พาร์สเฉพาะ subset ที่ vault ใช้จริง
// (scalar string, flow-sequence [a, b], block list ด้วย "- ") ไม่ใช่ YAML เต็มรูปแบบ
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: content };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) { i++; continue; }
    const [, key, rawValue] = kv;
    if (rawValue.startsWith('[') && rawValue.endsWith(']') && !rawValue.startsWith('[[')) {
      // flow sequence: [a, b, "c"] — but NOT a bare `[[wikilink]]` scalar, which also
      // starts/ends with brackets and would otherwise get corrupted into a 1-item array
      // with its outer link brackets stripped (e.g. "related: [[Some Note]]" → ["[Some Note]"])
      data[key] = rawValue.slice(1, -1).split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
      i++;
    } else if (rawValue === '') {
      // possible block list on following indented "- " lines
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(lines[j].replace(/^\s*-\s+/, '').trim().replace(/^"(.*)"$/, '$1'));
        j++;
      }
      if (items.length) { data[key] = items; i = j; }
      else { data[key] = ''; i++; }
    } else {
      data[key] = rawValue.replace(/^"(.*)"$/, '$1');
      i++;
    }
  }
  const body = content.slice(m[0].length);
  return { data, body };
}

// map the emoji in the "สถานะ" table cell OR frontmatter status: value to a stable key
function statusKey(raw) {
  if (!raw) return 'unknown';
  const s = String(raw).trim().toLowerCase();
  if (raw.includes && raw.includes('🟢')) return 'active';
  if (raw.includes && raw.includes('🟡')) return 'pause';
  if (raw.includes && raw.includes('⛔')) return 'dropped';
  if (raw.includes && raw.includes('✅')) return 'done';
  if (s === 'active') return 'active';
  if (s === 'paused') return 'pause';
  if (s === 'done') return 'done';
  if (s === 'dropped') return 'dropped';
  return 'unknown';
}

function visLabel(v) {
  if (v === 'public') return 'Public';
  if (v === 'private') return 'Private';
  return 'None';
}

// value cell of a 2-column markdown table row whose label cell contains `label`
function tableValue(content, label) {
  for (const line of content.split('\n')) {
    if (line.includes(label) && line.includes('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      // cells = [labelCell, valueCell]; label lives in cells[0]
      if (cells.length >= 2) return cells[cells.length - 1];
      return '';
    }
  }
  return '';
}

// body of a `## heading` section, comments stripped, newlines collapsed
function section(content, heading) {
  const lines = content.split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    out.push(lines[i]);
  }
  return out.join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')       // drop HTML comments
    .replace(/\s+/g, ' ')                  // collapse whitespace
    .trim();
}

function firstHeading(content, fallback) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function readDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

// recursively collect *.md files under dir
function walkMd(dir) {
  const out = [];
  for (const name of readDir(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (name.endsWith('.md') && !SKIP.has(name)) out.push(full);
  }
  return out;
}

function parseProject(file, folderVisibilityFallback) {
  const content = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(content);
  const name = firstHeading(body, path.basename(file, '.md'));
  const hasFrontmatter = Object.keys(data).length > 0;
  return {
    name,
    visibility: hasFrontmatter ? visLabel(data.repo_visibility) : (folderVisibilityFallback || 'None'),
    repo: data.repo || '',
    status: statusKey(data.status || tableValue(body, '**สถานะ**')),
    path: data.path || tableValue(body, '**ที่อยู่โปรเจกต์**') || `D:\\COWORK\\${name}`,
    updated: data.updated || tableValue(body, '**อัปเดตล่าสุด**'),
    desc: section(body, 'ภาพรวม'),
    tasks: openTasks(body),
    file,
  };
}

// เก็บ "- [ ]" ที่ยังไม่ทำจากทั้งไฟล์โปรเจกต์ (ไม่ผูกกับ heading เจาะจง — ใช้รวมทุก section)
function openTasks(body) {
  return body.split('\n')
    .map(l => l.match(/^\s*-\s*\[ \]\s+(.+)$/))
    .filter(Boolean)
    .map(m => m[1].trim());
}

function dailyDid(block) {
  const m = block.match(/ทำอะไรไปบ้าง:\*\*([\s\S]*?)(?=\n- \*\*|$)/);
  if (!m) return [];
  const lines = m[1].split('\n');
  const items = [];
  const inline = lines[0].trim();
  if (inline && inline !== '—') items.push(inline);
  for (let i = 1; i < lines.length; i++) {
    const bm = lines[i].match(/^\s*-\s+(.+)$/);
    if (bm && bm[1].trim()) items.push(bm[1].trim());
  }
  return items;
}

function parseDaily(file) {
  const content = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(content);
  const date = data.date || (path.basename(file, '.md').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const parts = body.split(/^##\s+/m).slice(1);
  const entries = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const project = (nl === -1 ? part : part.slice(0, nl)).trim();
    if (!project || project.startsWith('[')) continue;
    for (const item of dailyDid(part)) entries.push({ project, text: item });
  }
  return { date, entries, file };
}

function parseNote(file) {
  const base = path.basename(file, '.md');
  const content = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(content);
  const dm = base.match(/^(\d{4}-\d{2}-\d{2})[-_ ]?(.*)$/); // legacy date-prefixed filenames, pre-migration
  const fallback = dm ? (dm[2] || base).replace(/[-_]/g, ' ').trim() : base;
  return {
    date: data.date || (dm ? dm[1] : ''),
    name: firstHeading(body, fallback),
    meta: section(body, 'สรุป') || section(body, 'บทเรียน') || section(body, 'เกิดอะไรขึ้น') || '',
    severity: data.severity || '',
    subject: data.subject || '',
    projects: data.projects || [],
    tags: data.tags || [],
    file,
  };
}

function readWorkspace(root) {
  if (!root || !fs.existsSync(root)) {
    return { error: `ไม่พบโฟลเดอร์ A_Workspace: ${root || '(ไม่ได้ตั้งค่า)'}` };
  }
  const projects = readDir(path.join(root, 'projects'))
    .filter(f => f.endsWith('.md') && !SKIP.has(f))
    .map(f => parseProject(path.join(root, 'projects', f)));
  const daily = walkMd(path.join(root, 'daily')).map(f => parseDaily(f));
  const lessons = readDir(path.join(root, 'lessons'))
    .filter(f => f.endsWith('.md') && !SKIP.has(f))
    .map(f => parseNote(path.join(root, 'lessons', f)));
  const refs = readDir(path.join(root, 'refs'))
    .filter(f => f.endsWith('.md') && !SKIP.has(f))
    .map(f => parseNote(path.join(root, 'refs', f)));
  const rules = readDir(path.join(root, 'rules'))
    .filter(f => f.endsWith('.md') && !SKIP.has(f))
    .map(f => parseNote(path.join(root, 'rules', f)));
  const playbooks = readDir(path.join(root, 'playbooks'))
    .filter(f => f.endsWith('.md') && !SKIP.has(f))
    .map(f => parseNote(path.join(root, 'playbooks', f)));

  projects.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.name.localeCompare(b.name));
  daily.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
  lessons.sort(byDate); refs.sort(byDate); rules.sort((a, b) => a.name.localeCompare(b.name)); playbooks.sort(byDate);

  const count = k => projects.filter(p => p.status === k).length;
  const stats = {
    projects: projects.length,
    active: count('active'), pause: count('pause'), done: count('done'), dropped: count('dropped'),
    tasks: projects.reduce((n, p) => n + p.tasks.length, 0),
    lessons: lessons.length, refs: refs.length, rules: rules.length, playbooks: playbooks.length,
  };
  return { projects, daily, lessons, refs, rules, playbooks, stats, error: null };
}

module.exports = { readWorkspace, parseFrontmatter };

// standalone sanity run: node workspace.js "D:\COWORK\A_Workspace"
if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'A_Workspace');
  console.log(JSON.stringify(readWorkspace(dir), null, 2));
}
