# Close Resolved issue (Resolved → Closed) — design

## Problem
The widget is currently read-only — clicking a task just opens it in the browser via `shell.openExternal`. There's no way to transition an issue's status from within the app. The user wants to close (Resolved → Closed) an issue directly from the Redmine panel.

## Scope
Resolved issues only. No general status editor. Assumes the Redmine instance has a status literally named "Closed" (same assumption already made in code for "Resolved", "New", "In Progress", "Test").

## Backend (`main.js`)

### Status id lookup
Redmine's write API needs a numeric `status_id`. Fetch `GET /issue_statuses.json` once, cache a name→id map in memory:

```js
let statusIdCache = null;
async function getStatusId(name) {
  if (!statusIdCache) {
    const res = await fetch(`${ENV.REDMINE_URL}/issue_statuses.json`, { headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY } });
    if (!res.ok) throw new Error(`โหลดสถานะไม่สำเร็จ (HTTP ${res.status})`);
    const data = await res.json();
    statusIdCache = {};
    for (const s of data.issue_statuses || []) statusIdCache[s.name] = s.id;
  }
  return statusIdCache[name];
}
```

### Close-issue IPC handler
```js
ipcMain.handle('close-issue', async (_e, issueId) => {
  if (!ENV.REDMINE_URL || !ENV.REDMINE_API_KEY) return { ok: false, error: 'ยังไม่ได้ตั้งค่า .env' };
  try {
    const closedId = await getStatusId('Closed');
    if (!closedId) return { ok: false, error: 'ไม่พบสถานะ "Closed" ใน Redmine' };
    const res = await fetch(`${ENV.REDMINE_URL}/issues/${issueId}.json`, {
      method: 'PUT',
      headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: { status_id: closedId } }),
    });
    if (!res.ok) {
      let msg = `Redmine HTTP ${res.status}`;
      try { const body = await res.json(); if (body.errors) msg = body.errors.join(', '); } catch {}
      return { ok: false, error: msg };
    }
    pushTasks(); // refetch so the closed issue drops out of the Resolved group
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
```

### Issue payload gets a `status` field
`fetchRedmineTasks()` groups issues by status but doesn't currently put the status name on the issue object itself — needed so the widget can tell an issue is Resolved even when viewing the "ALL" tab (which flattens all groups). Add `status: status` to the pushed issue object at `main.js:78`.

## Wiring (`preload.js`)
```js
closeIssue: (id) => ipcRenderer.invoke('close-issue', id),
```

## Frontend (`widget.html`)

In `renderPanel()`, each row where `issue.status==='Resolved'` gets a small icon button (24×24, styled like the existing `.ctrls button`) placed after the risk badge.

### Button states
- **Default** — "✓" outline, `title="ปิดงาน (Resolved → Closed)"`.
- **Armed** (1st click) — fills amber, `title="คลิกอีกครั้งเพื่อยืนยัน"`. Auto-reverts to default after 3s if not clicked again.
- **Pending** (2nd click) — disabled/dim while `api.closeIssue(id)` is in flight.
- On success — no special handling needed; `pushTasks()` on the main-process side triggers a fresh `tasks-update` payload, which re-renders the panel and the closed issue's row simply disappears from Resolved.
- On failure — button flashes rose/red for ~2s with the error message as its `title`, then reverts to default so the user can retry.

### Interaction details
- `e.stopPropagation()` on the button's click handler so it doesn't also trigger the row's own click (which opens the issue in the browser).
- Confirm-armed state is plain in-memory (no dataset/localStorage) — since `renderPanel()` rebuilds all rows from scratch on any filter/tab change, an armed-but-unconfirmed button silently resets if the user clicks elsewhere first. This is an acceptable, arguably safer default (never a surprise close from a stale confirm state).

## Out of scope
- General status editor (any status → any status) — explicitly deferred per user's answer.
- Bulk close.
- Undo / reopening from the widget.
