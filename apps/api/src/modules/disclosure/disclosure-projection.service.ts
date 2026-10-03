import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { DisclosureDatabaseService } from './disclosure-database.service.js';
import { DisclosurePolicyService } from './disclosure-policy.service.js';
import type { DisclosureRequest } from './disclosure.types.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { PURPOSE, PURPOSE_FLOW } from '../rbac/purpose-registry.js';

@Injectable()
export class DisclosureProjectionService {
  constructor(
    @Inject(DisclosurePolicyService) private readonly policy: DisclosurePolicyService,
    @Inject(DisclosureDatabaseService) private readonly database: DisclosureDatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  async presentTrustedFixture(tenant: TenantContext, fixture: Omit<DisclosureRequest, 'actorUserId' | 'recipientCompanyId' | 'recipientContext'>, subjectReference: string, correlationId?: string): Promise<{ disclosureLevel: string; alias?: string }> {
    const request: DisclosureRequest = { ...fixture, actorUserId: tenant.userId, recipientCompanyId: tenant.companyId, recipientContext: 'PARTNER' };
    if (!(await this.permissions.has(tenant, 'disclosure.projection.read'))) {
      await this.audit.record({ actorUserId: tenant.userId, companyId: tenant.companyId, scope: 'TENANT', action: 'disclosure.denied', entityType: 'DisclosureResource', entityId: fixture.resourceId, metadata: { reasonCode: 'DISCLOSURE_PERMISSION_DENIED', purposeCode: PURPOSE.DELIVERY, flowCpfId: PURPOSE_FLOW.CPF_15.id }, correlationId, purposeCode: PURPOSE.DELIVERY, flowCpfId: PURPOSE_FLOW.CPF_15.id, flowSource: PURPOSE_FLOW.CPF_15.source, flowTarget: PURPOSE_FLOW.CPF_15.target, authorizationDecision: 'DENIED' });
      return { disclosureLevel: 'HIDDEN' };
    }
    const decision = this.policy.decide(request);
    const metadata = {
      identityClass: decision.auditContext.identityClass,
      recipientContext: decision.auditContext.recipientContext,
      resourceType: decision.auditContext.resourceType,
      operation: decision.auditContext.operation,
      disclosureLevel: decision.appliedLevel,
      reasonCode: decision.reasonCode,
      policyVersion: decision.policyVersion,
      purposeCode: PURPOSE.DELIVERY,
      flowCpfId: PURPOSE_FLOW.CPF_15.id,
    };
    if (!decision.requiresAliasResolution) {
      await this.audit.record({ actorUserId: request.actorUserId, companyId: request.recipientCompanyId, scope: 'TENANT', action: 'disclosure.denied', entityType: 'DisclosureResource', entityId: request.resourceId, metadata, correlationId, authorizationDecision: 'DENIED' });
      return { disclosureLevel: decision.appliedLevel };
    }
    return this.database.withAuthorizedAlias(request.actorUserId, request.recipientCompanyId, {
      resourceType: request.resourceType,
      resourceId: request.resourceId,
      identityClass: request.identityClass,
      subjectReference,
    }, async (client, alias) => {
      if (!alias) {
        await this.audit.recordInTenantTransaction(client, { actorUserId: request.actorUserId, companyId: request.recipientCompanyId, scope: 'TENANT', action: 'disclosure.denied', entityType: 'DisclosureResource', entityId: request.resourceId, metadata: { ...metadata, reasonCode: 'DISCLOSURE_ALIAS_SCOPE_DENIED' }, correlationId, authorizationDecision: 'DENIED' });
        return { disclosureLevel: 'HIDDEN' };
      }
      await this.audit.recordInTenantTransaction(client, { actorUserId: request.actorUserId, companyId: request.recipientCompanyId, scope: 'TENANT', action: 'disclosure.decision', entityType: 'DisclosureResource', entityId: request.resourceId, metadata, correlationId, authorizationDecision: 'ALLOWED' });
      await this.audit.recordInTenantTransaction(client, { actorUserId: request.actorUserId, companyId: request.recipientCompanyId, scope: 'TENANT', action: 'disclosure.alias_presented', entityType: 'DisclosureAlias', metadata, correlationId, authorizationDecision: 'ALLOWED' });
      return { disclosureLevel: decision.appliedLevel, alias };
    });
  }
}
