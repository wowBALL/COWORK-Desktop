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
