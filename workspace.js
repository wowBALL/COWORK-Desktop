// Reads the A_Workspace markdown vault (projects / daily / lessons / playbooks)
// into a plain object for the Workspace tab. Pure fs/path — no Electron needed,
// so it can be run/tested standalone with `node workspace.js <dir>`.
const fs = require('fs');
const path = require('path');

const VIS = ['Public', 'Private'];
const SKIP = new Set(['_TEMPLATE.md', 'README.md', 'INDEX.md']);

// map the emoji in the "สถานะ" row to a stable key the UI styles by
function statusKey(raw) {
  if (!raw) return 'unknown';
  if (raw.includes('🟢')) return 'active';
  if (raw.includes('🟡')) return 'pause';
  if (raw.includes('✅') || raw.includes('🔵')) return 'done';
  return 'unknown';
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

function parseProject(file, visibility) {
  const content = fs.readFileSync(file, 'utf8');
  const name = firstHeading(content, path.basename(file, '.md'));
  return {
    name,
    visibility,                                            // Public | Private (from folder)
    status: statusKey(tableValue(content, '**สถานะ**')),
    path: tableValue(content, '**ที่อยู่โปรเจกต์**') || `D:\\COWORK\\${name}`,
    updated: tableValue(content, '**อัปเดตล่าสุด**'),
    desc: section(content, 'ภาพรวม'),
    file,
  };
}

// pull "ทำอะไรไปบ้าง" from a daily project section, stripped of the label
function dailyDid(block) {
  const m = block.match(/ทำอะไรไปบ้าง:\*\*\s*([^\n]*)/);
  if (m && m[1].trim() && m[1].trim() !== '—') return m[1].trim();
  return '';
}

function parseDaily(file, visibility) {
  const content = fs.readFileSync(file, 'utf8');
  const date = (path.basename(file, '.md').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const parts = content.split(/^##\s+/m).slice(1);       // each part starts at a project name
  const entries = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const project = (nl === -1 ? part : part.slice(0, nl)).trim();
    if (!project || project.startsWith('[')) continue;    // skip template placeholders
    const did = dailyDid(part);
    if (!did) continue;                                   // no real content yet → skip
    entries.push({ project, text: did });
  }
  return { date, visibility, entries, file };
}

// filename like 2026-07-21-topic.md → { date, name }
function parseNote(file, visibility) {
  const base = path.basename(file, '.md');
  const dm = base.match(/^(\d{4}-\d{2}-\d{2})[-_ ]?(.*)$/);
  const content = fs.readFileSync(file, 'utf8');
  const fallback = dm ? (dm[2] || base).replace(/[-_]/g, ' ').trim() : base;
  return {
    date: dm ? dm[1] : '',
    name: firstHeading(content, fallback),
    meta: section(content, 'สรุป') || section(content, 'บทเรียน') || '',
    file,
    visibility,
  };
}

function readWorkspace(root) {
  if (!root || !fs.existsSync(root)) {
    return { error: `ไม่พบโฟลเดอร์ A_Workspace: ${root || '(ไม่ได้ตั้งค่า)'}` };
  }
  const projects = [];
  const daily = [];
  const lessons = [];
  const playbooks = [];

  for (const vis of VIS) {
    const base = path.join(root, vis);
    for (const f of readDir(path.join(base, 'projects')))
      if (f.endsWith('.md') && !SKIP.has(f))
        projects.push(parseProject(path.join(base, 'projects', f), vis));
    for (const f of walkMd(path.join(base, 'daily')))
      daily.push(parseDaily(f, vis));
    for (const f of readDir(path.join(base, 'lessons')))
      if (f.endsWith('.md') && !SKIP.has(f))
        lessons.push(parseNote(path.join(base, 'lessons', f), vis));
    for (const f of readDir(path.join(base, 'playbooks')))
      if (f.endsWith('.md') && !SKIP.has(f))
        playbooks.push(parseNote(path.join(base, 'playbooks', f), vis));
  }

  projects.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.name.localeCompare(b.name));
  daily.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
  lessons.sort(byDate);
  playbooks.sort(byDate);

  const count = k => projects.filter(p => p.status === k).length;
  const stats = {
    projects: projects.length,
    public: projects.filter(p => p.visibility === 'Public').length,
    private: projects.filter(p => p.visibility === 'Private').length,
    active: count('active'),
    pause: count('pause'),
    done: count('done'),
    lessons: lessons.length,
    playbooks: playbooks.length,
  };

  return { projects, daily, lessons, playbooks, stats, error: null };
}

module.exports = { readWorkspace };

// standalone sanity run: node workspace.js "D:\COWORK\A_Workspace"
if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'A_Workspace');
  console.log(JSON.stringify(readWorkspace(dir), null, 2));
}
