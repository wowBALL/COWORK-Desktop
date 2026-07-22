# Close-issue preview: history vs. Test Results — design

## Problem
The Resolved → Closed button added earlier (see `2026-07-22-close-resolved-issue-design.md`) closes an issue with a bare 2-click confirm. The user wants to first see the issue's comment history compiled, laid out next to whatever's already in the "Test Results" custom field (an existing free-text field some issues have, e.g. a manual test-procedure checklist — see the #648 screenshot), read the history, and write/edit the final Test Results text themselves before closing. No AI summarization or automated comparison — the history is reference material for a human to read; the human decides what actually goes in the field.

## Flow
1. Click "ปิดงาน" (still the same icon button) on a Resolved row.
2. Button shows a brief loading state while the main process fetches the issue with `include=journals,custom_fields`.
3. A preview panel opens directly under the row with two labeled sections:
   - **"Test Results (แก้ไขได้)"** — an editable `<textarea>` pre-filled with the current value of the issue's "Test Results" custom field (empty with a placeholder if there isn't one yet). The user reads the history below and writes/edits this box directly.
   - **"ประวัติที่รวบรวมได้"** — read-only reference: every non-empty journal note on the issue, compiled chronologically as `[DD/MM/YYYY HH:mm] ผู้เขียน: ข้อความ`, separated by blank lines (or a placeholder if there are no notes).
4. Two buttons in the panel: **"ยืนยันและปิดงาน"** and **"ยกเลิก"**.
   - Cancel just removes the panel — no request sent, no state changed, textarea edits discarded.
   - Confirm sends whatever is currently in the textarea as the new Test Results value — a full overwrite of the field — and, in the same `PUT`, sets `status_id` to Closed. One request, all-or-nothing.
5. If the issue's tracker has no "Test Results" custom field at all, the panel shows a warning instead of that section and the confirm button is disabled — closing without being able to record anything into that field isn't allowed by this flow.
6. Any failure (fetching journals, or the final PUT) shows the error inline in the panel; nothing closes, the user can retry or cancel.

Only one preview panel is open at a time (opening a second one, or any change that re-renders the task list, discards the open one — same reset-on-rerender behavior the original close button already has for its armed state).

## Backend (`main.js`)

### `get-issue-preview` handler
```js
ipcMain.handle('get-issue-preview', async (_e, issueId) => {
  if (!ENV.REDMINE_URL || !ENV.REDMINE_API_KEY) return { ok: false, error: 'ยังไม่ได้ตั้งค่า .env' };
  try {
    const res = await fetch(`${ENV.REDMINE_URL}/issues/${issueId}.json?include=journals,custom_fields`,
      { headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY } });
    if (!res.ok) return { ok: false, error: `Redmine HTTP ${res.status}` };
    const { issue } = await res.json();
    const historyText = (issue.journals || [])
      .filter(j => j.notes && j.notes.trim())
      .map(j => `[${fmtDateTime(j.created_on)}] ${j.user?.name || 'ไม่ระบุ'}: ${j.notes.trim()}`)
      .join('\n\n');
    const trField = (issue.custom_fields || []).find(f => f.name === 'Test Results');
    return {
      ok: true,
      historyText,
      testResults: trField ? { fieldId: trField.id, value: trField.value || '' } : null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
```
`fmtDateTime` is a small `DD/MM/YYYY HH:mm` formatter next to the existing date helpers.

### `close-issue` handler gets an optional custom-field param
```js
ipcMain.handle('close-issue', async (_e, issueId, customField) => {
  // ...existing status_id lookup...
  const issuePayload = { status_id: closedId };
  if (customField) issuePayload.custom_fields = [{ id: customField.id, value: customField.value }];
  const res = await fetch(`${ENV.REDMINE_URL}/issues/${issueId}.json`, {
    method: 'PUT',
    headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ issue: issuePayload }),
  });
  // ...same error/success handling as before...
});
```

## Wiring (`preload.js`)
```js
getIssuePreview: (id) => ipcRenderer.invoke('get-issue-preview', id),
closeIssue: (id, customField) => ipcRenderer.invoke('close-issue', id, customField), // customField now optional
```

## Frontend (`widget.html`)

`makeCloseBtn()` changes from the 3-second-armed-timer pattern to:
1. Click → `pending` state, call `api.getIssuePreview(issueId)`.
2. On success, insert a `.testPreview` panel after the row with the editable Test Results textarea and the read-only history section (or the missing-field warning), plus Confirm/Cancel buttons. Button reverts to default (the panel itself is now the confirmation gate).
3. On fetch failure, reuse the existing `err`-flash pattern on the button; no panel opens.
4. Confirm click: read `panel.querySelector('.tp-edit').value` and send it as-is —
   ```js
   const newValue = panel.querySelector('.tp-edit').value;
   api.closeIssue(issueId, { id: testResults.fieldId, value: newValue });
   ```
   On success, no special UI handling needed — `pushTasks()` on the main-process side refetches and the row (and its panel) disappear once Resolved no longer contains this issue. On failure, show the error inline in the panel and leave it open (textarea edits preserved so the user doesn't lose their writing).
5. Cancel: remove the panel, no request, edits discarded.

### CSS
New rules for `.testPreview` (container matching the panel's existing dark-card look), section labels reusing the `.row-label` style, a scrollable read-only block for the history (`white-space: pre-wrap`), a `.tp-edit` textarea (resizable, same font as the rest of the widget) for the editable Test Results field, and an `.actions` row for the two buttons — no new color variables needed, reuses `--panel-2`, `--line`, `--accent`, `--rose`.

## Out of scope
- AI-based summarization or automated comparison between history and the existing Test Results value — explicitly rejected by the user; history is manual-review reference material only.
- Any change to issues where "Test Results" isn't a field on the tracker, beyond blocking the close with a warning.
