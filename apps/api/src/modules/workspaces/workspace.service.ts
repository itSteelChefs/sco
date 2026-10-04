import { Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { ServiceAccessService } from '../service-access/service-access.service.js';

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
  capabilities: string[];
};

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ServiceAccessService) private readonly serviceAccess: ServiceAccessService,
  ) {}

  private async requirePortalAccess(tenant: TenantContext): Promise<void> {
    if (!(await this.permissions.has(tenant, 'partner.portal.read'))) throw forbidden();
  }

  async current(tenant: TenantContext): Promise<PartnerWorkspaceSummary | null> {
    await this.requirePortalAccess(tenant);
    return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
      const workspace = await client.query<WorkspaceRow>(
        `SELECT id, display_name, state, version
         FROM partner_workspaces
         WHERE company_id = $1 AND state = 'ACTIVE'`,
        [tenant.companyId],
      );
      const row = workspace.rows[0];
      if (!row) return null;
      const capabilities = await client.query<{ service_code: string }>(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1, $2)',
        [tenant.userId, tenant.companyId],
      );
      return {
        id: row.id,
        displayName: row.display_name,
        state: row.state,
        version: row.version,
        capabilities: capabilities.rows.map((capability) => capability.service_code),
      };
    });
  }

  async createCurrent(tenant: TenantContext, correlationId?: string): Promise<PartnerWorkspaceSummary> {
    await this.requirePortalAccess(tenant);
    return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
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
      const capabilities = await client.query<{ service_code: string }>(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1, $2)',
        [tenant.userId, tenant.companyId],
      );
      return {
        id: row.id,
        displayName: row.display_name,
        state: row.state,
        version: row.version,
        capabilities: capabilities.rows.map((capability) => capability.service_code),
      };
    });
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
    return { ...workspace, capabilities: [] };
  }
}
