const test = require('node:test');
const assert = require('node:assert');

// tab-redmine.js destructure global.COWORK.util ตอนโหลด — require util.js ก่อน
// (แบบเดียวกับ tests/tab-meeting.test.js)
require('../util.js');
const {
  parseTerms, issueHay, matchTerms, termsHitNote, sortForSearch, viewModel,
} = require('../tab-redmine.js');

// ===== parseTerms =====
test('parseTerms: ว่าง / ช่องว่างล้วน = ไม่มีคำค้น', () => {
  assert.deepStrictEqual(parseTerms(''), []);
  assert.deepStrictEqual(parseTerms('   '), []);
  assert.deepStrictEqual(parseTerms(null), []);
  assert.deepStrictEqual(parseTerms(undefined), []);
});

test('parseTerms: ตัดหลายคำ ลดเป็นตัวพิมพ์เล็ก ยุบช่องว่างซ้ำ', () => {
  assert.deepStrictEqual(parseTerms('  Menutable   VOUCHER '), ['menutable', 'voucher']);
});

test('parseTerms: คำไทยไม่ถูกตัดกลางคำ', () => {
  assert.deepStrictEqual(parseTerms('เช็คหน้า voucher'), ['เช็คหน้า', 'voucher']);
});

// ===== issueHay =====
const ISSUE_188 = {
  id: 188, subject: 'เช็คหน้า voucher มันมี error ถ้าไม่มีข้อมูล',
  project: 'Menutable', assignee: 'Thawalit', risk: null, closed: true,
  status: 'Closed', updatedOn: '2026-05-02T04:10:00Z',
};

test('issueHay: รวม #id / subject / project / assignee / โน้ต เป็นตัวพิมพ์เล็ก', () => {
  const hay = issueHay(ISSUE_188, 'ถามพี่เอกเรื่องนี้ก่อน');
  assert.ok(hay.includes('#188'));
  assert.ok(hay.includes('voucher'));
  assert.ok(hay.includes('menutable'));   // project ถูกลดเป็นตัวพิมพ์เล็ก
  assert.ok(hay.includes('thawalit'));
  assert.ok(hay.includes('พี่เอก'));
});

test('issueHay: field ที่หายไปไม่ทำให้ได้คำว่า undefined/null ปนใน haystack', () => {
  const hay = issueHay({ id: 9 }, '');
  assert.ok(!hay.includes('undefined'));
  assert.ok(!hay.includes('null'));
});

// ===== matchTerms =====
test('matchTerms: ไม่มีคำค้น = ผ่านทุกอัน', () => {
  assert.strictEqual(matchTerms(issueHay(ISSUE_188, ''), []), true);
});

test('matchTerms: หลายคำต้องตรงทุกคำ (AND)', () => {
  const hay = issueHay(ISSUE_188, '');
  assert.strictEqual(matchTerms(hay, ['menutable', 'voucher']), true);
  assert.strictEqual(matchTerms(hay, ['menutable', 'stripe']), false);
});

test('matchTerms: "550" กับ "#550" หาเจอ issue เดียวกัน', () => {
  const hay = issueHay({ id: 550, subject: 'Invoice total', project: 'Menutable', assignee: 'Thawalit' }, '');
  assert.strictEqual(matchTerms(hay, parseTerms('550')), true);
  assert.strictEqual(matchTerms(hay, parseTerms('#550')), true);
});

test('matchTerms: ไม่สนตัวพิมพ์เล็กใหญ่ของคำค้น', () => {
  assert.strictEqual(matchTerms(issueHay(ISSUE_188, ''), parseTerms('VOUCHER')), true);
});

// ===== termsHitNote =====
test('termsHitNote: จริงเมื่อคำใดคำหนึ่งอยู่ในโน้ต', () => {
  assert.strictEqual(termsHitNote('ถามพี่เอกก่อน', parseTerms('พี่เอก')), true);
  assert.strictEqual(termsHitNote('ถามพี่เอกก่อน', parseTerms('voucher')), false);
});

test('termsHitNote: ไม่มีโน้ต หรือไม่มีคำค้น = เท็จเสมอ', () => {
  assert.strictEqual(termsHitNote('', parseTerms('voucher')), false);
  assert.strictEqual(termsHitNote('มีโน้ต', []), false);
});

// ===== sortForSearch =====
const A_OPEN_OLD   = { id: 1, closed: false, updatedOn: '2026-01-01T00:00:00Z' };
const B_OPEN_NEW   = { id: 2, closed: false, updatedOn: '2026-07-31T00:00:00Z' };
const C_CLOSED_NEW = { id: 3, closed: true,  updatedOn: '2026-07-31T09:00:00Z' };
const D_CLOSED_OLD = { id: 4, closed: true,  updatedOn: '2025-12-01T00:00:00Z' };

test('sortForSearch: งานที่ยังเปิดขึ้นก่อนงานที่ปิดแล้วเสมอ แม้ปิดล่าสุดกว่า', () => {
  const out = sortForSearch([C_CLOSED_NEW, A_OPEN_OLD, D_CLOSED_OLD, B_OPEN_NEW]);
  assert.deepStrictEqual(out.map(i => i.id), [2, 1, 3, 4]);
});

test('sortForSearch: ไม่แก้ array เดิม', () => {
  const input = [C_CLOSED_NEW, A_OPEN_OLD];
  sortForSearch(input);
  assert.deepStrictEqual(input.map(i => i.id), [3, 1]);
});

test('sortForSearch: updatedOn ว่าง/หายไป ตกไปท้ายกลุ่มของตัวเอง ไม่ทำให้ลำดับพัง', () => {
  const noStamp = { id: 5, closed: false, updatedOn: '' };
  const out = sortForSearch([noStamp, A_OPEN_OLD, B_OPEN_NEW, C_CLOSED_NEW]);
  assert.deepStrictEqual(out.map(i => i.id), [2, 1, 5, 3]);
});

// ===== ฟิกซ์เจอร์ =====
// id / subject / project / assignee / risk ยกมาจากหน้าจอจริงของแท็บ Redmine
// (โปรเจกต์ Menutable, 2026-08-01) ไม่ได้แต่งขึ้นเอง
// สิ่งที่ ARRANGED เพราะหน้าจอนั้นไม่ได้แสดง: การกระจายสถานะ, ค่า updatedOn,
// และการย้าย 2 issue ไปโปรเจกต์ Wallet/Payment (ชื่อโปรเจกต์จริงจากแถวชิป)
// เพื่อให้มีมากกว่าหนึ่งโปรเจกต์ให้กรอง — ถ้ามี payload จริงดัมพ์มาได้ ให้แทนที่ทั้งก้อนนี้
const PAYLOAD = { groups: [
  { status: 'Backlog', issues: [
    { id: 17,  subject: 'Stripe ยังไม่สามารถ สร้าง ได้ สำหรับลูกค้าใหม่', project: 'Payment', /* ARRANGED */
      assignee: 'songkran', risk: null, status: 'Backlog', closed: false, updatedOn: '2026-03-01T00:00:00Z' },
    { id: 69,  subject: 'ป้องกันออก key ซ้ำกัน ตอนสร้าง voucher', project: 'Menutable',
      assignee: 'Thawalit', risk: 'Fairly Low', status: 'Backlog', closed: false, updatedOn: '2026-03-02T00:00:00Z' },
  ]},
  { status: 'New', issues: [
    { id: 657, subject: '[UI] Header menu: เมนู toggle อยู่มุมจอและสีตัวอักษรไม่อ่านค่า (แก้ Header.svelte)',
      project: 'Menutable', assignee: 'songkran', risk: 'Low', status: 'New', closed: false, updatedOn: '2026-07-30T10:00:00Z' },
    { id: 656, subject: 'เพิ่ม Save ให้ Edit ของ Block out ใน Booking', project: 'Menutable',
      assignee: 'Thawalit', risk: 'Moderate', status: 'New', closed: false, updatedOn: '2026-07-29T10:00:00Z' },
  ]},
  { status: 'In Progress', issues: [
    { id: 584, subject: 'Create pre-order when place order and update order when make payment',
      project: 'Menutable', assignee: 'songkran', risk: 'High', status: 'In Progress', closed: false, updatedOn: '2026-07-31T08:00:00Z' },
  ]},
  { status: 'Test', issues: [
    { id: 530, subject: 'Booking CMS Transactions display incorrect table information', project: 'Wallet', /* ARRANGED */
      assignee: 'Thawalit', risk: 'Medium', status: 'Test', closed: false, updatedOn: '2026-07-28T10:00:00Z' },
  ]},
  { status: 'Resolved', issues: [
    { id: 550, subject: 'Invoice total and refund details are inconsistent with item prices and payment records.',
      project: 'Menutable', assignee: 'Thawalit', risk: 'High', status: 'Resolved', closed: false, updatedOn: '2026-07-27T10:00:00Z' },
  ]},
  { status: 'Closed', issues: [
    { id: 531, subject: 'Booking ซ้ำโต๊ะเดียวกันเวลาเดียวกัน', project: 'Menutable',
      assignee: 'songkran', risk: 'Low', status: 'Closed', closed: true, updatedOn: '2026-06-01T10:00:00Z' },
    { id: 188, subject: 'เช็คหน้า voucher มันมี error ถ้าไม่มีข้อมูล', project: 'Menutable',
      assignee: 'Thawalit', risk: null, status: 'Closed', closed: true, updatedOn: '2026-05-02T04:10:00Z' },
    { id: 94,  subject: 'add feature print voucher', project: 'Menutable',
      assignee: 'Thawalit', risk: 'Fairly Low', status: 'Closed', closed: true, updatedOn: '2026-04-10T10:00:00Z' },
    { id: 654, subject: 'CMS: กด Web App อื่นแล้วโดนบังคับ login Casdoor ใหม่ (เพิ่ม Silent SSO)',
      project: 'Menutable', assignee: 'Thawalit', risk: 'Moderate', status: 'Closed', closed: true, updatedOn: '2026-07-20T10:00:00Z' },
    { id: 646, subject: 'ปรับแสดงรายการแอป ของ menutable', project: 'Menutable',
      assignee: 'Thawalit', risk: 'Moderate', status: 'Closed', closed: true, updatedOn: '2026-07-15T10:00:00Z' },
  ]},
]};
// โน้ตส่วนตัว: คำว่า "ตู้เย็น" ไม่มีอยู่ใน field ไหนของ issue เลย จึงพิสูจน์ได้ว่าค้นจากโน้ตจริง
const NOTES = { '646': { text: 'อันนี้รอ design ก่อน ตู้เย็น', updatedAt: '2026-07-16T00:00:00Z' } };

const ALL_ISSUES = PAYLOAD.groups.flatMap(g => g.issues);
const st = (over) => Object.assign({
  query: '', selectedProjects: [], selectedAssignees: [], selectedRisk: null, activeStatus: 'ALL',
}, over);

// ===== ช่องว่าง = พฤติกรรมเดิมเป๊ะ =====
test('ไม่ค้น: แท็บ ALL นับเฉพาะงานที่ยังเปิด และไม่รวม Backlog', () => {
  const vm = viewModel(PAYLOAD, NOTES, st());
  // เปิดทั้งหมด 7 (17, 69, 657, 656, 584, 530, 550) หัก Backlog 2 ตัว = 5
  assert.strictEqual(vm.allTab.count, 5);
  assert.strictEqual(vm.list.length, 5);
  assert.ok(!vm.list.some(e => e.issue.status === 'Backlog'));
  assert.ok(!vm.list.some(e => e.issue.closed));
});

test('ไม่ค้น: ตัวเลขชิปคือยอดรวมทั้งก้อน ไม่ถูกหักด้วยคำค้นหรือชิปแถวอื่น', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ selectedAssignees: ['songkran'] }));
  const menutable = vm.projectChips.find(c => c.key === 'Menutable');
  assert.strictEqual(menutable.open + menutable.closed,
    ALL_ISSUES.filter(i => i.project === 'Menutable').length);
  assert.strictEqual(menutable.zero, false);
});

test('ไม่ค้น: ลำดับในรายการคือลำดับที่ payload ส่งมา ไม่ถูกเรียงใหม่', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ activeStatus: 'Closed' }));
  assert.deepStrictEqual(vm.list.map(e => e.issue.id), [531, 188, 94, 654, 646]);
  assert.strictEqual(vm.searching, false);
});

// ===== ค้นแล้วข้ามสถานะ =====
test('ค้นเลขงานที่ปิดแล้ว เจอทั้งที่ยืนอยู่แท็บ ALL', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: '188' }));
  assert.deepStrictEqual(vm.list.map(e => e.issue.id), [188]);
  assert.strictEqual(vm.allTab.count, 1);
  assert.strictEqual(vm.searching, true);
});

test('"550" กับ "#550" ได้ผลชุดเดียวกัน', () => {
  const a = viewModel(PAYLOAD, NOTES, st({ query: '550' })).list.map(e => e.issue.id);
  const b = viewModel(PAYLOAD, NOTES, st({ query: '#550' })).list.map(e => e.issue.id);
  assert.deepStrictEqual(a, [550]);
  assert.deepStrictEqual(b, a);
});

test('หลายคำ = ต้องตรงทุกคำ และค้นชื่อโปรเจกต์/ผู้รับผิดชอบได้', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'menutable VOUCHER' }));
  assert.deepStrictEqual(vm.list.map(e => e.issue.id).sort((x, y) => x - y), [69, 94, 188]);
  const byPerson = viewModel(PAYLOAD, NOTES, st({ query: 'songkran booking' }));
  assert.deepStrictEqual(byPerson.list.map(e => e.issue.id), [531]);
});

test('ค้นแล้วผลเรียงงานที่ยังเปิดก่อน แล้วใหม่→เก่า', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'menutable' }));
  const ids = vm.list.map(e => e.issue.id);
  const firstClosed = ids.findIndex(id => ALL_ISSUES.find(i => i.id === id).closed);
  assert.ok(ids.slice(0, firstClosed).every(id => !ALL_ISSUES.find(i => i.id === id).closed));
  // งานที่ยังเปิดของ Menutable เรียงตาม updatedOn ใหม่→เก่า: 584 (07-31) → 657 (07-30) → 656 (07-29)
  assert.deepStrictEqual(ids.slice(0, 3), [584, 657, 656]);
});

test('ไม่เจอ: list ว่าง แต่ชิปยังอยู่ครบ (0/0) ให้กดปิดตัวกรองได้', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'ไม่มีทางเจอคำนี้', selectedProjects: ['Wallet'] }));
  assert.strictEqual(vm.list.length, 0);
  assert.strictEqual(vm.allTab.count, 0);
  const wallet = vm.projectChips.find(c => c.key === 'Wallet');
  assert.ok(wallet, 'ชิปที่เลือกอยู่ต้องไม่หายไป');
  assert.strictEqual(wallet.selected, true);
  assert.strictEqual(wallet.zero, true);
});

// ===== ค้นจากโน้ต =====
test('ค้นเจอจากข้อความในโน้ตส่วนตัว', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'ตู้เย็น' }));
  assert.deepStrictEqual(vm.list.map(e => e.issue.id), [646]);
});

test('noteHit ติดเฉพาะแถวที่ตรงเพราะโน้ต ไม่ใช่ทุกแถวในผล', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'menutable' }));
  const hits = vm.list.filter(e => e.noteHit).map(e => e.issue.id);
  assert.deepStrictEqual(hits, []);   // "menutable" ไม่ได้อยู่ในโน้ต
  const vm2 = viewModel(PAYLOAD, NOTES, st({ query: 'ตู้เย็น' }));
  assert.deepStrictEqual(vm2.list.map(e => e.noteHit), [true]);
});

// ===== invariant กวาดทุกคอมบิเนชัน =====
// UI ที่มีตัวกรองหลายแถวเหนือรายการเดียวกันพลาดมาแล้ว 3 รอบในวิดเจ็ตนี้
// สามข้อล่างคือสิ่งที่ต้องจริงเสมอ ไม่ว่าคอมบิเนชันไหน
test('invariant: เลขบนแท็บที่ active = จำนวนแถวจริง · ผลรวมสถานะ = ALL ตอนค้น · ชิปที่เลือกอยู่ต้องมีให้กดปิด', () => {
  const QUERIES = ['', 'voucher', '550', '#550', 'menutable voucher', 'ตู้เย็น', 'booking', 'ไม่มีทางเจอคำนี้'];
  const PROJECTS = [[], ['Menutable'], ['Wallet'], ['Menutable', 'Payment']];
  const ASSIGNEES = [[], ['Thawalit'], ['songkran']];
  const RISKS = [null, 'High', 'Low', 'none'];
  const STATUSES = ['ALL', ...PAYLOAD.groups.map(g => g.status)];
  let combos = 0;

  for (const query of QUERIES)
  for (const selectedProjects of PROJECTS)
  for (const selectedAssignees of ASSIGNEES)
  for (const selectedRisk of RISKS)
  for (const activeStatus of STATUSES) {
    combos++;
    const where = JSON.stringify({ query, selectedProjects, selectedAssignees, selectedRisk, activeStatus });
    const vm = viewModel(PAYLOAD, NOTES, st({ query, selectedProjects, selectedAssignees, selectedRisk, activeStatus }));

    const activeCount = activeStatus === 'ALL'
      ? vm.allTab.count
      : vm.statusTabs.find(t => t.status === activeStatus).count;
    assert.strictEqual(activeCount, vm.list.length, 'เลขบนแท็บไม่ตรงกับแถวที่เห็น ' + where);

    if (vm.searching) {
      const sum = vm.statusTabs.reduce((n, t) => n + t.count, 0);
      assert.strictEqual(sum, vm.allTab.count, 'ผลรวมแท็บสถานะไม่เท่า ALL ตอนค้นอยู่ ' + where);
    }

    for (const p of selectedProjects) {
      assert.ok(vm.projectChips.some(c => c.key === p && c.selected), 'ชิปโปรเจกต์ที่เลือกอยู่หายไป ' + where);
    }
    for (const a of selectedAssignees) {
      assert.ok(vm.assigneeChips.some(c => c.key === a && c.selected), 'ชิปผู้รับผิดชอบที่เลือกอยู่หายไป ' + where);
    }
    if (selectedRisk !== null) {
      assert.ok(vm.riskRows.some(r => r.key === selectedRisk && r.active), 'แถว risk ที่เลือกอยู่หายไป ' + where);
    }

    // ชิปสองแถวแบ่งกองเดียวกัน ผลรวมของทั้งสองแถวต้องเท่ากันเสมอ
    const sumOf = rows => rows.reduce((n, c) => n + c.open + c.closed, 0);
    assert.strictEqual(sumOf(vm.projectChips), sumOf(vm.assigneeChips), 'สองแถวชิปนับคนละกอง ' + where);
    // คีย์ชิปต้องมาจากข้อมูลทั้งก้อนเสมอ ไม่ขึ้นกับคำค้น
    assert.strictEqual(vm.projectChips.length, new Set(ALL_ISSUES.map(i => i.project)).size, 'ชิปโปรเจกต์หาย ' + where);
  }
  assert.strictEqual(combos, 8 * 4 * 3 * 4 * 7);
});

// ===== ตัวเลขที่ขึ้นจอจริง แต่ก่อนหน้านี้ไม่เคยถูก assert ค่าตรง ๆ =====
// คำค้น 'voucher' เจอแค่ 3 ตัว: 69 (Backlog, เปิด, Fairly Low), 188 (Closed, ปิด, risk null),
// 94 (Closed, ปิด, Fairly Low) — ทั้งสามอยู่โปรเจกต์ Menutable ทั้งหมด
// เจตนาเลือกคำนี้ (แทน 'menutable') เพราะชื่อโปรเจกต์ติดอยู่ใน haystack ของทุก issue
// ของโปรเจกต์นั้นเสมอ คำค้น 'menutable' เลยจะจับได้ทั้งก้อนพอดี ไม่โชว์การหักจากคำค้นให้เห็น

test('riskRows: นับจากผลค้นหา (searched) ไม่ใช่ทั้งก้อน', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'voucher' }));
  // all: เปิด 1 (69) / ปิด 2 (188, 94)
  const all = vm.riskRows.find(r => r.key === 'all');
  assert.strictEqual(all.open, 1);
  assert.strictEqual(all.closed, 2);
  // Fairly Low: เปิด 1 (69) / ปิด 1 (94)
  const fairlyLow = vm.riskRows.find(r => r.key === 'Fairly Low');
  assert.strictEqual(fairlyLow.open, 1);
  assert.strictEqual(fairlyLow.closed, 1);
  // none (risk ไม่ระบุ): เปิด 0 / ปิด 1 (188 risk:null)
  const none = vm.riskRows.find(r => r.key === 'none');
  assert.strictEqual(none.open, 0);
  assert.strictEqual(none.closed, 1);
});

test('statusTabs: นับจากผลค้นหาตอนมีคำค้น', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'voucher' }));
  // Backlog มีแค่ 69 ที่ตรงคำค้น (17 เป็น Payment ไม่ตรง) = 1
  assert.strictEqual(vm.statusTabs.find(t => t.status === 'Backlog').count, 1);
  // Closed มี 188, 94 ที่ตรงคำค้น (531, 654, 646 ไม่ตรง) = 2
  assert.strictEqual(vm.statusTabs.find(t => t.status === 'Closed').count, 2);
});

test('ชิปโปรเจกต์หักตามคำค้น ไม่ใช่ยอดทั้งก้อน', () => {
  const vm = viewModel(PAYLOAD, NOTES, st({ query: 'voucher' }));
  const menutable = vm.projectChips.find(c => c.key === 'Menutable');
  // ผลค้นหา 'voucher' ทั้งสามตัว (69 เปิด, 188+94 ปิด) เป็น Menutable ทั้งหมด
  assert.strictEqual(menutable.open, 1);
  assert.strictEqual(menutable.closed, 2);
  // ยอดทั้งก้อนของ Menutable (ไม่ผ่านคำค้น) คือ 5 เปิด / 5 ปิด — ต้องไม่ใช่เลขนี้
  const menutableTotal = ALL_ISSUES.filter(i => i.project === 'Menutable');
  assert.strictEqual(menutableTotal.filter(i => !i.closed).length, 5);
  assert.strictEqual(menutableTotal.filter(i => i.closed).length, 5);
});

test('viewModel: รับ selectedProjects/selectedAssignees เป็น Set ได้ผลเหมือน array', () => {
  const withArrays = viewModel(PAYLOAD, NOTES, st({
    query: 'menutable', selectedProjects: ['Menutable'], selectedAssignees: ['Thawalit'], activeStatus: 'Closed',
  }));
  const withSets = viewModel(PAYLOAD, NOTES, st({
    query: 'menutable', selectedProjects: new Set(['Menutable']), selectedAssignees: new Set(['Thawalit']), activeStatus: 'Closed',
  }));
  assert.deepStrictEqual(withSets, withArrays);
  // hand-derived expectation: query 'menutable' + Menutable project + Thawalit assignee + Closed status
  // → all Closed/Menutable/Thawalit issues in PAYLOAD: 654, 646, 188, 94
  // → sorted by updatedOn newest→oldest: 2026-07-20, 2026-07-15, 2026-05-02, 2026-04-10
  assert.deepStrictEqual(withSets.list.map(e => e.issue.id), [654, 646, 188, 94]);
});
