import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const authority = new Pool({ connectionString: process.env.PURPOSE_AUTHORITY_DATABASE_URL });
const id = () => randomUUID();
const supportService = 'PARTNER_WORKSPACE_SUPPORT';

let partnerA: string;
let partnerB: string;
let actor: string;
let otherActor: string;
let noPermissionActor: string;
let inactiveActor: string;
let sco: string;
let manager: string;
let supportActor: string;
let workspaceId: string;
let actorMembershipId: string;
let foreignProjectId: string;
let sameCompanyProjectId: string;
let siblingProjectId: string;
let sameCompanyDocumentId: string;
let foreignDocumentId: string;

async function withTenantSetting<T>(
  tenantSetting: string | null,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    if (tenantSetting === null) {
      await client.query('RESET app.tenant_id');
    } else {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantSetting]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withTenant<T>(companyId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTenantSetting(companyId, callback);
}

async function createMembership(
  userId: string,
  companyId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' = 'ACTIVE',
): Promise<string> {
  const membershipId = id();
  await owner.query(
    `INSERT INTO "CompanyMembership"(id,"userId","companyId",status)
     VALUES ($1,$2,$3,$4)`,
    [membershipId, userId, companyId, status],
  );
  return membershipId;
}

async function grantPermission(
  userId: string,
  companyId: string,
  permission: string,
  membershipStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' = 'ACTIVE',
): Promise<string> {
  const membershipId = await createMembership(userId, companyId, membershipStatus);
  const roleId = id();
  await owner.query(
    `INSERT INTO "Role"(id,company_id,code,name)
     VALUES ($1,$2,$3,$4)`,
    [roleId, companyId, `workspace-${roleId}`, permission],
  );
  await owner.query(
    `INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id)
     VALUES ($1,$2,$3,$4)`,
    [id(), companyId, membershipId, roleId],
  );
  await owner.query(
    `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id)
     SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`,
    [id(), companyId, roleId, permission],
  );
  return membershipId;
}

async function createDocument(companyId: string, suffix: string): Promise<string> {
  const documentId = id();
  await owner.query(
    `INSERT INTO documents(id,company_id,uploader_user_id,filename,detected_mime_type,byte_size,storage_key,sha256,status)
     VALUES($1,$2,$3,$4,'application/pdf',1,$5,$6,'AVAILABLE')`,
    [documentId, companyId, actor, `${suffix}.pdf`, `${companyId}/${suffix}`, id()],
  );
  return documentId;
}

describe('Stage 012 Digital Workspaces core', () => {
  beforeAll(async () => {
    partnerA = id();
    partnerB = id();
    actor = id();
    otherActor = id();
    noPermissionActor = id();
    inactiveActor = id();
    sco = id();
    manager = id();
    supportActor = id();
    foreignProjectId = id();
    sameCompanyProjectId = id();
    siblingProjectId = id();
    await owner.query(
      `INSERT INTO "Company"(id,name,type) VALUES
       ($1,'Workspace Partner A','PARTNER'),($2,'Workspace Partner B','PARTNER'),
       ($3,'Workspace SCO','SCO')`,
      [partnerA, partnerB, sco],
    );
    await owner.query(
      `INSERT INTO "User"(id,email,"passwordHash") VALUES
       ($1,$2,'x'),($3,$4,'x'),($5,$6,'x'),($7,$8,'x'),
       ($9,$10,'x'),($11,$12,'x')`,
      [
        actor, `${actor}@workspace.test`,
        otherActor, `${otherActor}@workspace.test`,
        manager, `${manager}@workspace.test`,
        supportActor, `${supportActor}@workspace.test`,
        noPermissionActor, `${noPermissionActor}@workspace.test`,
        inactiveActor, `${inactiveActor}@workspace.test`,
      ],
    );
    actorMembershipId = await grantPermission(actor, partnerA, 'partner.portal.read');
    await grantPermission(actor, partnerB, 'partner.portal.read');
    await createMembership(noPermissionActor, partnerA);
    await grantPermission(inactiveActor, partnerA, 'partner.portal.read', 'REVOKED');
    await grantPermission(manager, sco, 'service_access.manage');
    await grantPermission(supportActor, sco, 'service_access.use');
    await owner.query(
      `INSERT INTO projects(id,company_id,code,name,created_by) VALUES
       ($1,$2,'FOREIGN','Foreign Project',$4),
       ($3,$5,'SAME','Same Company Project',$4),
       ($6,$5,'SIBLING','Unrelated Sibling Project',$4)`,
      [foreignProjectId, partnerB, sameCompanyProjectId, actor, partnerA, siblingProjectId],
    );
    await owner.query(
      `INSERT INTO service_entitlements(company_id,service_code,state,changed_by) VALUES
       ($1,'PARTNER_CONTEXT_SUPPORT','ACTIVE',$3),
       ($2,'FOREIGN_PARTNER_SERVICE','ACTIVE',$3),
       ($1,'PARTNER_DISABLED_SERVICE','DISABLED',$3)`,
      [partnerA, partnerB, actor],
    );
    sameCompanyDocumentId = await createDocument(partnerA, 'workspace-owned');
    foreignDocumentId = await createDocument(partnerB, 'workspace-foreign');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), runtime.end(), internal.end(), authority.end()]);
  });

  it('creates exactly one canonical workspace per partner company under tenant RLS', async () => {
    workspaceId = await withTenant(partnerA, async (client) => {
      const first = await client.query<{ id: string }>(
        `INSERT INTO partner_workspaces(company_id,display_name,created_by)
         VALUES($1,'Partner Private Workspace',$2)
         RETURNING id`,
        [partnerA, actor],
      );
      await client.query('SAVEPOINT duplicate_workspace');
      await expect(client.query(
        `INSERT INTO partner_workspaces(company_id,display_name,created_by)
         VALUES($1,'Duplicate',$2)`,
        [partnerA, actor],
      )).rejects.toThrow(/duplicate key/);
      await client.query('ROLLBACK TO SAVEPOINT duplicate_workspace');
      return first.rows[0]!.id;
    });

    await withTenant(partnerB, async (client) => {
      const result = await client.query('SELECT id FROM partner_workspaces WHERE id=$1', [workspaceId]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('projects only active entitled service codes to an authorized active member', async () => {
    await withTenant(partnerA, async (client) => {
      const projection = await client.query<{ service_code: string }>(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1,$2)',
        [actor, partnerA],
      );
      expect(projection.rows).toEqual([{ service_code: 'PARTNER_CONTEXT_SUPPORT' }]);
    });
    await expect(withTenant(partnerA, (client) =>
      client.query(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1,$2)',
        [actor, partnerB],
      ),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(withTenant(partnerA, (client) =>
      client.query(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1,$2)',
        [otherActor, partnerA],
      ),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(withTenant(partnerA, (client) =>
      client.query(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1,$2)',
        [noPermissionActor, partnerA],
      ),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(withTenant(partnerA, (client) =>
      client.query(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1,$2)',
        [inactiveActor, partnerA],
      ),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(runtime.query('SELECT * FROM service_entitlements')).rejects.toThrow();
  });

  it('fails closed for absent, empty, malformed, and null tenant selectors', async () => {
    await expect(withTenantSetting(null, (client) =>
      client.query('SELECT * FROM public.partner_workspace_capability_projection($1,$2)', [actor, partnerA]),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(withTenantSetting('', (client) =>
      client.query('SELECT * FROM public.partner_workspace_capability_projection($1,$2)', [actor, partnerA]),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(withTenantSetting('not-a-uuid', (client) =>
      client.query('SELECT * FROM public.partner_workspace_capability_projection($1,$2)', [actor, partnerA]),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
    await expect(withTenant(partnerA, (client) =>
      client.query('SELECT * FROM public.partner_workspace_capability_projection($1,NULL)', [actor]),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
  });

  it('rejects cross-company project linkage at the database boundary', async () => {
    await expect(owner.query(
      `INSERT INTO partner_workspace_project_links(company_id,workspace_id,project_id,created_by)
       VALUES($1,$2,$3,$4)`,
      [partnerA, workspaceId, foreignProjectId, actor],
    )).rejects.toThrow('PARTNER_WORKSPACE_PROJECT_COMPANY_MISMATCH');
  });

  it('keeps project linkage separate from Workspace permission, project membership, and sibling projects', async () => {
    const linked = await owner.query(
      `INSERT INTO partner_workspace_project_links(company_id,workspace_id,project_id,created_by)
       VALUES($1,$2,$3,$4)
       RETURNING id`,
      [partnerA, workspaceId, sameCompanyProjectId, actor],
    );
    expect(linked.rowCount).toBe(1);
    const visibleLinks = await withTenant(partnerA, (client) =>
      client.query<{ project_id: string }>(
        'SELECT project_id FROM partner_workspace_project_links WHERE workspace_id=$1',
        [workspaceId],
      ),
    );
    expect(visibleLinks.rows).toEqual([{ project_id: sameCompanyProjectId }]);
    expect(visibleLinks.rows.map((row) => row.project_id)).not.toContain(siblingProjectId);
    const memberships = await owner.query(
      'SELECT id FROM project_members WHERE company_membership_id=$1',
      [actorMembershipId],
    );
    expect(memberships.rowCount).toBe(0);
    await expect(withTenant(partnerA, (client) =>
      client.query(
        'SELECT service_code FROM public.partner_workspace_capability_projection($1,$2)',
        [noPermissionActor, partnerA],
      ),
    )).rejects.toThrow('PARTNER_WORKSPACE_CAPABILITY_FORBIDDEN');
  });

  it('rejects cross-company document references and returns no storage locator for a valid reference', async () => {
    await expect(owner.query(
      `INSERT INTO partner_workspace_document_references(company_id,workspace_id,document_id,created_by)
       VALUES($1,$2,$3,$4)`,
      [partnerA, workspaceId, foreignDocumentId, actor],
    )).rejects.toThrow('PARTNER_WORKSPACE_DOCUMENT_COMPANY_MISMATCH');

    const reference = await owner.query(
      `INSERT INTO partner_workspace_document_references(company_id,workspace_id,document_id,created_by)
       VALUES($1,$2,$3,$4)
       RETURNING id`,
      [partnerA, workspaceId, sameCompanyDocumentId, actor],
    );
    const visibleReference = await withTenant(partnerA, (client) =>
      client.query(
        'SELECT * FROM partner_workspace_document_references WHERE id=$1',
        [reference.rows[0]!.id],
      ),
    );
    expect(visibleReference.rowCount).toBe(1);
    expect(Object.keys(visibleReference.rows[0]!)).toEqual([
      'id', 'company_id', 'workspace_id', 'document_id', 'created_by', 'created_at',
    ]);
    expect(Object.keys(visibleReference.rows[0]!)).not.toContain('storage_key');
  });

  it('enables and forces RLS on every Workspace table', async () => {
    const result = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname IN ('partner_workspaces','partner_workspace_project_links','partner_workspace_document_references')`,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const gateway = await owner.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
       FROM pg_roles WHERE rolname='sco_workspace_gateway_owner'`,
    );
    expect(gateway.rows).toEqual([{
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolbypassrls: false,
    }]);

    const functions = await owner.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      public_execute: boolean;
    }>(
      `SELECT procedure.proname, procedure.prosecdef, procedure.proconfig,
              EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) privilege
                WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
              ) AS public_execute
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
       WHERE namespace.nspname='public'
         AND procedure.proname IN (
           'partner_workspace_validate_company',
           'partner_workspace_project_link_validate',
           'partner_workspace_document_reference_validate',
           'partner_workspace_capability_projection',
           'internal_partner_workspace_service_access_summary'
         )`,
    );
    expect(functions.rows).toHaveLength(5);
    expect(functions.rows.every((fn) =>
      fn.prosecdef &&
      fn.proconfig?.includes('search_path=pg_catalog, public') &&
      !fn.public_execute,
    )).toBe(true);

    const runtimePrivileges = await owner.query<{
      workspace_select: boolean;
      workspace_insert: boolean;
      workspace_update: boolean;
      workspace_delete: boolean;
      project_link_select: boolean;
      project_link_insert: boolean;
      document_reference_select: boolean;
      document_reference_insert: boolean;
    }>(
      `SELECT
         has_table_privilege('sco_runtime','partner_workspaces','SELECT') AS workspace_select,
         has_table_privilege('sco_runtime','partner_workspaces','INSERT') AS workspace_insert,
         has_table_privilege('sco_runtime','partner_workspaces','UPDATE') AS workspace_update,
         has_table_privilege('sco_runtime','partner_workspaces','DELETE') AS workspace_delete,
         has_table_privilege('sco_runtime','partner_workspace_project_links','SELECT') AS project_link_select,
         has_table_privilege('sco_runtime','partner_workspace_project_links','INSERT') AS project_link_insert,
         has_table_privilege('sco_runtime','partner_workspace_document_references','SELECT') AS document_reference_select,
         has_table_privilege('sco_runtime','partner_workspace_document_references','INSERT') AS document_reference_insert`,
    );
    expect(runtimePrivileges.rows).toEqual([{
      workspace_select: true,
      workspace_insert: true,
      workspace_update: true,
      workspace_delete: false,
      project_link_select: true,
      project_link_insert: false,
      document_reference_select: true,
      document_reference_insert: false,
    }]);
  });

  it('composes SCO assistance through a bound Service Access decision without creating Partner membership', async () => {
    await internal.query(
      'SELECT public.internal_service_entitlement_set($1,$2,$3,$4::"ServiceEntitlementState")',
      [manager, partnerA, supportService, 'ACTIVE'],
    );
    await internal.query(
      'SELECT public.internal_service_access_grant_create($1,$2,$3,$4,$5::timestamptz,$6,$7)',
      [manager, supportActor, partnerA, supportService, new Date(Date.now() + 60_000).toISOString(), 'workspace-support', id()],
    );
    const resourceContext = `partner-workspace:${partnerA}`;
    const decisionId = (await authority.query<{ id: string }>(
      'SELECT public.issue_service_access_decision($1,$2,$3,$4) AS id',
      [supportActor, partnerA, supportService, resourceContext],
    )).rows[0]!.id;
    const client = await internal.connect();
    try {
      await client.query('BEGIN');
      const binding = (await client.query<{ backend_pid: number; transaction_id: string }>(
        'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
      )).rows[0]!;
      await authority.query(
        'SELECT public.consume_service_access_decision($1,$2,$3,$4,$5,$6,$7::bigint)',
        [decisionId, supportActor, partnerA, supportService, resourceContext, binding.backend_pid, binding.transaction_id],
      );
      const summary = await client.query<{ workspace_id: string }>(
        'SELECT * FROM public.internal_partner_workspace_service_access_summary($1,$2,$3,$4,$5,$6)',
        [supportActor, partnerA, supportService, resourceContext, decisionId, id()],
      );
      await client.query('COMMIT');
      expect(summary.rows[0]?.workspace_id).toBe(workspaceId);
    } finally {
      client.release();
    }
    const membership = await owner.query(
      `SELECT 1 FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2`,
      [supportActor, partnerA],
    );
    expect(membership.rowCount).toBe(0);
  });
});
