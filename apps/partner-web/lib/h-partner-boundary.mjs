/**
 * Capability H — Partner confidentiality boundary (internal Operational Platform).
 * No Partner H product surface. Shared helpers for nav/DTO/path/leakage guards.
 */

export const FORBIDDEN_H_NAV_HREFS = [
  '/portal/operations',
  '/portal/work-queue',
  '/portal/work-items',
  '/portal/exceptions',
  '/portal/jobs',
  '/portal/ops-health',
  '/portal/ops-config',
  '/portal/cycles',
  '/portal/cycles/manage',
  '/portal/audit',
  '/portal/audit/evidence',
  '/operations',
  '/work-items',
  '/exceptions',
  '/jobs',
  '/retry',
  '/health',
  '/config',
  '/cycles/manage',
  '/audit/evidence',
];

export const FORBIDDEN_H_NAV_LABELS = [
  'Work Queue',
  'Operations',
  'Operational Platform',
  'Exception Queue',
  'Job Runner',
  'Retry Controls',
  'Operational Health',
  'Operational Config',
  'Cycle Admin',
  'Audit Evidence',
  'طابور العمل',
  'المنصة التشغيلية',
  'الاستثناءات التشغيلية',
  'المهام التشغيلية',
  'صحة التشغيل',
  'إعدادات التشغيل',
  'إدارة الدورات',
  'أدلة التدقيق',
];

/**
 * Candidate H HTTP paths — Partner must receive 401/403/404, never 200 with ops payload.
 * Includes order attack surfaces + Cursor3 internal controller paths.
 */
export const H_ENDPOINT_CANDIDATES = [
  // Order attack surfaces (Partner-prefixed guesses)
  '/api/v1/partner/operations',
  '/api/v1/partner/work-items',
  '/api/v1/partner/exceptions',
  '/api/v1/partner/jobs',
  '/api/v1/partner/retry',
  '/api/v1/partner/health',
  '/api/v1/partner/config',
  '/api/v1/partner/cycles/manage',
  '/api/v1/partner/audit/evidence',
  '/api/v1/partner/operations/work-queue',
  '/api/v1/partner/operations/health',
  '/api/v1/partner/operations/config',
  // Bare attack paths from order
  '/operations',
  '/work-items',
  '/exceptions',
  '/jobs',
  '/retry',
  '/config',
  '/cycles/manage',
  '/audit/evidence',
  // Legacy / alternate internal mounts
  '/api/v1/operations',
  '/api/v1/operations/work-items',
  '/api/v1/operations/exceptions',
  '/api/v1/operations/jobs',
  '/api/v1/operations/retry',
  '/api/v1/operations/health',
  '/api/v1/operations/config',
  '/api/v1/operations/cycles/manage',
  '/api/v1/operations/audit/evidence',
  '/api/v1/internal/operations',
  '/api/v1/internal/operations/work-items',
  '/api/v1/internal/operations/exceptions',
  '/api/v1/internal/operations/jobs',
  '/api/v1/internal/operations/health',
  '/api/v1/internal/operations/config',
  '/api/v1/internal/operations/cycles',
  '/api/v1/internal/operations/audit/evidence',
  // Cursor3 H controller (ScoInternalGuard)
  '/api/v1/internal/h-operations/work-items',
  '/api/v1/internal/h-operations/exceptions',
  '/api/v1/internal/h-operations/jobs',
  '/api/v1/internal/h-operations/health',
  '/api/v1/internal/h-operations/config',
  '/api/v1/internal/h-operations/cycles',
  '/api/v1/internal/h-operations/notifications',
  '/api/v1/internal/h-operations/audit-evidence',
  '/api/v1/internal/h-operations/work-items/11111111-1111-4111-8111-111111111111',
  '/api/v1/internal/h-operations/exceptions/11111111-1111-4111-8111-111111111111',
  '/api/v1/internal/h-operations/cycles/11111111-1111-4111-8111-111111111111',
  '/api/v1/internal/h-operations/jobs/11111111-1111-4111-8111-111111111111',
];

/** Fields that must never appear on Partner DTOs / error bodies for H. */
export const FORBIDDEN_PARTNER_OPERATIONS_KEYS = [
  'assignedTo',
  'assignedUserId',
  'assigneeUserId',
  'assignedScoEmployee',
  'internalNote',
  'internalNotes',
  'blockedReason',
  'exceptionMessage',
  'exceptionType',
  'safeErrorMessage',
  'safeErrorCode',
  'jobId',
  'jobType',
  'jobPayload',
  'retryCount',
  'attemptCount',
  'operationalPriority',
  'priority',
  'workQueue',
  'workItemId',
  'workType',
  // Note: PartnerJourney.nextAction is an approved A–C field — do not forbid bare nextAction on Partner* DTOs.
  'cycleId',
  'cycleCode',
  'cycleMembership',
  'operationalConfig',
  'opsHealth',
  'healthStatus',
  'auditEvidence',
  'technicalFailure',
  'stackTrace',
  'retryControls',
];

export function findForbiddenKeys(value, forbiddenKeys = FORBIDDEN_PARTNER_OPERATIONS_KEYS, path = '') {
  const hits = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...findForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
    });
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (forbiddenKeys.includes(key)) hits.push(next);
    hits.push(...findForbiddenKeys(child, forbiddenKeys, next));
  }
  return hits;
}

export function stripForbiddenKeys(value, forbiddenKeys = FORBIDDEN_PARTNER_OPERATIONS_KEYS) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => stripForbiddenKeys(item, forbiddenKeys));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.includes(key)) continue;
    out[key] = stripForbiddenKeys(child, forbiddenKeys);
  }
  return out;
}

export function navContainsForbiddenH(navItems) {
  const hits = [];
  for (const item of navItems ?? []) {
    const href = String(item.href ?? '');
    const label = String(item.label ?? '');
    if (FORBIDDEN_H_NAV_HREFS.some((blocked) => href === blocked || href.startsWith(`${blocked}/`))) {
      hits.push(`href:${href}`);
    }
    if (FORBIDDEN_H_NAV_LABELS.some((blocked) => label.includes(blocked))) {
      hits.push(`label:${label}`);
    }
  }
  return hits;
}

/** Filter nav to enforce H isolation even if a future edit adds entries. */
export function filterPartnerHNav(navItems) {
  return (navItems ?? []).filter((item) => navContainsForbiddenH([item]).length === 0);
}

export function contractsClientExposesPartnerH(apiSourceText) {
  const patterns = [
    /partnerOperations/,
    /partnerWorkQueue/,
    /partnerWorkItems/,
    /partnerExceptions/,
    /partnerOpsJobs/,
    /partnerOpsHealth/,
    /partnerOpsConfig/,
    /partnerCycleManage/,
    /partnerAuditEvidence/,
    /\/api\/v1\/partner\/operations/,
    /\/api\/v1\/partner\/work-items/,
    /\/api\/v1\/partner\/exceptions/,
    /\/api\/v1\/partner\/jobs/,
    /\/api\/v1\/partner\/cycles\/manage/,
    /\/api\/v1\/partner\/audit\/evidence/,
    /internalHOperations/,
    /hOperationsPartner/,
  ];
  return patterns.filter((re) => re.test(apiSourceText)).map((re) => String(re));
}

export function partnerDtoTypeHasForbiddenHFields(apiSourceText) {
  const hits = [];
  const typeRe = /export type (Partner\w+)\s*=\s*\{([\s\S]*?)\n\};/g;
  let match;
  while ((match = typeRe.exec(apiSourceText))) {
    const name = match[1];
    const body = match[2];
    for (const key of FORBIDDEN_PARTNER_OPERATIONS_KEYS) {
      // `priority` alone is too broad for Partner commercial lines — only flag clear H fields
      // and allow benign Partner status fields. Skip bare `priority` on Partner* types unless
      // the type name looks operational.
      if (key === 'priority' && !/Operat|Work|Exception|Job|Cycle|Queue/i.test(name)) continue;
      const prop = new RegExp(`(^|\\n)\\s*${key}\\??\\s*:`);
      if (prop.test(body)) hits.push(`${name}.${key}`);
    }
  }
  return hits;
}

export function isDeniedPartnerStatus(status) {
  return status === 401 || status === 403 || status === 404;
}

export function errorPayloadLooksSafe(payloadText) {
  if (!payloadText) return true;
  const lower = payloadText.toLowerCase();
  const bad = [
    'select ',
    ' from ',
    'purchasecost',
    'grossmargin',
    'suppliercanonical',
    'assigneduserid',
    'blockedreason',
    'exceptionmessage',
    'jobpayload',
    'stack trace',
    'at object.',
    'pg_catalog',
    'h_work_items',
    'h_exceptions',
    'h_jobs',
  ];
  return !bad.some((snippet) => lower.includes(snippet));
}
