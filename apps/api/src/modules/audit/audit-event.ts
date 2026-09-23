export type AuditScope = 'TENANT' | 'SYSTEM' | 'SCO_INTERNAL' | 'PRE_TENANT';
export type AuditEvent = {
  actorUserId?: string;
  companyId?: string;
  scope: AuditScope;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
};
