const test = require('node:test');
const assert = require('node:assert');
const core = require('../meetingrun.js');

test('fmtClock pads to HH:MM:SS', () => {
  assert.strictEqual(core.fmtClock(0), '00:00:00');
  assert.strictEqual(core.fmtClock(61), '00:01:01');
  assert.strictEqual(core.fmtClock(3671), '01:01:11');
});

test('fmtClock survives junk instead of throwing', () => {
  assert.strictEqual(core.fmtClock(null), '00:00:00');
  assert.strictEqual(core.fmtClock(-5), '00:00:00');
  assert.strictEqual(core.fmtClock('abc'), '00:00:00');
});

test('jobStemOf strips the windows path and the extension', () => {
  assert.strictEqual(
    core.jobStemOf('D:\\COWORK\\meeting-notes\\inbox\\2026-07-28_10-03-standup.ogg'),
    '2026-07-28_10-03-standup');
  assert.strictEqual(core.jobStemOf('inbox/a-b.ogg'), 'a-b');
  assert.strictEqual(core.jobStemOf(null), null);
});

test('progressOf returns null when no job is being followed', () => {
  assert.strictEqual(core.progressOf([{ job: 'x', code: 'queued' }], null), null);
});

test('progressOf starts at stage 0 when the job has no events yet', () => {
  assert.deepStrictEqual(core.progressOf([], 'job1'), { stage: 0, failed: false });
});

test('progressOf takes the LATEST known event, not a running count', () => {
  // เหตุการณ์เรียงย้อนขั้นได้จริงเมื่อ diarize ล้มแล้วไปต่อที่ summarize
  const activity = [
    { job: 'job1', code: 'queued' },
    { job: 'job1', code: 'diarize_started' },
    { job: 'job1', code: 'summarize_started' },
  ];
  assert.deepStrictEqual(core.progressOf(activity, 'job1'), { stage: 3, failed: false });
});

test('progressOf ignores events belonging to another job', () => {
  const activity = [
    { job: 'other', code: 'meeting_done' },
    { job: 'job1', code: 'transcribe_started' },
  ];
  assert.deepStrictEqual(core.progressOf(activity, 'job1'), { stage: 1, failed: false });
});

test('progressOf flags failure but keeps the stage it reached', () => {
  const activity = [
    { job: 'job1', code: 'summarize_started' },
    { job: 'job1', code: 'job_failed' },
  ];
  assert.deepStrictEqual(core.progressOf(activity, 'job1'), { stage: 3, failed: true });
});

test('progressOf ignores codes it does not know', () => {
  const activity = [
    { job: 'job1', code: 'transcribe_started' },
    { job: 'job1', code: 'part_closed' },
  ];
  assert.deepStrictEqual(core.progressOf(activity, 'job1'), { stage: 1, failed: false });
});

// เคสข้างล่างนี้ลอกมาจาก D:\COWORK\meeting-notes\state\activity.jsonl ของจริง
// (28 ก.ค. 2026) ไม่ใช่ค่าที่แต่งขึ้น -- รอบก่อนเทสผ่านหมดทั้งที่โค้ดใช้ไม่ได้
// เพราะข้อมูลสมมติเข้ารูปกับสมมติฐานที่ผิดพอดี
test('finishedMeetingId takes the folder from meeting_done, for a named room', () => {
  // ชื่อไฟล์ใน inbox กับชื่อโฟลเดอร์คนละรูปแบบ: ชื่อห้องย้ายไปท้าย วินาทีหายไป
  const activity = [
    { job: 'ทดสอบประชุม 1', code: 'encode_done',
      params: { path: 'D:\\COWORK\\meeting-notes\\inbox\\ทดสอบประชุม 1-13-49-53.ogg' } },
    { job: 'ทดสอบประชุม 1-13-49-53', code: 'transcribe_started', params: {} },
    { job: 'ทดสอบประชุม 1-13-49-53', code: 'meeting_done',
      params: { path: 'D:\\COWORK\\meeting-notes\\meetings\\2026-07-28_13-49-ทดสอบประชุม 1' } },
  ];
  assert.strictEqual(core.finishedMeetingId(activity, 'ทดสอบประชุม 1-13-49-53'),
    '2026-07-28_13-49-ทดสอบประชุม 1');
});

test('finishedMeetingId works for an unnamed room, where the folder is SHORTER than the stem', () => {
  const activity = [
    { job: '2026-07-28_13-48-56', code: 'meeting_done',
      params: { path: 'D:\\COWORK\\meeting-notes\\meetings\\2026-07-28_13-48' } },
  ];
  assert.strictEqual(core.finishedMeetingId(activity, '2026-07-28_13-48-56'), '2026-07-28_13-48');
});

test('finishedMeetingId ignores meeting_done belonging to another job', () => {
  const activity = [
    { job: 'other', code: 'meeting_done',
      params: { path: 'D:\\meetings\\2026-07-27_20-38-test 111' } },
    { job: 'mine', code: 'diarize_started', params: {} },
  ];
  assert.strictEqual(core.finishedMeetingId(activity, 'mine'), null);
});

test('finishedMeetingId returns null instead of guessing', () => {
  assert.strictEqual(core.finishedMeetingId([], 'job1'), null);
  assert.strictEqual(core.finishedMeetingId(null, 'job1'), null);
  assert.strictEqual(core.finishedMeetingId([{ job: 'job1', code: 'meeting_done' }], 'job1'), null);
  assert.strictEqual(core.finishedMeetingId(
    [{ job: 'job1', code: 'meeting_done', params: { path: 'D:\\m\\x' } }], null), null);
});

test('finishedMeetingId tolerates a trailing separator on the path', () => {
  const activity = [{ job: 'j', code: 'meeting_done', params: { path: 'D:\\m\\2026-07-28_13-48\\' } }];
  assert.strictEqual(core.finishedMeetingId(activity, 'j'), '2026-07-28_13-48');
});

test('the five step labels match meeting-notes web/app.js exactly', () => {
  assert.deepStrictEqual(core.STEPS,
    ['บีบอัดไฟล์เสียง', 'ถอดเสียง', 'แยกผู้พูด', 'สรุป', 'เสร็จ']);
});

// บันไดการเลือก view -- ย้ายออกมาจาก draw() ซึ่งแตะ DOM จึงเทสไม่ได้
// ชุดนี้คือ baseline ของพฤติกรรมเดิม ต้องผ่านทั้งก่อนและหลังเปลี่ยนข้อความเป็น On Air
const IDLE = { recorder: 'idle', activity: [], worker_ready: true };

test('viewOf: ไม่มี state และเครื่องนี้ไม่เคยเห็น service = ไม่วาดอะไร', () => {
  assert.strictEqual(core.viewOf({ state: null, seenService: false }), 'absent');
});

test('viewOf: ไม่มี state แต่เคยเห็น service = บอกว่ากำลังรอ', () => {
  assert.strictEqual(core.viewOf({ state: null, seenService: true }), 'waiting');
});

test('viewOf: กำลังอัด และกำลังปิดห้อง ถือเป็น recording ทั้งคู่', () => {
  assert.strictEqual(core.viewOf({ state: { recorder: 'recording' } }), 'recording');
  assert.strictEqual(core.viewOf({ state: { recorder: 'stopping' } }), 'recording');
});

test('viewOf: ว่างและไม่ได้ตามงานอยู่ = idle', () => {
  assert.strictEqual(core.viewOf({ state: IDLE, following: false }), 'idle');
});

test('viewOf: งานล้มชนะทุกขั้น', () => {
  assert.strictEqual(core.viewOf({
    state: IDLE, following: true, progress: { stage: 3, failed: true },
  }), 'failed');
});

test('viewOf: ถึงขั้น 4 = done', () => {
  assert.strictEqual(core.viewOf({
    state: IDLE, following: true, progress: { stage: 4, failed: false },
  }), 'done');
});

test('viewOf: ขั้น 0 และ worker ไม่พร้อม = queued ไม่ใช่ processing', () => {
  assert.strictEqual(core.viewOf({
    state: { recorder: 'idle', activity: [], worker_ready: false },
    following: true,
    progress: { stage: 0, failed: false },
  }), 'queued');
});

test('viewOf: ขั้น 0 แต่ worker พร้อม = processing', () => {
  assert.strictEqual(core.viewOf({
    state: IDLE, following: true, progress: { stage: 0, failed: false },
  }), 'processing');
});

test('viewOf: state ที่ไม่มีฟิลด์ worker_ready เลย = processing ไม่ใช่ queued', () => {
  // โค้ดเทียบด้วย === false โดยตั้งใจ: service เวอร์ชันที่ยังไม่ส่งฟิลด์นี้มา ต้องไม่ถูก
  // อ่านว่า "ตัวประมวลผลไม่พร้อม" แล้วค้างเป็น queued ทั้งที่ไปป์ไลน์เดินอยู่
  assert.strictEqual(core.viewOf({
    state: { recorder: 'idle', activity: [] },
    following: true,
    progress: { stage: 0, failed: false },
  }), 'processing');
});

test('viewOf: เลิกตามงานแล้ว (กด ✕) แต่ progress ยังมีค่า = idle', () => {
  // เส้นทางจริงหลังผู้ใช้กด ✕: draw() ยังคำนวณ progress ได้ตามเดิม แต่ following
  // เป็น false เพราะ followingJob === dismissedJob -- ต้องกลับไปที่แถบว่าง
  assert.strictEqual(core.viewOf({
    state: IDLE, following: false, progress: { stage: 4, failed: false },
  }), 'idle');
});

test('viewOf: กลางไปป์ไลน์ = processing', () => {
  assert.strictEqual(core.viewOf({
    state: IDLE, following: true, progress: { stage: 2, failed: false },
  }), 'processing');
});

test('viewOf: พร้อมแล้วแต่ยังอ่านสถานะไม่ได้ = connecting ไม่ใช่ waiting', () => {
  assert.strictEqual(core.viewOf({ ready: true, state: null, seenService: true }), 'connecting');
});

test('viewOf: connecting ต้องมาก่อนแม้เครื่องนี้ยังไม่เคยเห็น service', () => {
  // GET / ตอบแล้วคือเห็นแล้ว -- ไม่ควรตกไปที่ absent ซึ่งไม่วาดอะไรเลย
  assert.strictEqual(core.viewOf({ ready: true, state: null, seenService: false }), 'connecting');
});

test('viewOf: ไม่พร้อมและไม่มี state ยังตัดสินด้วย seenService เหมือนเดิม', () => {
  assert.strictEqual(core.viewOf({ ready: false, state: null, seenService: true }), 'waiting');
  assert.strictEqual(core.viewOf({ ready: false, state: null, seenService: false }), 'absent');
});

test('viewOf: มี state แล้ว ready ไม่มีผลต่อการเลือก view', () => {
  // ความพร้อมเป็นเรื่องของ "คุยได้ไหม" สถานะจริงมาจาก /api/state เท่านั้น
  assert.strictEqual(core.viewOf({ ready: true, state: { recorder: 'recording' } }), 'recording');
  assert.strictEqual(core.viewOf({ ready: false, state: { recorder: 'recording' } }), 'recording');
});

test('viewWaiting บอก OFF AIR และยังบอกวิธีเปิด service', () => {
  const html = core.viewWaiting();
  assert.match(html, /OFF AIR/);
  assert.match(html, /start-ui\.bat/);
  assert.match(html, /data-s="waiting"/);
});

// ON AIR = เสียงกำลังเข้าจริงเท่านั้น -- view `recording` กินทั้งช่วงอัดและช่วงปิด
// (นาฬิกาและปุ่มปิดห้องอยู่ที่นั้นทั้งคู่) ตัวที่ต้องแยกคือป้าย
test('airTagOf: กำลังอัดอยู่ = ON AIR', () => {
  assert.strictEqual(core.airTagOf('recording'), 'ON AIR');
});

test('airTagOf: สั่งปิดแล้วแต่ยังบีบอัดไฟล์อยู่ = กำลังปิด ไม่ใช่ ON AIR', () => {
  // 'stopping' ค้างอยู่จนไฟล์ถูก drain และ encode เสร็จ -- เป็นสิบวินาทีถึงเป็นนาที
  // ในประชุมยาว และไม่มีเสียงเข้าเลยในช่วงนั้น
  assert.strictEqual(core.airTagOf('stopping'), 'กำลังปิด');
});

test('airTagOf: ค่าที่ไม่คาดคิดต้องไม่ติดไฟแดง', () => {
  // ป้าย ON AIR ต้องได้มาจากหลักฐานเดียวคือ recorder === 'recording'
  assert.strictEqual(core.airTagOf('idle'), 'กำลังปิด');
  assert.strictEqual(core.airTagOf(undefined), 'กำลังปิด');
});

test('viewConnecting บอกว่ารอความพร้อม และต้องไม่มีปุ่มเปิดห้อง', () => {
  const html = core.viewConnecting();
  assert.match(html, /รอความพร้อม ก่อน On Air/);
  assert.match(html, /data-s="connecting"/);
  // assert ที่การไม่มีปุ่ม ไม่ใช่แค่ข้อความ -- ข้อความถูกได้ทั้งที่ปุ่มยังโผล่
  assert.doesNotMatch(html, /data-act="open"/);
  assert.doesNotMatch(html, /<button/);
});
