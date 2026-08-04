'use strict';

// ตรรกะล้วนของฟอร์มสร้าง issue ใหม่ (field discovery, payload builder, description composer,
// 422 error mapper) — ไม่มี Electron import (เหมือน grafana.js/qatest.js) จึง require ตรง
// จาก node --test ได้ ดู docs/superpowers/specs/2026-08-04-qa-create-issue-design.md

function fieldSchemaKey(projectId, trackerName) {
  return `${projectId}||${trackerName}`;
}

// low → high severity — ตรงกับ <option> ของ <select id="qiRiskLevel"> ใน widget.html เป๊ะ
const RISK_LEVELS = ['Low', 'Fairly Low', 'Moderate', 'High', 'Very High'];

// LLM บางทีตอบ suggested_risk_level มาไม่ตรง casing/ช่องว่างเป๊ะกับ <option> (เช่น "very high"
// หรือ "High ") ทำให้ <select>.value เซ็ตไม่ติด แล้ว dropdown เด้งกลับไป "(ไม่ระบุ)" เงียบ ๆ —
// จับคู่แบบ case/whitespace-insensitive แล้วคืน canonical string ให้ตรงกับ <option> เป๊ะ
function canonicalRiskLevel(value) {
  const norm = String(value || '').trim().toLowerCase();
  return RISK_LEVELS.find(r => r.toLowerCase() === norm) || '';
}

// แนวทาง A ของ spec: สแกน issue ที่ fetchAllIssues() ดึงมาแล้ว (include=custom_fields อยู่แล้ว
// เพื่อวาดแท็บ Redmine) แทนการเรียก /custom_fields.json ที่ต้องสิทธิ์ admin
function buildFieldSchema(issues) {
  const schema = {};
  for (const issue of issues || []) {
    if (!issue) continue;
    const projectId = issue.project && issue.project.id;
    const projectIdentifier = issue.project && issue.project.identifier;
    const trackerName = issue.tracker && issue.tracker.name;
    if (projectId == null || !trackerName) continue;
    // ลงทะเบียนซ้ำสองคีย์ (numeric id + identifier ถ้ามี) — main.js:395 ใส่ identifier||id ลง
    // qiKnownProjects แต่ในทางปฏิบัติ Redmine ไม่เคยส่ง identifier มาใน issue.project ตอนนี้
    // (เลยเป็น id เสมอ) ทำแบบนี้กันพังเงียบๆ ถ้า Redmine เปลี่ยน response shape ในอนาคต
    const keys = [fieldSchemaKey(projectId, trackerName)];
    if (projectIdentifier) keys.push(fieldSchemaKey(projectIdentifier, trackerName));
    for (const key of keys) {
      if (!schema[key]) schema[key] = [];
      for (const cf of issue.custom_fields || []) {
        if (!schema[key].some(f => f.id === cf.id)) schema[key].push({ id: cf.id, name: cf.name });
      }
    }
  }
  return schema;
}

function composeDescription(language, th, en) {
  const thBlock = th ? `## 🇹🇭 รายละเอียด (ไทย)\n\n${th}` : '';
  const enBlock = en ? `## 🇬🇧 Details (English)\n\n${en}` : '';
  if (language === 'th') return thBlock;
  if (language === 'en') return enBlock;
  return [enBlock, thBlock].filter(Boolean).join('\n\n---\n\n');
}

function buildIssuePayload(form, ids) {
  const issue = {
    project_id: form.projectId,
    tracker_id: ids.trackerIdByName[form.trackerName],
    subject: form.subject,
    description: form.description,
    priority_id: ids.priorityIdByName[form.priorityName],
  };
  if (form.assigneeId) issue.assigned_to_id = form.assigneeId;

  const customFields = [];
  if (ids.riskLevelFieldId && form.riskLevel) {
    customFields.push({ id: ids.riskLevelFieldId, value: form.riskLevel });
  }
  for (const [fieldId, value] of Object.entries(form.customFieldValues || {})) {
    if (value) customFields.push({ id: Number(fieldId), value });
  }
  if (customFields.length) issue.custom_fields = customFields;

  if (form.uploads && form.uploads.length) issue.uploads = form.uploads;

  return { issue };
}

function parseValidationErrors(errorMessages, knownFieldNames) {
  const names = knownFieldNames || [];
  return (errorMessages || []).map(msg => {
    const hit = names.find(name => msg.toLowerCase().includes(name.toLowerCase()));
    return { message: msg, fieldName: hit || null };
  });
}

module.exports = {
  fieldSchemaKey, buildFieldSchema, composeDescription, buildIssuePayload, parseValidationErrors,
  canonicalRiskLevel,
};
