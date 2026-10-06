import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PartnerProcurementAccessService } from '../identity/partner-procurement-access.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { ServiceAccessService } from '../service-access/service-access.service.js';
import { composeCapabilityStates, type WorkspaceCapabilityState } from './workspace-capability-composition.js';
import { validateWorkspaceCapabilityRegistry, WORKSPACE_CAPABILITY_REGISTRY, type WorkspaceCapabilityDefinition } from './workspace-capability-registry.js';

type WorkspaceRow = {
  id: string;
  display_name: string;
  state: string;
  version: number;
};

export type PartnerWorkspaceSummary = {
  id: string;
  displayName: string;
  state: string;
  version: number;
  // Capabilities currently available to this actor (advisory; kept for existing consumers).
  capabilities: string[];
  // Advisory per-capability state, including capabilities restricted by H2 operational access. Never authorization.
  capabilityStates: WorkspaceCapabilityState[];
};

@Injectable()
export class WorkspaceService {
  private readonly registry: readonly WorkspaceCapabilityDefinition[];

  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ServiceAccessService) private readonly serviceAccess: ServiceAccessService,
    @Inject(PartnerProcurementAccessService) private readonly procurementAccess: PartnerProcurementAccessService,
    @Inject(WORKSPACE_CAPABILITY_REGISTRY) registry: readonly WorkspaceCapabilityDefinition[],
  ) {
    this.registry = validateWorkspaceCapabilityRegistry(registry);
  }

  // Authorization (membership, PARTNER company, partner.portal.read, purpose) is enforced by ResourceAuthorizationGuard
  // through partner_workspace.read / partner_workspace.provision before these methods run.
  async current(tenant: TenantContext): Promise<PartnerWorkspaceSummary | null> {
    const found = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
      const workspace = await client.query<WorkspaceRow>(
        `SELECT id, display_name, state, version
         FROM partner_workspaces
         WHERE company_id = $1 AND state = 'ACTIVE'`,
        [tenant.companyId],
      );
      const row = workspace.rows[0];
      return row ? { row, entitled: await this.entitledServiceCodes(client, tenant) } : null;
    });
    return found ? this.summary(tenant, found.row, found.entitled) : null;
  }

  // Idempotent: ensures the company's single private workspace exists. It never updates an existing workspace.
  async createCurrent(tenant: TenantContext, correlationId?: string): Promise<PartnerWorkspaceSummary> {
    const provisioned = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [tenant.companyId]);
      const result = await client.query<WorkspaceRow>(
        `INSERT INTO partner_workspaces(company_id, display_name, created_by)
         VALUES ($1, 'Partner Private Workspace', $2)
         ON CONFLICT (company_id) DO NOTHING
         RETURNING id, display_name, state, version`,
        [tenant.companyId, tenant.userId],
      );
      const row = result.rows[0] ?? (await client.query<WorkspaceRow>(
        `SELECT id, display_name, state, version
         FROM partner_workspaces
         WHERE company_id = $1 AND state = 'ACTIVE'`,
        [tenant.companyId],
      )).rows[0];
      if (!row) throw new Error('PARTNER_WORKSPACE_CREATE_FAILED');
      if (result.rows[0]) {
        await this.audit.recordInTenantTransaction(client, {
          actorUserId: tenant.userId,
          companyId: tenant.companyId,
          scope: 'TENANT',
          action: 'partner_workspace.created',
          entityType: 'PartnerWorkspace',
          entityId: row.id,
          correlationId,
          purposeCode: 'PUR-02',
          authorizationDecision: 'ALLOWED',
        });
      }
      return { row, entitled: await this.entitledServiceCodes(client, tenant) };
    });
    return this.summary(tenant, provisioned.row, provisioned.entitled);
  }

  async assistedSummary(
    actorUserId: string,
    partnerCompanyId: string,
    serviceCode: string,
    correlationId?: string,
  ): Promise<PartnerWorkspaceSummary> {
    const workspace = await this.serviceAccess.workspaceSummary(
      actorUserId,
      partnerCompanyId,
      serviceCode,
      correlationId,
    );
    return { ...workspace, capabilities: [], capabilityStates: [] };
  }

  // Entitlement is only an input from the existing database projection (advisory, not complete authorization).
  private async entitledServiceCodes(client: PoolClient, tenant: TenantContext): Promise<ReadonlySet<string>> {
    const result = await client.query<{ service_code: string }>(
      'SELECT service_code FROM public.partner_workspace_capability_projection($1, $2)',
      [tenant.userId, tenant.companyId],
    );
    return new Set(result.rows.map((entry) => entry.service_code));
  }

  // Re-evaluated on every request from current truth: entitlement (database), permission (RBAC) and, only when a mapped
  // capability needs it, H2 operational access (the Class D gate). Nothing is cached.
  private async summary(tenant: TenantContext, row: WorkspaceRow, entitled: ReadonlySet<string>): Promise<PartnerWorkspaceSummary> {
    const candidates = this.registry.filter((entry) => entitled.has(entry.serviceCode));
    const permitted = new Set<string>();
    for (const permission of new Set(candidates.map((entry) => entry.requiredPermission))) {
      if (await this.permissions.has(tenant, permission)) permitted.add(permission);
    }
    const needsOperational = candidates.some((entry) => entry.requiresOperationalAccess && permitted.has(entry.requiredPermission));
    const operational = needsOperational ? await this.procurementAccess.allowed(tenant) : true;
    const capabilityStates = composeCapabilityStates(this.registry, entitled, permitted, operational);
    return {
      id: row.id,
      displayName: row.display_name,
      state: row.state,
      version: row.version,
      capabilities: capabilityStates.filter((state) => state.available).map((state) => state.capability),
      capabilityStates,
    };
  }
}
