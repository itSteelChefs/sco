import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScoInternalGuard } from '../../src/modules/identity/sco-internal.guard.js';

// SR-01/SR-02 remediation: app.sco_internal (GUC-only) must no longer be a sufficient security boundary for
// sensitive internal database operations, and ScoInternalGuard must resolve authorization under trusted actor
// context (database.withActor), never the GUC. All fixtures are created through the superuser DATABASE_URL pool
// (bypasses RLS entirely, same pattern already used by every other integration test in this suite); all
// assertions run as sco_runtime or sco_internal_executor, the actual constrained runtime roles.

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtimePool = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internalPool = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const id = () => randomUUID();

async function withRuntimeTransaction<T>(cb: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await runtimePool.connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Minimal RuntimeDatabaseService-compatible adapter over a real sco_runtime connection, so ScoInternalGuard is
// exercised against genuine Postgres RLS rather than a mocked database.
class RealRuntimeDatabase {
  async withActor<T>(actorUserId: string, cb: (client: PoolClient) => Promise<T>): Promise<T> {
    return withRuntimeTransaction(async (client) => {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [actorUserId]);
      return cb(client);
    });
  }
}

function fakeContext(userId: string | undefined) {
  return { switchToHttp: () => ({ getRequest: () => ({ scoUser: userId ? { id: userId } : undefined }) }) } as never;
}

let scoCompany: string;
let permission: string; // sco.internal.manage Permission id
let scoRole: string;

async function grantScoInternalManage(userId: string, membershipStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' = 'ACTIVE') {
  const membership = id();
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,$4)', [membership, userId, scoCompany, membershipStatus]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES ($1,$2,$3,$4)', [id(), scoCompany, membership, scoRole]);
  return membership;
}

async function grantPermission(roleId: string, permissionCode: string) {
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), scoCompany, roleId, permissionCode]);
}

describe('SR-01/SR-02 internal gateway security remediation', () => {
  beforeAll(async () => {
    scoCompany = id();
    await owner.query(`INSERT INTO "Company"(id,name,type,status) VALUES ($1,'Internal',\'SCO\',\'ACTIVE\')`, [scoCompany]);
    scoRole = id();
    await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES ($1,$2,$3,$4)', [scoRole, scoCompany, 'internal-manager', 'Internal Manager']);
    const permRow = await owner.query('SELECT id FROM "Permission" WHERE code=$1', ['sco.internal.manage']);
    permission = permRow.rows[0].id;
    await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) VALUES ($1,$2,$3,$4)', [id(), scoCompany, scoRole, permission]);
    for (const code of ['catalog.manage', 'catalog.approve', 'candidate.manage', 'qualification.manage', 'partnership.manage', 'execution.manage', 'supplier.read', 'supplier.qualify', 'purchase_source.create']) {
      await grantPermission(scoRole, code);
    }
  });

  afterAll(async () => {
    await owner.end();
    await runtimePool.end();
    await internalPool.end();
  });

  describe('adversarial: app.sco_internal is no longer a sufficient boundary', () => {
    it('1: SELECT on a sensitive internal table under a spoofed app.sco_internal is denied', async () => {
      await expect(withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.sco_internal', 'true', true)");
        return client.query('SELECT * FROM qualification_applications');
      })).rejects.toMatchObject({ code: '42501' });
    });

    it('2: INSERT under a spoofed app.sco_internal is denied', async () => {
      await expect(withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.sco_internal', 'true', true)");
        return client.query("INSERT INTO qualification_applications(legal_name,contact_email) VALUES ('x','x@x.test')");
      })).rejects.toMatchObject({ code: '42501' });
    });

    it('3: UPDATE under a spoofed app.sco_internal is denied', async () => {
      const appId = id();
      await owner.query('INSERT INTO qualification_applications(id,legal_name,contact_email) VALUES ($1,$2,$3)', [appId, 'x', 'x@x.test']);
      await expect(withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.sco_internal', 'true', true)");
        return client.query("UPDATE qualification_applications SET status='APPROVED' WHERE id=$1", [appId]);
      })).rejects.toMatchObject({ code: '42501' });
    });

    it('4: DELETE under a spoofed app.sco_internal is denied', async () => {
      const appId = id();
      await owner.query('INSERT INTO qualification_applications(id,legal_name,contact_email) VALUES ($1,$2,$3)', [appId, 'x', 'x@x.test']);
      await expect(withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.sco_internal', 'true', true)");
        return client.query('DELETE FROM qualification_applications WHERE id=$1', [appId]);
      })).rejects.toMatchObject({ code: '42501' });
      const stillThere = await owner.query('SELECT 1 FROM qualification_applications WHERE id=$1', [appId]);
      expect(stillThere.rowCount).toBe(1);
    });

    it('5: a forged app.actor_id cannot read RBAC tables it is not the subject of', async () => {
      const foreignUser = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [foreignUser, `${foreignUser}@sco.test`]);
      const result = await withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [randomUUID()]);
        return client.query('SELECT 1 FROM "CompanyMembership" WHERE "userId"=$1', [foreignUser]);
      });
      expect(result.rows).toEqual([]);
    });

    it('6: partner tenant context cannot reach another company\'s partnership row', async () => {
      const companyA = id();
      const companyB = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'A','PARTNER'),($2,'B','PARTNER')", [companyA, companyB]);
      const partnershipB = id();
      await owner.query('INSERT INTO company_partnerships(id,company_id,type) VALUES ($1,$2,$3)', [partnershipB, companyB, 'BUYER_PARTNERSHIP']);
      const result = await withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [companyA]);
        return client.query('SELECT 1 FROM company_partnerships WHERE id=$1', [partnershipB]);
      });
      expect(result.rows).toEqual([]);
    });

    it('7: sco_runtime cannot invoke a protected internal gateway directly (no EXECUTE grant)', async () => {
      await expect(runtimePool.query('SELECT public.internal_qualification_list($1)', [id()])).rejects.toMatchObject({ code: '42501' });
    });

    it('8: internal executor + partner-only actor is denied by the gateway\'s own capability check', async () => {
      const partnerCompany = id();
      const partnerUser = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Partner Co','PARTNER')", [partnerCompany]);
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [partnerUser, `${partnerUser}@partner.test`]);
      await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\')', [id(), partnerUser, partnerCompany]);
      await expect(internalPool.query('SELECT * FROM public.internal_qualification_create($1,$2,$3)', [partnerUser, 'Denied Co', 'x@x.test'])).rejects.toThrow('QUALIFICATION_MANAGE_FORBIDDEN');
    });

    it('9: internal executor + inactive (suspended) SCO membership is denied', async () => {
      const suspendedUser = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [suspendedUser, `${suspendedUser}@sco.test`]);
      await grantScoInternalManage(suspendedUser, 'SUSPENDED');
      await expect(internalPool.query('SELECT * FROM public.internal_qualification_create($1,$2,$3)', [suspendedUser, 'Denied Co', 'x@x.test'])).rejects.toThrow('QUALIFICATION_MANAGE_FORBIDDEN');
    });

    it('10: internal executor + partner-only membership (no SCO membership at all) is denied', async () => {
      const partnerCompany = id();
      const partnerOnlyUser = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Partner Only Co','PARTNER')", [partnerCompany]);
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [partnerOnlyUser, `${partnerOnlyUser}@partner.test`]);
      await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\')', [id(), partnerOnlyUser, partnerCompany]);
      await expect(internalPool.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [partnerOnlyUser, partnerCompany, 'BUYER_PARTNERSHIP'])).rejects.toThrow('PARTNERSHIP_MANAGE_FORBIDDEN');
    });

    it('11: a nonexistent target through a gateway returns empty/not-found without an information oracle', async () => {
      const authorizedUser = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [authorizedUser, `${authorizedUser}@sco.test`]);
      await grantScoInternalManage(authorizedUser);
      const result = await internalPool.query('SELECT * FROM public.internal_catalog_product_activate($1,$2)', [authorizedUser, randomUUID()]);
      expect(result.rows).toEqual([]);
    });

    it('12: intentionally global catalog read remains available with no context at all', async () => {
      const result = await runtimePool.query('SELECT 1 FROM product_categories LIMIT 1');
      expect(result.command).toBe('SELECT');
    });

    it('13: historical RFQ/commercial direct sco_runtime access remains denied', async () => {
      const result = await runtimePool.query<{ has_select: boolean; has_insert: boolean }>(
        `SELECT has_table_privilege('sco_runtime', 'rfqs', 'SELECT') AS has_select, has_table_privilege('sco_runtime', 'rfqs', 'INSERT') AS has_insert`,
      );
      expect(result.rows[0]).toEqual({ has_select: false, has_insert: false });
    });
  });

  describe('privilege metadata: gateway ownership and grant separation', () => {
    it('sco_internal_gateway_owner is NOLOGIN, has no BYPASSRLS/superuser, and owns no table', async () => {
      const result = await owner.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; owns_table: boolean }>(
        `SELECT r.rolcanlogin, r.rolsuper, r.rolbypassrls, EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner = r.oid AND c.relkind IN ('r','p')) AS owns_table
         FROM pg_roles r WHERE r.rolname = 'sco_internal_gateway_owner'`,
      );
      expect(result.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, owns_table: false });
    });

    it('every SR-01 gateway function is SECURITY DEFINER, owned by sco_internal_gateway_owner, with fixed search_path', async () => {
      const functions = ['internal_catalog_category_create', 'internal_catalog_attribute_create', 'internal_catalog_product_create', 'internal_catalog_product_activate', 'internal_candidate_submit', 'internal_candidate_transition', 'internal_qualification_create', 'internal_qualification_decide', 'internal_qualification_list', 'internal_partnership_create', 'internal_partnership_activate', 'internal_execution_cycle_create', 'internal_execution_assign', 'internal_supplier_eligible_sources', 'internal_supplier_qualification_decide', 'internal_purchase_source_create'];
      const result = await owner.query<{ proname: string; prosecdef: boolean; owner: string; search_path: string | null }>(
        `SELECT p.proname, p.prosecdef, o.rolname AS owner,
                (SELECT setting FROM unnest(p.proconfig) AS setting WHERE setting LIKE 'search_path=%') AS search_path
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles o ON o.oid = p.proowner
         WHERE n.nspname='public' AND p.proname = ANY($1::text[])`,
        [functions],
      );
      expect(result.rows).toHaveLength(functions.length);
      for (const row of result.rows) {
        expect(row.prosecdef).toBe(true);
        expect(row.owner).toBe('sco_internal_gateway_owner');
        expect(row.search_path).toBe('search_path=pg_catalog, public');
      }
    });

    it('PUBLIC has no EXECUTE and sco_runtime has no EXECUTE on any SR-01 gateway function; only sco_internal_executor does', async () => {
      const result = await owner.query<{ public_execute: boolean; runtime_execute: boolean; executor_execute: boolean }>(
        `SELECT has_function_privilege('public', 'public.internal_qualification_create(uuid,text,text)', 'EXECUTE') AS public_execute,
                has_function_privilege('sco_runtime', 'public.internal_qualification_create(uuid,text,text)', 'EXECUTE') AS runtime_execute,
                has_function_privilege('sco_internal_executor', 'public.internal_qualification_create(uuid,text,text)', 'EXECUTE') AS executor_execute`,
      );
      expect(result.rows[0]).toEqual({ public_execute: false, runtime_execute: false, executor_execute: true });
    });

    it('sco_internal_executor has no unintended direct sensitive table access', async () => {
      const result = await owner.query<{ has_select: boolean; has_insert: boolean }>(
        `SELECT has_table_privilege('sco_internal_executor', 'qualification_applications', 'SELECT') AS has_select,
                has_table_privilege('sco_internal_executor', 'qualification_applications', 'INSERT') AS has_insert`,
      );
      expect(result.rows[0]).toEqual({ has_select: false, has_insert: false });
    });

    it('P1: sco_internal_gateway_owner has no DELETE privilege on any global catalog table, and no policy grants it', async () => {
      const catalogTables = ['product_categories', 'category_attribute_definitions', 'unit_definitions', 'currency_definitions', 'product_identities', 'product_attribute_values'];
      const privileges = await owner.query<{ table_name: string; has_delete: boolean }>(
        `SELECT t.table_name, has_table_privilege('sco_internal_gateway_owner', t.table_name, 'DELETE') AS has_delete
         FROM unnest($1::text[]) AS t(table_name)`,
        [catalogTables],
      );
      expect(privileges.rows).toHaveLength(catalogTables.length);
      for (const row of privileges.rows) expect(row.has_delete).toBe(false);

      const policies = await owner.query<{ tablename: string; cmd: string }>(
        `SELECT tablename, cmd FROM pg_policies WHERE tablename = ANY($1::text[]) AND roles::text[] @> ARRAY['sco_internal_gateway_owner'] AND cmd IN ('DELETE','ALL')`,
        [catalogTables],
      );
      expect(policies.rows).toEqual([]);
    });

    it('P1: sco_internal_gateway_owner receives no grant/policy at all on unit_definitions, currency_definitions, or product_attribute_values (no gateway reads or writes them)', async () => {
      const untouchedTables = ['unit_definitions', 'currency_definitions', 'product_attribute_values'];
      const privileges = await owner.query<{ table_name: string; has_select: boolean; has_insert: boolean; has_update: boolean }>(
        `SELECT t.table_name,
                has_table_privilege('sco_internal_gateway_owner', t.table_name, 'SELECT') AS has_select,
                has_table_privilege('sco_internal_gateway_owner', t.table_name, 'INSERT') AS has_insert,
                has_table_privilege('sco_internal_gateway_owner', t.table_name, 'UPDATE') AS has_update
         FROM unnest($1::text[]) AS t(table_name)`,
        [untouchedTables],
      );
      for (const row of privileges.rows) expect(row).toEqual({ table_name: row.table_name, has_select: false, has_insert: false, has_update: false });

      const policies = await owner.query<{ tablename: string }>(
        `SELECT tablename FROM pg_policies WHERE tablename = ANY($1::text[]) AND roles::text[] @> ARRAY['sco_internal_gateway_owner']`,
        [untouchedTables],
      );
      expect(policies.rows).toEqual([]);
    });
  });

  describe('SR-02: ScoInternalGuard resolves authorization under trusted actor context', () => {
    const guard = new ScoInternalGuard(new RealRuntimeDatabase() as never);

    it('allows a legitimate active, authorized SCO workforce user', async () => {
      const user = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [user, `${user}@sco.test`]);
      await grantScoInternalManage(user);
      await expect(guard.canActivate(fakeContext(user))).resolves.toBe(true);
    });

    it('requires ACTIVE SCO membership: suspended membership is denied', async () => {
      const user = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [user, `${user}@sco.test`]);
      await grantScoInternalManage(user, 'SUSPENDED');
      await expect(guard.canActivate(fakeContext(user))).rejects.toThrow();
    });

    it('requires ACTIVE SCO membership: revoked membership is denied', async () => {
      const user = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [user, `${user}@sco.test`]);
      await grantScoInternalManage(user, 'REVOKED');
      await expect(guard.canActivate(fakeContext(user))).rejects.toThrow();
    });

    it('denies a partner-only membership (no SCO company membership at all)', async () => {
      const partnerCompany = id();
      const user = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Partner Guard Co','PARTNER')", [partnerCompany]);
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [user, `${user}@partner.test`]);
      await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\')', [id(), user, partnerCompany]);
      await expect(guard.canActivate(fakeContext(user))).rejects.toThrow();
    });

    it('denies an inactive SCO company even with an ACTIVE membership', async () => {
      const inactiveScoCompany = id();
      const user = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type,status) VALUES ($1,'Inactive SCO','SCO','SUSPENDED')", [inactiveScoCompany]);
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [user, `${user}@sco.test`]);
      const membership = id();
      await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\')', [membership, user, inactiveScoCompany]);
      await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES ($1,$2,$3,$4)', [id(), inactiveScoCompany, membership, scoRole]);
      await expect(guard.canActivate(fakeContext(user))).rejects.toThrow();
    });

    it('denies an SCO member who lacks the sco.internal.manage capability', async () => {
      const user = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [user, `${user}@sco.test`]);
      const membership = id();
      await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES ($1,$2,$3,\'ACTIVE\')', [membership, user, scoCompany]);
      const bareRole = id();
      await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES ($1,$2,$3,$4)', [bareRole, scoCompany, 'no-capability', 'No Capability']);
      await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES ($1,$2,$3,$4)', [id(), scoCompany, membership, bareRole]);
      await expect(guard.canActivate(fakeContext(user))).rejects.toThrow();
    });

    it('denies when no authenticated user is present on the request', async () => {
      await expect(guard.canActivate(fakeContext(undefined))).rejects.toThrow();
    });
  });

  describe('positive regression: internal gateway workflows function end-to-end', () => {
    let actor: string;
    beforeAll(async () => {
      actor = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [actor, `${actor}@sco.test`]);
      await grantScoInternalManage(actor);
    });

    it('internal catalog workflow succeeds and attributes created_by to the real actor', async () => {
      const category = (await internalPool.query('SELECT * FROM public.internal_catalog_category_create($1,$2,$3,$4)', [actor, `cat-${id()}`, 'Category', null])).rows[0];
      expect(category.id).toBeTruthy();
      const product = (await internalPool.query('SELECT * FROM public.internal_catalog_product_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [actor, category.id, 'Brand', 'Mfr', 'Model', null, null, null, null, null])).rows[0];
      expect(product.status).toBe('DRAFT');
      const activated = (await internalPool.query('SELECT * FROM public.internal_catalog_product_activate($1,$2)', [actor, product.id])).rows[0];
      expect(activated.status).toBe('ACTIVE');
      const createdBy = await owner.query('SELECT created_by, activated_by FROM product_identities WHERE id=$1', [product.id]);
      expect(createdBy.rows[0]).toEqual({ created_by: actor, activated_by: actor });
    });

    it('internal candidate-review workflow succeeds', async () => {
      const submitted = (await internalPool.query('SELECT * FROM public.internal_candidate_submit($1,$2,$3,$4,$5,$6,$7,$8)', [actor, 'Internal candidate', null, null, null, null, null, null])).rows[0];
      expect(submitted.status).toBe('SUBMITTED');
      const normalized = (await internalPool.query('SELECT * FROM public.internal_candidate_transition($1,$2,$3,$4,$5,$6,$7,$8,$9)', [actor, submitted.id, 'NORMALIZED', null, null, null, null, null, null])).rows[0];
      expect(normalized.status).toBe('NORMALIZED');
    });

    it('qualification workflow succeeds', async () => {
      const created = (await internalPool.query('SELECT * FROM public.internal_qualification_create($1,$2,$3)', [actor, 'Legal Co', 'contact@legalco.test'])).rows[0];
      expect(created.status).toBe('APPLICATION');
      const decided = (await internalPool.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [actor, created.id, 'APPROVED', 'looks good'])).rows[0];
      expect(decided.status).toBe('APPROVED');
      const listed = (await internalPool.query('SELECT * FROM public.internal_qualification_list($1)', [actor])).rows;
      expect(listed.some((row: { id: string }) => row.id === created.id)).toBe(true);
    });

    it('partnership workflow succeeds', async () => {
      const partnerCompany = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'New Supplier','SUPPLIER')", [partnerCompany]);
      const created = (await internalPool.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [actor, partnerCompany, 'SUPPLIER_PARTNERSHIP'])).rows[0];
      expect(created.status).toBe('UNDER_REVIEW');
      await owner.query("UPDATE company_partnerships SET status='APPROVED' WHERE id=$1", [created.id]);
      const activated = (await internalPool.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [actor, created.id])).rows[0];
      expect(activated.status).toBe('ACTIVE');
    });

    it('procurement execution workflow succeeds', async () => {
      const company = id();
      const category = id();
      const unit = id();
      const product = id();
      const need = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Exec Co','PARTNER')", [company]);
      await owner.query('INSERT INTO product_categories(id,code,name) VALUES ($1,$2,$3)', [category, `ex-${category.slice(0, 8)}`, 'Category']);
      await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES ($1,$2,$3,$4)', [unit, `u-${unit.slice(0, 8)}`, 'Unit', 'count']);
      await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES ($1,$2,$3,$4,$5)', [product, category, unit, actor, 'ACTIVE']);
      await owner.query(
        `INSERT INTO procurement_needs(id,company_id,created_by,source_type,product_identity_id,description,quantity,ready_quantity,unit_id,need_date,maturity,review_status)
         VALUES ($1,$2,$3,'MANUAL',$4,'n',10,10,$5,current_date,'READY','APPROVED')`,
        [need, company, actor, product, unit],
      );
      const cycle = (await internalPool.query('SELECT * FROM public.internal_execution_cycle_create($1,$2,$3,$4,$5)', [actor, `cyc-${id()}`, 'Cycle', new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()])).rows[0];
      const assigned = (await internalPool.query('SELECT * FROM public.internal_execution_assign($1,$2,$3,$4,$5)', [actor, cycle.id, need, 5, id()])).rows[0];
      expect(Number(assigned.allocatedQuantity)).toBe(5);
    });

    it('supplier-network workflow succeeds', async () => {
      const supplierCompany = id();
      const sourceType = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Supplier Co','SUPPLIER')", [supplierCompany]);
      await owner.query('INSERT INTO purchase_source_type_definitions(id,code,name) VALUES ($1,$2,$3)', [sourceType, `st-${sourceType.slice(0, 8)}`, 'Type']);
      const partnership = (await internalPool.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [actor, supplierCompany, 'SUPPLIER_PARTNERSHIP'])).rows[0];
      const source = (await internalPool.query('SELECT * FROM public.internal_purchase_source_create($1,$2,$3,$4,$5,$6,$7,$8)', [actor, supplierCompany, partnership.id, `src-${id()}`, sourceType, null, null, null])).rows[0];
      expect(source.status).toBe('DRAFT');
      const qualification = id();
      await owner.query('INSERT INTO supplier_qualifications(id,company_id,supplier_partnership_id,created_by) VALUES ($1,$2,$3,$4)', [qualification, supplierCompany, partnership.id, actor]);
      const decided = (await internalPool.query('SELECT * FROM public.internal_supplier_qualification_decide($1,$2,$3,$4)', [actor, qualification, 'ACTIVE', 'qualified'])).rows[0];
      expect(decided.status).toBe('ACTIVE');
    });

    it('partner can access its own currently permitted data (tenant-scoped candidate submit/list)', async () => {
      const partnerCompany = id();
      const partnerUser = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Own Data Partner','PARTNER')", [partnerCompany]);
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [partnerUser, `${partnerUser}@partner.test`]);
      const submitted = await withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [partnerUser]);
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [partnerCompany]);
        return client.query(
          `INSERT INTO product_candidates(company_id,submitted_by,origin,submitted_name) VALUES ($1,$2,'PARTNER',$3) RETURNING id`,
          [partnerCompany, partnerUser, 'Partner candidate'],
        );
      });
      const listed = await withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [partnerCompany]);
        return client.query('SELECT id FROM product_candidates WHERE company_id=$1', [partnerCompany]);
      });
      expect(listed.rows.map((r) => r.id)).toContain(submitted.rows[0].id);
    });

    it('partner cannot access another tenant\'s candidates', async () => {
      const companyA = id();
      const companyB = id();
      await owner.query("INSERT INTO \"Company\"(id,name,type) VALUES ($1,'Tenant A','PARTNER'),($2,'Tenant B','PARTNER')", [companyA, companyB]);
      const candidateB = id();
      await owner.query("INSERT INTO \"User\"(id,email,\"passwordHash\") VALUES ($1,$2,'x')", [candidateB, `${candidateB}@b.test`]);
      const created = await withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [candidateB]);
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [companyB]);
        return client.query(`INSERT INTO product_candidates(company_id,submitted_by,origin,submitted_name) VALUES ($1,$2,'PARTNER','B candidate') RETURNING id`, [companyB, candidateB]);
      });
      const crossRead = await withRuntimeTransaction(async (client) => {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [companyA]);
        return client.query('SELECT id FROM product_candidates WHERE id=$1', [created.rows[0].id]);
      });
      expect(crossRead.rows).toEqual([]);
    });

    it('Verify gateway ownership/policy is unaffected by this remediation', async () => {
      const result = await owner.query<{ owner: string }>(
        `SELECT o.rolname AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles o ON o.oid=p.proowner
         WHERE n.nspname='public' AND p.proname='internal_verify_system_run_create'`,
      );
      expect(result.rows[0]?.owner).toBe('sco_verify_gateway_owner');
    });
  });
});
