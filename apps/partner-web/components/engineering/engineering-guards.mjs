/** Pure guards for Partner engineering UI (Capability F). */

export const FORBIDDEN_ENGINEERING_KEYS = [
  'internalEngineeringNotes',
  'internalNotes',
  'engineeringInternalNote',
  'scoInternalComment',
  'rawReviewNotes',
];

export function findForbiddenEngineeringKeys(value, path = '') {
  const hits = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...findForbiddenEngineeringKeys(item, `${path}[${index}]`)));
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_ENGINEERING_KEYS.includes(key)) hits.push(next);
    hits.push(...findForbiddenEngineeringKeys(child, next));
  }
  return hits;
}

export function stripForbiddenEngineeringFields(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => stripForbiddenEngineeringFields(item));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ENGINEERING_KEYS.includes(key)) continue;
    out[key] = stripForbiddenEngineeringFields(child);
  }
  return out;
}

export function canHandoffToProcurement(detail) {
  if (!detail) return false;
  const status = String(detail.status || '').toUpperCase();
  const approved = status === 'APPROVED' || status === 'COMPLETED';
  if (!approved) return false;
  if (detail.handoff?.handedOff && !detail.handoff?.canCreateHandoff) return false;
  return Boolean(detail.handoff?.canCreateHandoff);
}

export function assertNoInternalNotesInText(text) {
  const snippets = [
    'internalEngineeringNotes',
    'internalNotes',
    'engineeringInternalNote',
    'ملاحظة داخلية هندسية',
    'ملاحظات المراجعة الداخلية',
  ];
  return snippets.filter((snippet) => text.includes(snippet));
}
