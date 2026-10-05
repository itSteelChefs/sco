import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { establishClassDPartnerEligibility } from './class-d-eligibility.fixture.js';

// H2 security hardening: SH-01 (foreign product_candidate_id substitution on procurement needs) and
// SH-02 (runtime RBAC self-grant). Both are closed at the database authority (migration 0103), not in application code.

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const internal = new Pool({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL });
const id = () => randomUUID();

let companyA: string; let companyB: string; let scoCompany: string;
let userA: string; let userB: string; let scoUser: string;
let candidateA: string; let candidateB: string; let candidateInternal: string;
let membershipA: string;
let docA: string; let docB: string;

async function withRuntime<T>(actor: string, tenant: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.tenant_id',$2,true)", [actor, tenant]);
    try { return await callback(client); } finally { await client.query('ROLLBACK'); }
  } finally { client.release(); }
}

async function createUser(label: string) {
  const user = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${user}@${label}.h2sh.test`]);
  return user;
}

async function needCount(company: string) {
  return Number((await owner.query('SELECT count(*)::int AS count FROM procurement_needs WHERE company_id=$1', [company])).rows[0].count);
}

const createNeed = (actor: string, company: string, candidate: string | null) => internal.query(
  'SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [actor, company, 'H2 need', 1, null, '2030-01-01', null, null, candidate, id()],
);

beforeAll(async () => {
  companyA = id(); companyB = id(); scoCompany = id();
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'H2SH A','PARTNER'),($2,'H2SH B','PARTNER'),($3,'H2SH SCO','SCO')`, [companyA, companyB, scoCompany]);
  userA = await createUser('a'); userB = await createUser('b'); scoUser = await createUser('sco');
  membershipA = id();
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE'),($4,$5,$6,'ACTIVE'),($7,$8,$9,'ACTIVE')`,
    [membershipA, userA, companyA, id(), userB, companyB, id(), scoUser, scoCompany]);
  await establishClassDPartnerEligibility(owner, userA, companyA);
  await establishClassDPartnerEligibility(owner, userB, companyB);
  const insertCandidate = async (company: string | null, submittedBy: string, origin: string) => (await owner.query<{ id: string }>(
    `INSERT INTO product_candidates(company_id, submitted_by, origin, submitted_name) VALUES($1,$2,$3::"CandidateOrigin",'H2 candidate') RETURNING id`, [company, submittedBy, origin],
  )).rows[0].id;
  candidateA = await insertCandidate(companyA, userA, 'PARTNER');
  candidateB = await insertCandidate(companyB, userB, 'PARTNER');
  candidateInternal = await insertCandidate(null, scoUser, 'SCO_INTERNAL');
  const insertDocument = async (company: string, uploader: string) => {
    const documentId = id();
    await owner.query(
      'INSERT INTO documents (id, company_id, filename, detected_mime_type, byte_size, storage_key, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [documentId, company, 'h2sh.pdf', 'application/pdf', 1, `h2sh/${documentId}`, `hash-${documentId}`, 'AVAILABLE'],
    );
    return (await owner.query<{ id: string }>(
      `INSERT INTO procurement_documents(company_id,uploader_user_id,document_id,filename,document_type) VALUES($1,$2,$3,'h2sh.pdf','OTHER') RETURNING id`, [company, uploader, documentId],
    )).rows[0].id;
  };
  docA = await insertDocument(companyA, userA);
  docB = await insertDocument(companyB, userB);
});

afterAll(async () => {
  await Promise.all([owner.end(), runtime.end(), internal.end()]);
});

describe('SH-01: product_candidate_id must belong to the need company', () => {
  it('accepts an own-company candidate through the gateway', async () => {
    const created = await createNeed(userA, companyA, candidateA);
    expect(created.rows[0]).toMatchObject({ description: 'H2 need' });
    const row = (await owner.query('SELECT company_id, product_candidate_id FROM procurement_needs WHERE id=$1', [created.rows[0].id])).rows[0];
    expect(row).toEqual({ company_id: companyA, product_candidate_id: candidateA });
  });

  it('rejects a foreign-company, company-less (SCO internal) and non-existent candidate identically, creating nothing', async () => {
    const before = await needCount(companyA);
    const messages = new Set<string>();
    for (const candidate of [candidateB, candidateInternal, id()]) {
      await createNeed(userA, companyA, candidate).catch((error: Error) => { messages.add(error.message); });
    }
    expect([...messages]).toEqual(['PROCUREMENT_NEED_CANDIDATE_COMPANY_MISMATCH']);
    expect(await needCount(companyA)).toBe(before);
    expect((await owner.query('SELECT count(*)::int AS count FROM procurement_needs WHERE product_candidate_id=$1', [candidateB])).rows[0].count).toBe(0);
  });

  it('does not let a need without a candidate be affected, and the symmetric substitution fails for the other Partner', async () => {
    expect((await createNeed(userA, companyA, null)).rows[0]).toMatchObject({ description: 'H2 need' });
    await expect(createNeed(userB, companyB, candidateA)).rejects.toThrow('PROCUREMENT_NEED_CANDIDATE_COMPANY_MISMATCH');
  });

  it('holds for every writer, not just the gateway: direct INSERT, UPDATE of the candidate, and moving the need to another company', async () => {
    await expect(owner.query(
      `INSERT INTO procurement_needs(company_id, created_by, source_type, description, quantity, need_date, product_candidate_id)
       VALUES($1,$2,'MANUAL','direct',1,'2030-01-01',$3)`, [companyA, userA, candidateB],
    )).rejects.toThrow('PROCUREMENT_NEED_CANDIDATE_COMPANY_MISMATCH');

    const own = (await createNeed(userA, companyA, candidateA)).rows[0].id;
    await expect(owner.query('UPDATE procurement_needs SET product_candidate_id=$2 WHERE id=$1', [own, candidateB])).rejects.toThrow('PROCUREMENT_NEED_CANDIDATE_COMPANY_MISMATCH');
    await expect(owner.query('UPDATE procurement_needs SET company_id=$2 WHERE id=$1', [own, companyB])).rejects.toThrow('PROCUREMENT_NEED_CANDIDATE_COMPANY_MISMATCH');
    expect((await owner.query('SELECT company_id, product_candidate_id FROM procurement_needs WHERE id=$1', [own])).rows[0]).toEqual({ company_id: companyA, product_candidate_id: candidateA });
  });

  it('global integrity scan: zero procurement needs reference a foreign or company-less candidate', async () => {
    const violations = await owner.query(
      `SELECT n.id FROM procurement_needs n LEFT JOIN product_candidates c ON c.id = n.product_candidate_id
        WHERE n.product_candidate_id IS NOT NULL AND c.company_id IS DISTINCT FROM n.company_id`,
    );
    expect(violations.rowCount).toBe(0);
  });

  it('the runtime role cannot write needs at all, and the validation function is not executable by it', async () => {
    expect((await owner.query(`SELECT has_table_privilege('sco_runtime','public.procurement_needs','INSERT') AS insert, has_table_privilege('sco_runtime','public.procurement_needs','UPDATE') AS update`)).rows[0]).toEqual({ insert: false, update: false });
    expect((await owner.query(`SELECT has_function_privilege('sco_runtime','public.procurement_need_candidate_company_validate()','EXECUTE') AS runtime, has_function_privilege('public','public.procurement_need_candidate_company_validate()','EXECUTE') AS public`)).rows[0]).toEqual({ runtime: false, public: false });
  });

  it('the validator is owned by a least-privilege role that can only read candidate id/company', async () => {
    const owned = (await owner.query<{ owner: string; secdef: boolean; config: string[] }>(
      `SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS secdef, proconfig AS config FROM pg_proc WHERE proname='procurement_need_candidate_company_validate'`,
    )).rows[0];
    expect(owned).toMatchObject({ owner: 'sco_candidate_integrity_owner', secdef: true });
    expect(owned.config).toContain('search_path=pg_catalog, public');
    const grants = (await owner.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='sco_candidate_integrity_owner'`,
    )).rows;
    expect(grants.filter((grant) => grant.privilege_type !== 'SELECT')).toEqual([]);
    expect(await owner.query(`SELECT 1 FROM pg_roles WHERE rolname='sco_candidate_integrity_owner' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit`)).toHaveProperty('rowCount', 1);
  });
});

describe('SH-01B: procurement_document_lines.product_candidate_id must belong to the line company', () => {
  const MISMATCH = 'PROCUREMENT_DOCUMENT_LINE_CANDIDATE_COMPANY_MISMATCH';
  const insertLine = (client: Pool | PoolClient, company: string, document: string, candidate: string | null) => client.query<{ id: string }>(
    `INSERT INTO procurement_document_lines(company_id, document_id, raw_value, description, product_candidate_id) VALUES($1,$2,'{"raw":"h2"}'::jsonb,'h2 line',$3) RETURNING id`,
    [company, document, candidate],
  );
  const lineState = async (lineId: string) => (await owner.query(
    'SELECT company_id, document_id, product_candidate_id, updated_at FROM procurement_document_lines WHERE id=$1', [lineId],
  )).rows[0];
  const lineCount = async (document: string) => Number((await owner.query('SELECT count(*)::int AS count FROM procurement_document_lines WHERE document_id=$1', [document])).rows[0].count);

  it('A line + A candidate passes, through the owner and through the tenant runtime path', async () => {
    const created = await insertLine(owner, companyA, docA, candidateA);
    expect(await lineState(created.rows[0].id)).toMatchObject({ company_id: companyA, document_id: docA, product_candidate_id: candidateA });
    await withRuntime(userA, companyA, async (client) => {
      expect((await insertLine(client, companyA, docA, candidateA)).rowCount).toBe(1);
    });
    await withRuntime(userB, companyB, async (client) => {
      expect((await insertLine(client, companyB, docB, candidateB)).rowCount).toBe(1);
    });
  });

  it('A line + B candidate and B line + A candidate are denied on INSERT, creating no row, for every writer', async () => {
    const beforeA = await lineCount(docA); const beforeB = await lineCount(docB);
    await expect(insertLine(owner, companyA, docA, candidateB)).rejects.toThrow(MISMATCH);
    await expect(insertLine(owner, companyB, docB, candidateA)).rejects.toThrow(MISMATCH);
    await expect(withRuntime(userA, companyA, (client) => insertLine(client, companyA, docA, candidateB))).rejects.toThrow(MISMATCH);
    await expect(withRuntime(userB, companyB, (client) => insertLine(client, companyB, docB, candidateA))).rejects.toThrow(MISMATCH);
    expect(await lineCount(docA)).toBe(beforeA);
    expect(await lineCount(docB)).toBe(beforeB);
  });

  it('a company-less (SCO internal) and a non-existent candidate are denied; foreign, company-less and non-existent share one error contract', async () => {
    const messages = new Set<string>();
    for (const candidate of [candidateB, candidateInternal, id()]) {
      await insertLine(owner, companyA, docA, candidate).catch((error: Error) => { messages.add(error.message); });
      await withRuntime(userA, companyA, (client) => insertLine(client, companyA, docA, candidate)).catch((error: Error) => { messages.add(error.message); });
    }
    expect([...messages]).toEqual([MISMATCH]);
  });

  it('a line cannot straddle companies: another company\'s document is denied even with the line\'s own candidate', async () => {
    await expect(insertLine(owner, companyA, docB, candidateA)).rejects.toThrow(MISMATCH);
    await expect(insertLine(owner, companyB, docA, candidateB)).rejects.toThrow(MISMATCH);
  });

  it('UPDATE is protected in both directions, on the candidate, the owning company and the parent document, leaving the row unchanged', async () => {
    const lineA = (await insertLine(owner, companyA, docA, candidateA)).rows[0].id;
    const lineB = (await insertLine(owner, companyB, docB, candidateB)).rows[0].id;
    const beforeA = await lineState(lineA); const beforeB = await lineState(lineB);

    await expect(owner.query('UPDATE procurement_document_lines SET product_candidate_id=$2 WHERE id=$1', [lineA, candidateB])).rejects.toThrow(MISMATCH);
    await expect(owner.query('UPDATE procurement_document_lines SET product_candidate_id=$2 WHERE id=$1', [lineB, candidateA])).rejects.toThrow(MISMATCH);
    await expect(owner.query('UPDATE procurement_document_lines SET product_candidate_id=$2 WHERE id=$1', [lineA, candidateInternal])).rejects.toThrow(MISMATCH);
    await expect(owner.query('UPDATE procurement_document_lines SET product_candidate_id=$2 WHERE id=$1', [lineA, id()])).rejects.toThrow(MISMATCH);
    await expect(owner.query('UPDATE procurement_document_lines SET company_id=$2 WHERE id=$1', [lineA, companyB])).rejects.toThrow(MISMATCH);
    await expect(owner.query('UPDATE procurement_document_lines SET document_id=$2 WHERE id=$1', [lineA, docB])).rejects.toThrow(MISMATCH);
    await expect(withRuntime(userA, companyA, (client) => client.query('UPDATE procurement_document_lines SET product_candidate_id=$2 WHERE id=$1', [lineA, candidateB]))).rejects.toThrow(MISMATCH);

    expect(await lineState(lineA)).toEqual(beforeA);
    expect(await lineState(lineB)).toEqual(beforeB);
  });

  it('NULL candidates keep their established behavior (insert, set to NULL, unrelated updates)', async () => {
    const line = (await insertLine(owner, companyA, docA, null)).rows[0].id;
    expect((await lineState(line)).product_candidate_id).toBeNull();
    await owner.query('UPDATE procurement_document_lines SET product_candidate_id=$2 WHERE id=$1', [line, candidateA]);
    await owner.query('UPDATE procurement_document_lines SET description=$2 WHERE id=$1', [line, 'renamed']);
    await owner.query('UPDATE procurement_document_lines SET product_candidate_id=NULL WHERE id=$1', [line]);
    expect(await lineState(line)).toMatchObject({ product_candidate_id: null, company_id: companyA });
  });

  it('global integrity scan: zero cross-company or company-less candidate references on lines', async () => {
    const violations = await owner.query(
      `SELECT l.id FROM procurement_document_lines l LEFT JOIN product_candidates c ON c.id = l.product_candidate_id
         LEFT JOIN procurement_documents d ON d.id = l.document_id
        WHERE l.product_candidate_id IS NOT NULL AND (c.company_id IS DISTINCT FROM l.company_id OR d.company_id IS DISTINCT FROM l.company_id)`,
    );
    expect(violations.rowCount).toBe(0);
  });

  it('applies to every relevant writer: the trigger is enabled, and the only roles able to write lines are the owner and sco_runtime', async () => {
    const triggers = (await owner.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.procurement_document_lines'::regclass, 'public.procurement_needs'::regclass) AND tgname LIKE '%candidate_company_validate%' ORDER BY tgname`,
    )).rows;
    expect(triggers).toEqual([
      { tgname: 'procurement_document_line_candidate_company_validate_trigger', tgenabled: 'O' },
      { tgname: 'procurement_need_candidate_company_validate_trigger', tgenabled: 'O' },
    ]);
    const writers = (await owner.query<{ grantee: string }>(
      `SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='procurement_document_lines' AND privilege_type IN ('INSERT','UPDATE') AND grantee <> 'sco_test_owner'`,
    )).rows.map((row) => row.grantee);
    expect(writers).toEqual(['sco_runtime']);
    const config = (await owner.query<{ proname: string; owner: string; secdef: boolean; config: string[] }>(
      `SELECT proname, pg_get_userbyid(proowner) AS owner, prosecdef AS secdef, proconfig AS config FROM pg_proc WHERE proname IN ('procurement_document_line_candidate_company_validate','procurement_need_candidate_company_validate') ORDER BY proname`,
    )).rows;
    expect(config.map((row) => [row.owner, row.secdef, row.config])).toEqual([
      ['sco_candidate_integrity_owner', true, ['search_path=pg_catalog, public']],
      ['sco_candidate_integrity_owner', true, ['search_path=pg_catalog, public']],
    ]);
  });
});

describe('Product Candidate reference audit and company re-home', () => {
  it('the complete set of live references to product_candidates is exactly the four known tables', async () => {
    const references = (await owner.query<{ owning: string; column: string; nullable: boolean }>(
      `SELECT c.conrelid::regclass::text AS owning, a.attname AS "column", NOT a.attnotnull AS nullable
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'public.product_candidates'::regclass ORDER BY 1`,
    )).rows;
    expect(references).toEqual([
      { owning: 'procurement_document_lines', column: 'product_candidate_id', nullable: true },
      { owning: 'procurement_needs', column: 'product_candidate_id', nullable: true },
      { owning: 'product_candidate_history', column: 'candidate_id', nullable: false },
      { owning: 'product_match_assessments', column: 'candidate_id', nullable: false },
    ]);
    const candidateColumns = (await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name ILIKE '%candidate%' AND table_name NOT IN ('procurement_document_lines','procurement_needs','product_candidate_history','product_match_assessments','product_candidates')`,
    )).rows;
    expect(candidateColumns).toEqual([]);
  });

  it('assessments and history are bound to the tenant by RLS WITH CHECK, so a runtime writer cannot attach a foreign candidate', async () => {
    await expect(withRuntime(userA, companyA, (client) => client.query(
      `INSERT INTO product_candidate_history(candidate_id, to_status, actor_user_id) VALUES($1,'SUBMITTED',$2)`, [candidateB, userA],
    ))).rejects.toThrow(/row-level security/i);
    await expect(withRuntime(userA, companyA, (client) => client.query(
      `INSERT INTO product_match_assessments(candidate_id, explanation) VALUES($1,'x')`, [candidateB],
    ))).rejects.toThrow(/row-level security/i);
    await withRuntime(userA, companyA, async (client) => {
      expect((await client.query(`INSERT INTO product_candidate_history(candidate_id, to_status, actor_user_id) VALUES($1,'SUBMITTED',$2)`, [candidateA, userA])).rowCount).toBe(1);
    });
  });

  it('company re-home is an owner-only administrative invariant: no application-reachable role can change product_candidates.company_id', async () => {
    const homed = async (candidate: string) => (await owner.query('SELECT company_id FROM product_candidates WHERE id=$1', [candidate])).rows[0].company_id;
    // Runtime holds UPDATE, but RLS WITH CHECK pins the row to the tenant: no move to another company or to NULL.
    await expect(withRuntime(userA, companyA, (client) => client.query('UPDATE product_candidates SET company_id=$2 WHERE id=$1', [candidateA, companyB]))).rejects.toThrow(/row-level security/i);
    await expect(withRuntime(userA, companyA, (client) => client.query('UPDATE product_candidates SET company_id=NULL WHERE id=$1', [candidateA]))).rejects.toThrow(/row-level security/i);
    // Stealing another tenant's candidate touches nothing.
    await withRuntime(userA, companyA, async (client) => {
      expect((await client.query('UPDATE product_candidates SET company_id=$2 WHERE id=$1', [candidateB, companyA])).rowCount).toBe(0);
    });
    // The internal executor has no table privilege at all, and no gateway function writes company_id.
    await expect(internal.query('UPDATE product_candidates SET company_id=$2 WHERE id=$1', [candidateA, companyB])).rejects.toThrow(/permission denied/i);
    const writers = (await owner.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f' AND pg_get_functiondef(p.oid) ~* 'update\s+(public\.)?product_candidates\s+set[^;]*company_id'`,
    )).rows;
    expect(writers).toEqual([]);
    expect(await homed(candidateA)).toBe(companyA);
    expect(await homed(candidateB)).toBe(companyB);
    expect(await homed(candidateInternal)).toBeNull();
  });
});

describe('SH-02: the runtime role cannot mutate RBAC (no self-grant / privilege escalation)', () => {
  const adversarial = <T>(callback: (client: PoolClient) => Promise<T>) => withRuntime(userA, companyA, callback);

  it('cannot create a role, grant it a permission, or attach it to its own membership', async () => {
    await expect(adversarial((client) => client.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,'self-grant','self-grant')`, [id(), companyA]))).rejects.toThrow(/permission denied/i);
    // Even with a pre-existing role id the remaining links are independently closed.
    const role = id();
    await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,'owner provisioned')`, [role, companyA, `h2sh-${role}`]);
    await expect(adversarial((client) => client.query(
      `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code='partner_verify.read'`, [id(), companyA, role],
    ))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(
      `INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), companyA, membershipA, role],
    ))).rejects.toThrow(/permission denied/i);
  });

  it('cannot self-grant sco.internal.manage, partner.agreement.accept or representative Partner permissions', async () => {
    const role = id();
    await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,'owner provisioned')`, [role, companyA, `h2sh-grant-${role}`]);
    for (const code of ['sco.internal.manage', 'partner.agreement.accept', 'partner.admission.read', 'partner_verify.read', 'procurement_document.extract', 'partner.portal.read']) {
      await expect(adversarial((client) => client.query(
        `INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), companyA, role, code],
      )), code).rejects.toThrow(/permission denied/i);
    }
    const attached = await owner.query(`SELECT 1 FROM "RolePermission" WHERE role_id=$1`, [role]);
    expect(attached.rowCount).toBe(0);
  });

  it('no integrity helper role has any RBAC privilege, and its table/column access is the documented minimum', async () => {
    for (const table of ['Role', 'MembershipRole', 'RolePermission', 'CompanyMembership', 'Permission']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await owner.query(`SELECT has_table_privilege('sco_candidate_integrity_owner', $1, $2) AS held`, [`public."${table}"`, privilege])).rows[0].held, `${table} ${privilege}`).toBe(false);
      }
    }
    const columns = (await owner.query<{ table_name: string; column_name: string; privilege_type: string }>(
      `SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges WHERE grantee='sco_candidate_integrity_owner' ORDER BY 1,2`,
    )).rows;
    expect(columns.every((column) => column.privilege_type === 'SELECT')).toBe(true);
    expect(columns.map((column) => `${column.table_name}.${column.column_name}`)).toEqual([
      'procurement_documents.company_id', 'procurement_documents.id', 'product_candidates.company_id', 'product_candidates.id',
    ]);
    const policies = (await owner.query<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM pg_policies WHERE 'sco_candidate_integrity_owner' = ANY(roles) ORDER BY 1`,
    )).rows;
    expect(policies).toEqual([{ tablename: 'procurement_documents', cmd: 'SELECT' }, { tablename: 'product_candidates', cmd: 'SELECT' }]);
  });

  it('cannot update, delete or truncate RBAC rows, nor write into another company', async () => {
    await expect(adversarial((client) => client.query(`UPDATE "RolePermission" SET company_id=company_id`))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(`UPDATE "MembershipRole" SET company_id=company_id`))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(`UPDATE "Role" SET name=name`))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(`DELETE FROM "MembershipRole"`))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(`DELETE FROM "RolePermission"`))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(`TRUNCATE "Role" CASCADE`))).rejects.toThrow(/permission denied/i);
    await expect(adversarial((client) => client.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,'x','x')`, [id(), companyB]))).rejects.toThrow(/permission denied/i);
  });

  it('the attempted escalation leaves the actor without the permission', async () => {
    const holds = async (code: string) => Number((await owner.query(
      `SELECT count(*)::int AS count FROM "MembershipRole" mr JOIN "RolePermission" rp ON rp.role_id=mr.role_id JOIN "Permission" p ON p.id=rp.permission_id WHERE mr.membership_id=$1 AND p.code=$2`, [membershipA, code],
    )).rows[0].count) > 0;
    expect(await holds('partner_verify.read')).toBe(false);
    expect(await holds('partner.portal.read')).toBe(true);
  });

  it('keeps read access scoped to the tenant, which authorization functions and guards rely on', async () => {
    const own = await adversarial((client) => client.query(`SELECT DISTINCT company_id FROM "MembershipRole"`));
    expect(own.rows.map((row) => row.company_id)).toEqual([companyA]);
    const roles = await adversarial((client) => client.query(`SELECT DISTINCT company_id FROM "Role"`));
    expect(roles.rows.map((row) => row.company_id)).toEqual([companyA]);
    const rolePermissions = await adversarial((client) => client.query(`SELECT DISTINCT company_id FROM "RolePermission"`));
    expect(rolePermissions.rows.map((row) => row.company_id)).toEqual([companyA]);
  });

  it('is enforced by grants and by policy: no write privilege for the runtime role or PUBLIC, and tenant policies are read-only', async () => {
    for (const table of ['Role', 'MembershipRole', 'RolePermission']) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const result = await owner.query(`SELECT has_table_privilege('sco_runtime', $1, $2) AS runtime, has_table_privilege('public', $1, $2) AS pub`, [`public."${table}"`, privilege]);
        expect(result.rows[0], `${table} ${privilege}`).toEqual({ runtime: false, pub: false });
      }
      expect((await owner.query(`SELECT has_table_privilege('sco_runtime', $1, 'SELECT') AS read`, [`public."${table}"`])).rows[0].read).toBe(true);
    }
    const policies = (await owner.query<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM pg_policies WHERE tablename IN ('Role','MembershipRole','RolePermission') AND 'sco_runtime' = ANY(roles)`,
    )).rows;
    expect(policies).toHaveLength(3);
    expect(policies.every((policy) => policy.cmd === 'SELECT')).toBe(true);
  });

  it('SECURITY DEFINER gateways remain the only RBAC readers they were; no gateway owner gained a write privilege', async () => {
    const writers = (await owner.query<{ grantee: string; table_name: string; privilege_type: string }>(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name IN ('Role','MembershipRole','RolePermission')
          AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE') AND grantee NOT IN ('sco_test_owner','postgres')`,
    )).rows;
    expect(writers).toEqual([]);
  });
});
