const test = require('node:test');
const assert = require('node:assert');
require('../util.js');
// tab-qatest.js destructure global.COWORK.dateFilter ตอนโหลด — require datefilter.js ก่อน
// (แบบเดียวกับ tests/tab-meeting.test.js)
require('../datefilter.js');
const { buildReviewLines, qiXmlChipsHtml } = require('../tab-qatest.js');

test('buildReviewLines: แปล priority/assignee/tracker กลับเป็นชื่อคนอ่านได้ ไม่ใช่ id ดิบ', () => {
  const lines = buildReviewLines(
    {
      projectName: 'Wallet', trackerName: 'Bug', subject: 'กดไม่ติด', priorityName: 'High',
      assigneeId: 7, riskLevel: 'High', customFieldValues: { '8': 'rollback text' },
      uploads: [{ filename: 'shot.png' }],
    },
    { members: [{ id: 7, name: 'kom' }], customFields: [{ id: 8, name: 'Rollback Plan' }] },
  );
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]));
  assert.strictEqual(byLabel['โปรเจกต์'], 'Wallet');
  assert.strictEqual(byLabel['Priority'], 'High');
  assert.strictEqual(byLabel['ผู้รับผิดชอบ'], 'kom');
  assert.strictEqual(byLabel['Rollback Plan'], 'rollback text');
  assert.ok(byLabel['ไฟล์แนบ'].includes('shot.png'));
});

test('buildReviewLines: ไม่มี assignee แสดง "(ไม่ระบุ)" ไม่ใช่ id ว่างเปล่า', () => {
  const lines = buildReviewLines(
    { projectName: 'Wallet', trackerName: 'Bug', subject: 's', priorityName: 'Normal', customFieldValues: {} },
    { members: [], customFields: [] },
  );
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l.value]));
  assert.strictEqual(byLabel['ผู้รับผิดชอบ'], '(ไม่ระบุ)');
});

// ===== รูปที่ส่งให้ LLM ดู + ข้อมูลที่ยังขาด (spec 2026-08-05) =====
const {
  qiDraftBtnLabel, qiThumbsHtml, qiDraftGapsHtml, qiPastedName, qiIsImageDataUrlText,
} = require('../tab-qatest.js');

// util.js esc() escape ด้วย textContent→innerHTML ของจริง จึงต้องมี document ให้มันเรียก
// (แนวเดียวกับ fake DOM ใน tab-redmine.dom.test.js) — เลียนพฤติกรรมจริงให้ครบ รวมทั้ง
// การแปลง U+00A0 เป็น &nbsp; ที่ regex ธรรมดาไม่ทำ ไม่งั้นเทสจะพิสูจน์คนละอย่างกับของจริง
global.document = {
  createElement() {
    let text = '';
    return {
      set textContent(v) { text = String(v == null ? '' : v); },
      get innerHTML() {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
      },
    };
  },
};

test('qiDraftBtnLabel: ไม่มีรูปไม่โชว์วงเล็บ มีรูปบอกจำนวน', () => {
  assert.strictEqual(qiDraftBtnLabel(0), '🪄 ให้ LLM ช่วยร่าง');
  assert.ok(qiDraftBtnLabel(2).includes('(2 รูป)'));
});

test('qiThumbsHtml: ใบที่ยังอ่านไฟล์ไม่เสร็จไม่มีแท็ก <img> แต่ยังมีปุ่มเอาออก', () => {
  const html = qiThumbsHtml([{ filename: 'a.png', dataUrl: '', pending: true }]);
  assert.ok(!html.includes('<img'), 'ยังไม่มี dataUrl ต้องไม่วาด <img src=""> ที่ขึ้นไอคอนรูปแตก');
  assert.ok(html.includes('qi-thumb-busy'));
  assert.ok(html.includes('qi-thumb-drop'));
});

test('qiThumbsHtml: data-i เรียงตาม index จริง (ปุ่มเอาออกใช้เลขนี้ splice)', () => {
  const html = qiThumbsHtml([
    { filename: 'a.png', dataUrl: 'data:image/png;base64,AAA' },
    { filename: 'b.png', dataUrl: 'data:image/png;base64,BBB' },
  ]);
  assert.ok(html.includes('data-i="0"') && html.includes('data-i="1"'));
});

test('qiThumbsHtml: ปุ่มเอาออกต้องบอกว่าไฟล์แนบยังอยู่ ไม่ใช่ลบไฟล์แนบ', () => {
  const html = qiThumbsHtml([{ filename: 'a.png', dataUrl: 'data:image/png;base64,AAA' }]);
  assert.ok(html.includes('ไฟล์แนบใน issue ยังอยู่'),
    'อัปขึ้น Redmine ไปแล้วถอนไม่ได้ ป้ายต้องไม่ทำให้เข้าใจว่ากดแล้วไฟล์แนบหาย');
});

test('qiThumbsHtml: ชื่อไฟล์ถูก escape ไม่หลุดออกจาก attribute', () => {
  const html = qiThumbsHtml([{ filename: 'a" onerror="x.png', dataUrl: '' }]);
  assert.ok(!html.includes('onerror="x'), 'ชื่อไฟล์ต้องไม่ปิด attribute แล้วแทรก handler ได้');
});

test('qiDraftGapsHtml: ไม่มีอะไรขาด = ว่างเปล่า (ปลายทางใช้ค่านี้ตัดสินว่าจะซ่อนกรอบ)', () => {
  assert.strictEqual(qiDraftGapsHtml([]), '');
  assert.strictEqual(qiDraftGapsHtml(null), '');
  assert.strictEqual(qiDraftGapsHtml(undefined), '');
});

test('qiDraftGapsHtml: วาดเป็นรายการและ escape เนื้อหาที่โมเดลส่งมา', () => {
  const html = qiDraftGapsHtml(['ยังไม่บอก route', '<script>x</script>']);
  assert.ok(html.includes('<li>ยังไม่บอก route</li>'));
  assert.ok(!html.includes('<script>'), 'ข้อความจากโมเดลต้องไม่ถูกรันเป็น HTML');
});

test('qiPastedName: jpeg ตั้งนามสกุลเป็น jpg และไม่ชนกันเองเมื่อวางหลายใบ', () => {
  assert.ok(qiPastedName({ type: 'image/jpeg' }).endsWith('.jpg'));
  assert.ok(qiPastedName({ type: 'image/png' }).endsWith('.png'));
  assert.notStrictEqual(qiPastedName({ type: 'image/png' }), qiPastedName({ type: 'image/png' }));
});

test('qiPastedName: type ที่อ่านไม่ได้ยังได้ชื่อไฟล์ที่ใช้ได้ ไม่ใช่ ".undefined"', () => {
  assert.ok(qiPastedName({ type: '' }).endsWith('.png'));
});

// ===== วางข้อความ "ที่อยู่ของรูป" (data:image/...) ลงช่องโน้ต ไม่ใช่ไฟล์รูปจริง =====
// เกิดจริง: คัดลอกจากที่อื่นแล้ว clipboard เก็บเป็นข้อความ ไม่ใช่ไฟล์ — clipboardData.items
// ไม่เห็นเป็น kind:'file' เลย ปล่อยผ่านจะได้ base64 ยาวหลายพันตัวอักษรลงในโน้ตที่ส่งเป็น prompt
test('qiIsImageDataUrlText: จับ data:image/...;base64 ได้ ไม่ว่าจะเป็น png/svg/jpeg', () => {
  assert.ok(qiIsImageDataUrlText('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(qiIsImageDataUrlText('data:image/svg+xml;base64,PHN2Zw=='));
  assert.ok(qiIsImageDataUrlText('  data:image/jpeg;base64,/9j/'), 'ต้องทนช่องว่างนำหน้าจากการวาง');
});

test('qiIsImageDataUrlText: ข้อความปกติหรือ data URL ที่ไม่ใช่รูปต้องผ่าน ไม่ถูกกัน', () => {
  assert.ok(!qiIsImageDataUrlText('ปุ่ม checkout กดไม่ติด android 13'));
  assert.ok(!qiIsImageDataUrlText('data:text/plain;base64,aGVsbG8='));
  assert.ok(!qiIsImageDataUrlText(''));
  assert.ok(!qiIsImageDataUrlText(null));
  assert.ok(!qiIsImageDataUrlText(undefined));
});

// ===== ย่อรูปให้พอดีเพดานของ endpoint (วัด 2026-08-06) =====
// endpoint คิดโทเคนรูปเป็น round(w/32)×round(h/32) และรวมทั้งคำขอต้องน้อยกว่า 4096
// เกินแล้วได้ HTTP 400 "Failed to apply Qwen3VLProcessor" ทันที ไม่ใช่ผลลัพธ์แย่ลงเฉย ๆ
const { qiImageTokens, qiFitPlan, QI_IMAGE_TOKEN_LIMIT } = require('../tab-qatest.js');

const planTokens = plan => plan.reduce((a, s) => a + qiImageTokens(s.w, s.h), 0);

test('qiImageTokens: ตรงกับตัวเลขที่ยิงวัดจากปลายทางจริง ไม่ใช่สูตรที่เดาเอง', () => {
  // ค่าอ้างอิง = prompt_tokens ที่วัดได้ ลบโทเคนข้อความ (~22)
  assert.strictEqual(qiImageTokens(1280, 800), 1000);   // วัดได้ 1022
  assert.strictEqual(qiImageTokens(1600, 1600), 2500);  // วัดได้ 2522
  assert.strictEqual(qiImageTokens(2398, 1096), 2550);  // วัดได้ 2572
  assert.strictEqual(qiImageTokens(4000, 600), 2375);   // วัดได้ 2397
  assert.strictEqual(qiImageTokens(2048, 2048), 4096);  // เส้นที่พังพอดี
});

test('qiFitPlan: รวมแล้วยังไม่เกินงบ ต้องคืนขนาดเดิมเป๊ะ ไม่ย่อฟรี ๆ', () => {
  const sizes = [{ w: 1280, h: 800 }, { w: 1280, h: 800 }];
  assert.deepStrictEqual(qiFitPlan(sizes), sizes);
});

test('qiFitPlan: เคสจริงที่ผู้ใช้เจอ (3 รูปรวม 7,154 โทเคน) ต้องย่อจนต่ำกว่าเพดาน', () => {
  const plan = qiFitPlan([{ w: 2398, h: 1096 }, { w: 2530, h: 828 }, { w: 2400, h: 1100 }]);
  assert.ok(planTokens(plan) < QI_IMAGE_TOKEN_LIMIT, `ได้ ${planTokens(plan)} โทเคน`);
});

test('qiFitPlan: รูปเดียวใหญ่มากก็ต้องย่อ ไม่ใช่ปล่อยผ่านเพราะมีใบเดียว', () => {
  const plan = qiFitPlan([{ w: 4000, h: 3000 }]);
  assert.ok(planTokens(plan) < QI_IMAGE_TOKEN_LIMIT, `ได้ ${planTokens(plan)} โทเคน`);
});

test('qiFitPlan: รูปเยอะ ๆ ก็ยังต้องพอดีงบ', () => {
  const many = Array.from({ length: 8 }, () => ({ w: 1920, h: 1080 }));
  assert.ok(planTokens(qiFitPlan(many)) < QI_IMAGE_TOKEN_LIMIT);
});

test('qiFitPlan: คงสัดส่วนภาพเดิม ไม่บิดจนตัวหนังสือในภาพเพี้ยน', () => {
  const plan = qiFitPlan([{ w: 2400, h: 1200 }, { w: 1000, h: 2000 }]);
  assert.ok(Math.abs(plan[0].w / plan[0].h - 2) < 0.02, `ได้ ${plan[0].w}x${plan[0].h}`);
  assert.ok(Math.abs(plan[1].w / plan[1].h - 0.5) < 0.02, `ได้ ${plan[1].w}x${plan[1].h}`);
});

test('qiFitPlan: ย่อด้วยอัตราเดียวกันทุกใบ รูปที่ใหญ่กว่าต้องยังใหญ่กว่า', () => {
  const plan = qiFitPlan([{ w: 3000, h: 2000 }, { w: 1500, h: 1000 }]);
  assert.ok(plan[0].w > plan[1].w, 'ใบใหญ่ต้องไม่ถูกย่อจนเล็กกว่าใบเล็ก');
  assert.ok(Math.abs(plan[0].w / plan[1].w - 2) < 0.05, 'อัตราส่วนระหว่างสองใบต้องคงเดิม');
});

test('qiFitPlan: ไม่ขยายรูปเล็กให้ใหญ่ขึ้นเพื่อใช้งบให้หมด — ขยายแล้วเบลอเปล่า ๆ', () => {
  assert.deepStrictEqual(qiFitPlan([{ w: 320, h: 200 }]), [{ w: 320, h: 200 }]);
});

test('qiFitPlan: ขนาดที่คืนต้องเป็นจำนวนเต็มบวก ไม่งั้น canvas โยน error', () => {
  for (const plan of [qiFitPlan([{ w: 4000, h: 3000 }]), qiFitPlan(Array.from({ length: 30 }, () => ({ w: 2400, h: 1200 })))]) {
    for (const s of plan) {
      assert.ok(Number.isInteger(s.w) && s.w > 0, `w=${s.w}`);
      assert.ok(Number.isInteger(s.h) && s.h > 0, `h=${s.h}`);
    }
  }
});

test('qiFitPlan: ไม่มีรูปก็ต้องไม่พัง', () => {
  assert.deepStrictEqual(qiFitPlan([]), []);
});

// ย่อแรงเกินไปแล้ว OCR ไม่ได้ "อ่านไม่ออก" เฉย ๆ แต่ "แต่งค่าที่อ่านไม่ออกขึ้นมาแทน" ซึ่งดูเนียน
// จนคนตรวจไม่ทัน จึงต้องเตือน (วัด 2026-08-06 ดูตัวเลขที่ qiFitNotice)
const { qiFitNotice, QI_SAFE_FIT_SCALE } = require('../tab-qatest.js');

test('qiFitNotice: ไม่ได้ย่อเลย ต้องไม่มีคำเตือนมากวน', () => {
  const sizes = [{ w: 1280, h: 800 }];
  assert.strictEqual(qiFitNotice(sizes, qiFitPlan(sizes)), '');
});

test('qiFitNotice: ย่อนิดเดียว (เคสจริง 3 รูป ~0.74x) ยังอ่านออก ต้องไม่เตือน', () => {
  const sizes = [{ w: 2398, h: 1096 }, { w: 2530, h: 828 }, { w: 2400, h: 1100 }];
  const plan = qiFitPlan(sizes);
  assert.ok(plan[0].w < 2398, 'เคสนี้ต้องถูกย่อจริง ไม่งั้นเทสไม่ได้พิสูจน์อะไร');
  assert.strictEqual(qiFitNotice(sizes, plan), '');
});

test('qiFitNotice: ย่อจนต่ำกว่าเส้นที่วัดไว้ ต้องเตือนพร้อมบอกว่าทำอะไรต่อ', () => {
  const sizes = Array.from({ length: 8 }, () => ({ w: 2398, h: 1096 }));
  const plan = qiFitPlan(sizes);
  const notice = qiFitNotice(sizes, plan);
  assert.ok(notice, 'ย่อ ~0.44x ต้องเตือน');
  assert.ok(/ครอป|ลดจำนวนรูป/.test(notice), 'ต้องบอกทางออก ไม่ใช่แจ้งว่ามีปัญหาเฉย ๆ');
});

test('qiFitNotice: เส้นแบ่งอยู่ที่อัตราที่วัดมา ไม่ใช่ตัวเลขที่ตั้งลอย ๆ', () => {
  const one = [{ w: 2000, h: 1000 }];
  const justAbove = [{ w: 2000, h: 1000 }].map(s => s);
  // สร้างแผนปลอมที่อัตราคร่อมเส้นพอดี เพื่อพิสูจน์ว่าเทียบกับ QI_SAFE_FIT_SCALE จริง
  const at = r => [{ w: Math.round(2000 * r), h: Math.round(1000 * r) }];
  assert.strictEqual(qiFitNotice(one, at(QI_SAFE_FIT_SCALE)), '', 'ที่เส้นพอดีต้องยังไม่เตือน');
  assert.ok(qiFitNotice(justAbove, at(QI_SAFE_FIT_SCALE - 0.05)), 'ต่ำกว่าเส้นต้องเตือน');
});

test('qiFitNotice: ไม่มีรูปต้องไม่พังและไม่เตือน', () => {
  assert.strictEqual(qiFitNotice([], []), '');
});

// ===== ค่าเริ่มต้นของ custom field (2026-08-06) =====
// ทีมกรอก Document Type เป็นค่าเดิมทุกใบ ให้เติมให้เลย แต่ต้องลบหรือแก้ได้
const { qiCustomFieldsHtml, QI_CUSTOM_FIELD_DEFAULTS } = require('../tab-qatest.js');

test('qiCustomFieldsHtml: Document Type ถูกเติมค่าเริ่มต้นมาให้เลย', () => {
  const html = qiCustomFieldsHtml([{ id: 12, name: 'Document Type' }]);
  assert.ok(html.includes('ASPIRE-FR-18 ISSUE TRACKING'), html);
  assert.ok(html.includes('data-field-id="12"'));
});

test('qiCustomFieldsHtml: field อื่นยังว่างเหมือนเดิม ไม่ได้เติมมั่ว', () => {
  const html = qiCustomFieldsHtml([{ id: 9, name: 'Rollback Plan' }]);
  assert.ok(/<textarea[^>]*><\/textarea>/.test(html), html);
});

test('qiCustomFieldsHtml: Risk Level ไม่ถูกวาดซ้ำ เพราะมี dropdown ตายตัวอยู่แล้ว', () => {
  const html = qiCustomFieldsHtml([{ id: 8, name: 'Risk Level' }, { id: 9, name: 'Impact Analysis' }]);
  assert.ok(!html.includes('Risk Level'), html);
  assert.ok(html.includes('Impact Analysis'));
});

test('qiCustomFieldsHtml: ชื่อ field ที่มี HTML ต้องถูก escape', () => {
  const html = qiCustomFieldsHtml([{ id: 1, name: '<img src=x onerror=alert(1)>' }]);
  assert.ok(!html.includes('<img src=x'), html);
});

test('qiCustomFieldsHtml: ค่าเริ่มต้นต้องถูก escape ด้วย ไม่ใช่ยัดดิบลง textarea', () => {
  const html = qiCustomFieldsHtml([{ id: 1, name: 'X' }], { X: '</textarea><script>x</script>' });
  assert.ok(!html.includes('</textarea><script>'), html);
});

test('qiCustomFieldsHtml: ไม่มี field เลย = ว่าง ไม่พัง', () => {
  assert.strictEqual(qiCustomFieldsHtml([]), '');
  assert.strictEqual(qiCustomFieldsHtml(null), '');
});

test('QI_CUSTOM_FIELD_DEFAULTS: ค่าเริ่มต้นอยู่ที่เดียว แก้ที่นี่ที่เดียวจบ', () => {
  assert.strictEqual(QI_CUSTOM_FIELD_DEFAULTS['Document Type'], 'ASPIRE-FR-18 ISSUE TRACKING');
});

// ---- จัดกลุ่มผลรันตามไฟล์เทส ----
const { shortTestName, qaTestGroups } = require('../tab-qatest.js');

test('shortTestName: ย่อจากหัว เก็บหางไว้', () => {
  // ไฟล์ชุดเดียวกันขึ้นต้นเหมือนกันหมด ตัดหางทิ้งแล้วสองไฟล์จะเหลือข้อความเดียวกันเป๊ะ
  const a = shortTestName('zinga-wallet-test-food-tyro-chanyathaishop.js');
  const b = shortTestName('zinga-wallet-test-food-chanyathaidemo.js');
  assert.notStrictEqual(a, b);
  assert.ok(a.endsWith('chanyathaishop.js'));
  assert.ok(a.startsWith('…'));
});
test('shortTestName: สั้นอยู่แล้วไม่ต้องย่อ', () => {
  assert.strictEqual(shortTestName('a.spec.js'), 'a.spec.js');
  assert.strictEqual(shortTestName(null), '');
});

test('qaTestGroups: นับรอบต่อไฟล์ เรียงมากไปน้อย', () => {
  const g = qaTestGroups([
    { testKey: 'b.js' }, { testKey: 'a.js' }, { testKey: 'b.js' }, { testKey: 'b.js' },
  ]);
  assert.deepStrictEqual(g, [{ key: 'b.js', n: 3 }, { key: 'a.js', n: 1 }]);
});
test('qaTestGroups: รันที่ไม่มี key เลยรวมเป็นกองเดียว ไม่หายไป', () => {
  const g = qaTestGroups([{ testKey: '' }, {}, { testKey: 'a.js' }]);
  assert.deepStrictEqual(g, [{ key: '', n: 2 }, { key: 'a.js', n: 1 }]);
});

test('shortTestName: ชื่อไทยย่อจากท้าย เก็บหัว — ต่างกันกลางประโยคแต่ลงท้ายเหมือนกัน', () => {
  // ย่อผิดทางแล้วชิปสองอันอ่านได้เหมือนกันทุกตัวอักษร (เจอตอนตรวจบนหน้าจอจริง 2026-08-07:
  // ทั้ง 8 รอบที่มีอยู่ไม่มีบรรทัด TEST: จึงตกมาใช้ชื่อไทย แล้วสองกลุ่มโชว์ป้ายเดียวกันหมด)
  const a = shortTestName('สั่งอาหาร dine-in ผ่านแอป Zinga (native, BlueStacks)', 28);
  const b = shortTestName('สั่งอาหาร dine-in (Tyro) ผ่านแอป Zinga (native, BlueStacks)', 28);
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith('สั่งอาหาร dine-in'));
  assert.ok(b.includes('(Tyro)'));
  assert.ok(a.endsWith('…') && b.endsWith('…'));
});

// ---- กรองผลรันตามเลขงาน ----
const { qaIssueGroups, issueMatch } = require('../tab-qatest.js');

test('qaIssueGroups: เรียงงานใหม่ก่อน กองที่ยังไม่ผูกอยู่ท้ายสุด', () => {
  const g = qaIssueGroups([
    { issues: [690] }, { issues: [712] }, { issues: [690, 712] }, { issues: [] }, {},
  ]);
  assert.deepStrictEqual(g, [{ key: '712', n: 2 }, { key: '690', n: 2 }, { key: '', n: 2 }]);
});
test('qaIssueGroups: ไม่มีรอบไหนผูกกับงานเลย = กองเดียว', () => {
  assert.deepStrictEqual(qaIssueGroups([{ issues: [] }, {}]), [{ key: '', n: 2 }]);
});

test('issueMatch: "" กรองเฉพาะรอบที่ยังไม่มีใบไหนอ้างถึง', () => {
  // ค่าว่างต้องเป็นตัวกรองจริง ไม่ใช่แปลว่า "ทุกอัน" — ไม่งั้นกองนี้กดดูแยกไม่ได้
  assert.strictEqual(issueMatch({ issues: [] }, ''), true);
  assert.strictEqual(issueMatch({ issues: [690] }, ''), false);
});
test('issueMatch: เทียบเป็นสตริงเสมอ เพราะ dataset ให้มาเป็นสตริง', () => {
  assert.strictEqual(issueMatch({ issues: [690] }, '690'), true);
  assert.strictEqual(issueMatch({ issues: [690] }, '69'), false);
});

// ---- ชิป UI hierarchy ที่ถอดจากหน้าเว็บ ----
test('qiXmlChipsHtml: ไม่มีชุดเลยได้สตริงว่าง ไม่ใช่กรอบเปล่าค้างบนฟอร์ม', () => {
  assert.strictEqual(qiXmlChipsHtml([]), '');
  assert.strictEqual(qiXmlChipsHtml(null), '');
});

test('qiXmlChipsHtml: โชว์ชื่อหน้า จำนวน node และขนาด ให้ผู้ใช้รู้ว่ากำลังจะส่งอะไรไป', () => {
  const html = qiXmlChipsHtml([{ label: 'Booking Settings', url: 'https://x.test/a', nodes: 143, xml: 'x'.repeat(12288) }]);
  assert.ok(html.includes('Booking Settings'));
  assert.ok(html.includes('143 nodes'));
  assert.ok(html.includes('12 KB'), html);
});

test('qiXmlChipsHtml: มีปุ่มดูและปุ่มเอาออก พร้อม index ที่ตรงกับลำดับในอาร์เรย์', () => {
  const html = qiXmlChipsHtml([
    { label: 'A', url: '', nodes: 1, xml: 'a' },
    { label: 'B', url: '', nodes: 2, xml: 'b' },
  ]);
  assert.ok(html.includes('class="qi-xml-view" data-i="0"'), html);
  assert.ok(html.includes('class="qi-xml-drop" data-i="1"'), html);
});

test('qiXmlChipsHtml: ชื่อหน้าจากเว็บภายนอกต้องถูก escape ไม่ให้ยิง HTML เข้าฟอร์มเราได้', () => {
  const html = qiXmlChipsHtml([{ label: '<img src=x onerror=alert(1)>', url: '', nodes: 1, xml: 'a' }]);
  assert.ok(!html.includes('<img src=x'), 'title ของหน้าเว็บเป็นข้อมูลที่เราคุมไม่ได้');
  assert.ok(html.includes('&lt;img'), html);
});

// เทสข้างบนวาง label ไว้ในเนื้อความ ส่วน url อยู่ใน attribute ซึ่งแตกออกได้ด้วยอัญประกาศตัวเดียว
// — คนละช่องโหว่กัน qiThumbsHtml มีเทสคู่นี้ครบอยู่แล้ว ชิป XML ต้องมีเท่ากัน
test('qiXmlChipsHtml: url ใน attribute ต้องแตกออกมาเป็น attribute ใหม่ไม่ได้', () => {
  const html = qiXmlChipsHtml([{ label: 'ปกติ', url: 'https://x.test/" onmouseover="alert(1)', nodes: 1, xml: 'a' }]);
  assert.ok(!html.includes('onmouseover="alert'), html);
  assert.ok(html.includes('&quot;'), 'อัญประกาศต้องถูกแปลง ไม่ใช่ผ่านไปดิบ ๆ');
});

// ชิปสองแหล่งใช้คลาสเดียวกันหมด ต่างแค่ไอคอน — payload เก่าที่ไม่มี kind ต้องยังเป็น 🌐
// ไม่งั้นชิปของหน้าเว็บที่ค้างอยู่ในฟอร์มจะเปลี่ยนหน้าตาเองตอนวาดรอบถัดไป
test('qiXmlChipsHtml: ชิปจาก BlueStacks ใช้ 📱 ส่วนของหน้าเว็บยังเป็น 🌐', () => {
  const html = qiXmlChipsHtml([
    { kind: 'bluestacks', label: 'DEV · Login', xml: '<hierarchy/>', nodes: 18 },
    { label: 'Booking Settings', url: 'https://x/y', xml: '<hierarchy/>', nodes: 143 },
  ]);
  assert.ok(html.includes('📱 DEV · Login'), 'ชิป BlueStacks ต้องขึ้น 📱');
  assert.ok(html.includes('🌐 Booking Settings'), 'ชิปหน้าเว็บที่ไม่มี kind ต้องยังเป็น 🌐');
});

test('qiXmlChipsHtml: ชิป BlueStacks ที่ไม่มี label ต้องไม่ตกไปใช้คำว่า "หน้าเว็บ"', () => {
  const html = qiXmlChipsHtml([{ kind: 'bluestacks', xml: '<hierarchy/>', nodes: 3 }]);
  assert.ok(html.includes('BlueStacks'));
  assert.ok(!html.includes('หน้าเว็บ'));
});

// qiCloseForm อยู่ใน IIFE ที่พึ่ง DOM จริง เรียกตรงจาก node --test ไม่ได้ — ดักที่ระดับซอร์ส
// แทน เพราะความพลาดที่ต้องกันคือ "ลืมเพิ่มบรรทัดล้าง" ซึ่งอ่านจากซอร์สก็เห็น
// (ถ้าลืม XML ของ issue ใบก่อนจะติดไปกับใบถัดไปเงียบ ๆ แล้วร่างอ้างหน้าจอผิดหน้า)
test('qiCloseForm: ต้องล้างชุด XML และปิดหน้าต่างถอดด้วย', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tab-qatest.js'), 'utf8');
  const body = src.slice(src.indexOf('function qiCloseForm()'), src.indexOf('function qiLoadMetaForSelection'));
  assert.ok(/qiXmlDumps\s*=\s*\[\]/.test(body), 'ลืมล้าง qiXmlDumps');
  assert.ok(body.includes('closeWebGrab'), 'ลืมปิดหน้าต่างถอดตอนปิดฟอร์ม');
});

// การถอดหน้าเว็บเป็นงาน async ฝั่ง main — กดถอดแล้วกดยกเลิกฟอร์มทันก่อนผลกลับมาได้จริง
// ล้าง qiXmlDumps ตอนปิดฟอร์มอย่างเดียวไม่พอ เพราะ push เกิดหลังการล้าง
const { qiAcceptsGrab } = require('../tab-qatest.js');

test('qiAcceptsGrab: ผลที่มาถึงตอนฟอร์มปิดไปแล้วต้องถูกทิ้ง ไม่ติดไปกับ issue ใบถัดไป', () => {
  const payload = { label: 'หน้าเก่า', xml: '<hierarchy/>', nodes: 5 };
  assert.strictEqual(qiAcceptsGrab(true, payload), true);
  assert.strictEqual(qiAcceptsGrab(false, payload), false, 'ฟอร์มปิดแล้วต้องไม่รับ');
});

test('qiAcceptsGrab: ผลที่ไม่มี xml ไม่รับ แม้ฟอร์มยังเปิดอยู่', () => {
  assert.strictEqual(qiAcceptsGrab(true, { label: 'ว่าง', nodes: 0 }), false);
  assert.strictEqual(qiAcceptsGrab(true, null), false);
});
