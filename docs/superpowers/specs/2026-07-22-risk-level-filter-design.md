# Risk-level filter — design

## Problem
The Redmine task panel in `widget.html` already shows a per-issue risk badge (Low / Fairly Low / Moderate / Medium / High, or "–" when unset), but there's no way to filter the task list by risk level. The user wants to filter by risk the same way they already filter by project/assignee/status.

## Solution
Add a single-select risk-level filter row, styled and behaving like the existing status tabs / Workspace `wsVis`/`wsStatus` single-select chip rows.

### Placement
New row in the Redmine view, between the existing "ผู้รับผิดชอบ" (assignee) chip filter and the "สถานะ" (status) tabs:

```
row-label: ระดับความเสี่ยง
chips: [ทั้งหมด] [Low] [Fairly Low] [Moderate] [Medium] [High] [ไม่ระบุ]
```

### Behavior
- Single-select: clicking a chip filters to that risk level; clicking the already-active chip resets to "ทั้งหมด" (all). This mirrors the existing `wsVis`/`wsStatus` single-select click handlers.
- Each chip shows a count of matching issues (same `<span class="n">` pattern used elsewhere).
- Chip order is fixed severity order (not alphabetical, unlike the project/assignee multi-select chips) — ทั้งหมด, Low, Fairly Low, Moderate, Medium, High, ไม่ระบุ — since "ไม่ระบุ" and severity ordering are meaningful here where the existing alphabetical chip sort isn't.
- Color coding reuses `.rk0`–`.rk4` classes already defined for the risk badge, plus the existing dashed `.risk.rk-none` treatment for "ไม่ระบุ".

### State
```js
let selectedRisk = null; // null = "ทั้งหมด"; 'none' = "ไม่ระบุ"; else exact risk string (e.g. 'High')
```

`issueMatch()` gets one more AND condition:
```js
&& (selectedRisk===null || (selectedRisk==='none' ? !issue.risk : issue.risk===selectedRisk))
```

### Data refresh guard
On each new `renderTasks(payload)` call, if `selectedRisk` is a concrete risk value that's no longer present in the new payload's issues, reset it to `null` — same pattern already used to drop stale `selectedProjects`/`selectedAssignees` entries. ("ไม่ระบุ" and `null` never need dropping since they aren't tied to a specific value that can disappear.)

## Scope
Single-file change to `widget.html`: new CSS row (reuses existing `.chip`/`.tab`-style classes, no new classes needed beyond what already exists for risk badges), new HTML row, new JS state + render function + wiring into `issueMatch()`/`renderTasks()`.

No other files, no persistence beyond in-memory state (consistent with how the other filters already work — they reset on reload).
