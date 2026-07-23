# Closed-issues tab, real greeting name, Redmine stat tiles — design

## Problem
Three widget improvements requested together:
1. Closed issues are invisible — `fetchRedmineTasks()` queries `status_id=open` only, so there's no way to see anything that's been closed.
2. The greeting ("Good morning, Ball") hardcodes the name "Ball" in `widget.html` instead of using the actual logged-in Redmine user.
3. The "ภาพรวม vault" stat tiles at the bottom are hardcoded placeholder numbers (7/398/575/12) unrelated to Redmine, noted in `README.md` as a stub never connected to real data.

## Design

### 1. Closed issues → a "Closed" status tab
`fetchRedmineTasks()` in `main.js` currently makes one request (`status_id=open&limit=100`). It now makes two, in parallel:
- unchanged: `status_id=open&limit=100&sort=project:asc,priority:desc` (existing behavior, untouched)
- new: `status_id=closed&limit=50&sort=updated_on:desc` (most-recently-closed first)

Fetching them as **separate, independently-limited** requests (rather than `status_id=*` with one shared limit) avoids a large backlog of old closed issues crowding out open ones once merged under one `limit=100`.

Both result sets feed the same `byStatus` grouping as today. `STATUS_ORDER` gains `'Closed'` after `'Resolved'`. No `widget.html` changes are needed for the tab itself — `renderTabs()` already renders one tab per group in `lastPayload.groups`, and unrecognized status names already fall back to `var(--dim)` in `STATUS_COLOR`, which happens to read correctly as "closed = muted" without any code change.

If the closed-issues request fails, degrade silently to an empty closed list (`closedRes.ok ? ... : []`) rather than failing the whole payload — the open-issues path (primary data) stays independent.

### 2. Greeting uses the real Redmine user
New cached helper in `main.js`:
```js
let currentUserCache = null;
async function getCurrentUserName() {
  if (currentUserCache) return currentUserCache;
  if (!ENV.REDMINE_URL || !ENV.REDMINE_API_KEY) return null;
  try {
    const res = await fetch(`${ENV.REDMINE_URL}/users/current.json`, { headers: { 'X-Redmine-API-Key': ENV.REDMINE_API_KEY } });
    if (!res.ok) return null;
    const { user } = await res.json();
    currentUserCache = `${user.firstname} ${user.lastname}`.trim();
    return currentUserCache;
  } catch { return null; }
}
```
Fetched once (cached after first success), included in the existing `tasks-update` payload as `currentUser` — no new IPC channel. `pushTasks()` becomes:
```js
Promise.all([fetchRedmineTasks(), getCurrentUserName()]).then(([payload, currentUser]) =>
  win && win.webContents.send('tasks-update', { ...payload, currentUser }));
```
In `widget.html`, `renderTasks()` stores `currentUserName = payload.currentUser || ''`; the per-second `tick()` clock function (which currently hardcodes `', Ball'`) uses it instead, and shows no name at all until the first payload arrives (no flash of a wrong placeholder name).

### 3. "ภาพรวม vault" → real Redmine stat tiles
Heading changes to "ภาพรวม Redmine". The four hardcoded `.stat` tiles are replaced with a `renderRmStats(stats)` function populating the same `.stat`/`.stats` markup and CSS already used elsewhere (Workspace tab's stat tiles use the identical pattern) — no new CSS.

`fetchRedmineTasks()` computes `stats` while it already iterates issues to build `byStatus` (no extra API calls):
- **OPEN** — `openIssues.length`
- **HIGH RISK** — open issues where `topRisk(issue) === 'High'`
- **OVERDUE** — open issues where `due_date` is set and before today
- **CLOSED** — `closedIssues.length` (same number the Closed tab shows — the two are always in sync since they come from the same fetch)

Risk and overdue are computed only over **open** issues — a closed high-risk issue isn't actionable anymore, so it shouldn't count toward "things needing attention."

## Out of scope
- Any change to how the Closed tab's rows render (reuses `renderPanel()` as-is).
- Pagination or "load more" for closed issues beyond the 50-item cap.
- Editing/closing-from-widget behavior for issues already Closed (the existing "ปิดงาน" button still only appears for `status==='Resolved'`, unchanged).
