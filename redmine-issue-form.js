'use strict';

// ตรรกะล้วนของฟอร์มสร้าง issue ใหม่ (field discovery, payload builder, description composer,
// 422 error mapper) — ไม่มี Electron import (เหมือน grafana.js/qatest.js) จึง require ตรง
// จาก node --test ได้ ดู docs/superpowers/specs/2026-08-04-qa-create-issue-design.md

function fieldSchemaKey(projectId, trackerName) {
  return `${projectId}||${trackerName}`;
}

// แนวทาง A ของ spec: สแกน issue ที่ fetchAllIssues() ดึงมาแล้ว (include=custom_fields อยู่แล้ว
// เพื่อวาดแท็บ Redmine) แทนการเรียก /custom_fields.json ที่ต้องสิทธิ์ admin
function buildFieldSchema(issues) {
  const schema = {};
  for (const issue of issues || []) {
    if (!issue) continue;
    const projectId = issue.project && issue.project.id;
    const trackerName = issue.tracker && issue.tracker.name;
    if (projectId == null || !trackerName) continue;
    const key = fieldSchemaKey(projectId, trackerName);
    if (!schema[key]) schema[key] = [];
    for (const cf of issue.custom_fields || []) {
      if (!schema[key].some(f => f.id === cf.id)) schema[key].push({ id: cf.id, name: cf.name });
    }
  }
  return schema;
}

module.exports = { fieldSchemaKey, buildFieldSchema };
