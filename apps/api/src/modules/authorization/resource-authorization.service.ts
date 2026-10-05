import { HttpException, Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http/api-error.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MembershipsService } from '../identity/memberships.service.js';
import { PartnerProcurementAccessService } from '../identity/partner-procurement-access.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { PurposeAuthorizationService } from '../rbac/purpose-authorization.service.js';
import type { PurposeRequirement } from '../rbac/purpose-registry.js';
import { operationDescriptor } from './authorization-operations.js';
import type {
  AuthorizationDecision,
  AuthorizationDenyReason,
  AuthorizationEvidence,
  AuthorizationLayer,
  ResourceAuthorizationRequest,
} from './resource-authorization.types.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);

function samePurposeRequirement(a: PurposeRequirement, b: PurposeRequirement): boolean {
  if (a.kind !== b.kind || a.purpose !== b.purpose) return false;
  return a.kind === 'PURPOSE_ONLY' || (b.kind === 'CROSS_PURPOSE_FLOW' && a.flow.id === b.flow.id);
}

// Composes the already-existing authorization layers for one operation. It owns no state and no domain
// transitions: every fact is read from its authoritative owner (membership, RBAC, purpose registry, the Class D
// Partner access function). Layers only ever narrow; the first failing layer denies.
@Injectable()
export class ResourceAuthorizationService {
  constructor(
    @Inject(MembershipsService) private readonly memberships: MembershipsService,
    @Inject(RuntimeDatabaseService) private readonly runtime: RuntimeDatabaseService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(PurposeAuthorizationService) private readonly purposes: PurposeAuthorizationService,
    @Inject(PartnerProcurementAccessService) private readonly partnerAccess: PartnerProcurementAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async decide(request: ResourceAuthorizationRequest): Promise<AuthorizationDecision> {
    const evidence: AuthorizationEvidence = { operation: null, purposeCode: null, resourceKind: null, evaluatedLayers: [], failedLayer: null };
    const enter = (layer: AuthorizationLayer) => { evidence.evaluatedLayers.push(layer); };
    const deny = (layer: AuthorizationLayer, reason: AuthorizationDenyReason): AuthorizationDecision => {
      evidence.failedLayer = layer;
      return { allowed: false, reason, evidence };
    };

    enter('CONTEXT');
    const tenant = request.tenant;
    if (!tenant) return deny('CONTEXT', 'ACTOR_CONTEXT_REQUIRED');
    if (!isUuid(tenant.userId) || !isUuid(tenant.companyId) || !isUuid(tenant.membershipId) || tenant.status !== 'ACTIVE') {
      return deny('CONTEXT', 'ACTOR_CONTEXT_MALFORMED');
    }

    enter('OPERATION');
    const descriptor = operationDescriptor(request.operation);
    if (!descriptor) return deny('OPERATION', 'OPERATION_UNKNOWN');
    evidence.operation = request.operation as string;
    evidence.purposeCode = descriptor.purpose.purpose;
    evidence.resourceKind = descriptor.resource.kind;

    enter('RESOURCE_CONTEXT');
    const resource = request.resource;
    if (resource?.id === undefined || resource.id === null || resource.id === '') return deny('RESOURCE_CONTEXT', 'RESOURCE_CONTEXT_REQUIRED');
    if (!isUuid(resource.id)) return deny('RESOURCE_CONTEXT', 'RESOURCE_CONTEXT_MALFORMED');

    try {
      enter('MEMBERSHIP');
      let membershipId: string;
      try {
        membershipId = (await this.memberships.requireActiveMembership(tenant.userId, tenant.companyId)).membershipId;
      } catch (error) {
        if (error instanceof HttpException) return deny('MEMBERSHIP', 'MEMBERSHIP_INACTIVE');
        throw error;
      }
      if (membershipId !== tenant.membershipId) return deny('MEMBERSHIP', 'MEMBERSHIP_MISMATCH');

      enter('COMPANY');
      const company = await this.runtime.query<{ type: string }>(`SELECT type FROM "Company" WHERE id = $1 AND status = 'ACTIVE'`, [tenant.companyId]);
      if (company.rowCount !== 1) return deny('COMPANY', 'COMPANY_TYPE_INELIGIBLE');
      if (descriptor.companyTypes && !descriptor.companyTypes.includes(company.rows[0].type)) return deny('COMPANY', 'COMPANY_TYPE_INELIGIBLE');

      enter('PERMISSION');
      if (!(await this.permissions.has(tenant, descriptor.permission))) return deny('PERMISSION', 'PERMISSION_MISSING');

      enter('PURPOSE');
      if (request.purpose && !samePurposeRequirement(request.purpose, descriptor.purpose)) return deny('PURPOSE', 'PURPOSE_MISMATCH');
      if (!this.purposes.allows(tenant, descriptor.purpose)) return deny('PURPOSE', 'PURPOSE_NOT_ALLOWED');

      if (descriptor.partnerClassD) {
        enter('PARTNER_ELIGIBILITY');
        if (!(await this.partnerAccess.allowed(tenant))) return deny('PARTNER_ELIGIBILITY', 'PARTNER_NOT_ELIGIBLE');
      }
    } catch {
      return deny(evidence.evaluatedLayers[evidence.evaluatedLayers.length - 1], 'AUTHORIZATION_UNAVAILABLE');
    }

    return { allowed: true, evidence, purpose: descriptor.purpose };
  }

  async require(request: ResourceAuthorizationRequest): Promise<Extract<AuthorizationDecision, { allowed: true }>> {
    const decision = await this.decide(request);
    await this.record(request, decision);
    if (!decision.allowed) throw forbidden();
    return decision;
  }

  private async record(request: ResourceAuthorizationRequest, decision: AuthorizationDecision): Promise<void> {
    const tenant = request.tenant;
    const descriptor = operationDescriptor(request.operation);
    // Without a well-formed actor/company/operation there is no tenant to attribute evidence to.
    if (!tenant || !descriptor || !decision.evidence.evaluatedLayers.includes('OPERATION')) return;
    if (!isUuid(tenant.userId) || !isUuid(tenant.companyId)) return;
    const resourceId = request.resource?.id;
    const purposeFlow = descriptor.purpose.kind === 'CROSS_PURPOSE_FLOW' ? descriptor.purpose.flow : undefined;
    const base = {
      actorUserId: tenant.userId,
      companyId: tenant.companyId,
      scope: 'TENANT' as const,
      correlationId: request.correlationId,
      purposeCode: descriptor.purpose.purpose,
      flowSource: purposeFlow?.source,
      flowTarget: purposeFlow?.target,
      flowCpfId: purposeFlow?.id,
      entityType: descriptor.resource.kind,
      entityId: isUuid(resourceId) ? resourceId : undefined,
    };
    const metadata = { operation: decision.evidence.operation, layers: decision.evidence.evaluatedLayers, failedLayer: decision.evidence.failedLayer };
    // One final-outcome event per request: an ALLOWED event is only ever written for a finally allowed operation.
    if (decision.allowed) {
      await this.audit.record({ ...base, action: 'authorization.purpose_allowed', authorizationDecision: 'ALLOWED' });
      return;
    }
    const action = decision.evidence.failedLayer === 'PURPOSE' ? 'authorization.purpose_denied' : 'authorization.operation_denied';
    await this.audit.record({ ...base, action, authorizationDecision: 'DENIED', metadata: { ...metadata, reason: decision.reason } });
  }
}
