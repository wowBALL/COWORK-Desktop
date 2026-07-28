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

test('matchMeetingId finds the exact folder', () => {
  const meetings = [{ id: '2026-07-28_10-03-standup' }, { id: '2026-07-27_09-00-other' }];
  assert.strictEqual(core.matchMeetingId('2026-07-28_10-03-standup', meetings),
    '2026-07-28_10-03-standup');
});

test('matchMeetingId prefers the highest collision suffix', () => {
  // ชื่อโฟลเดอร์ไม่มีวินาที ประชุมที่ชนกันถูกเติม -2/-3 ตัวหลังคือตัวใหม่กว่า
  const meetings = [
    { id: '2026-07-28_10-03-standup' },
    { id: '2026-07-28_10-03-standup-2' },
  ];
  assert.strictEqual(core.matchMeetingId('2026-07-28_10-03-standup', meetings),
    '2026-07-28_10-03-standup-2');
});

test('matchMeetingId does not match a different meeting that merely starts the same', () => {
  const meetings = [{ id: '2026-07-28_10-03-standup-extra' }];
  assert.strictEqual(core.matchMeetingId('2026-07-28_10-03-standup', meetings), null);
});

test('matchMeetingId returns null instead of guessing', () => {
  assert.strictEqual(core.matchMeetingId('nope', [{ id: '2026-07-28_10-03-standup' }]), null);
  assert.strictEqual(core.matchMeetingId(null, [{ id: 'x' }]), null);
  assert.strictEqual(core.matchMeetingId('x', null), null);
});

test('the five step labels match meeting-notes web/app.js exactly', () => {
  assert.deepStrictEqual(core.STEPS,
    ['บีบอัดไฟล์เสียง', 'ถอดเสียง', 'แยกผู้พูด', 'สรุป', 'เสร็จ']);
});
