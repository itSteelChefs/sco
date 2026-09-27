import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

if (process.env.NODE_ENV !== 'test' || process.env.SCO_PERFORMANCE_DATASET !== 'isolated-local') {
  throw new Error('Performance dataset requires NODE_ENV=test and SCO_PERFORMANCE_DATASET=isolated-local');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const target = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/sco_dev') {
  throw new Error('Performance dataset must target isolated loopback sco_dev');
}

const companyCount = 250;
const productCount = 500;
const userId = '10000000-0000-4000-8000-000000000010';
const scoCompanyId = '10000000-0000-4000-8000-000000000001';
const partnerCompanyId = '10000000-0000-4000-8000-000000000002';
const categoryId = '50000000-0000-4000-8000-000000000001';
const unitId = '50000000-0000-4000-8000-000000000002';
const client = new Client({ connectionString: process.env.DATABASE_URL });

function uuid(prefix, index) {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

await client.connect();
try {
  await client.query('BEGIN');
  const environment = await client.query("SELECT current_setting('sco.environment', true) AS value");
  if (environment.rows[0]?.value !== 'test') throw new Error('Performance database must declare sco.environment=test');

  for (let index = 1; index <= companyCount; index += 1) {
    const companyId = uuid('20000000', index);
    await client.query(`INSERT INTO "Company" (id,name,type,status) VALUES ($1,$2,'PARTNER','ACTIVE') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE'`, [companyId, `Synthetic Performance Company ${index}`]);
    await client.query(`INSERT INTO "CompanyMembership" ("userId","companyId",status) VALUES ($1,$2,'ACTIVE') ON CONFLICT ("userId","companyId") DO UPDATE SET status='ACTIVE'`, [userId, companyId]);
  }

  await client.query(`INSERT INTO product_categories (id,code,name,active) VALUES ($1,'PERFORMANCE_SYNTHETIC','Synthetic Performance',true) ON CONFLICT (id) DO UPDATE SET active=true`, [categoryId]);
  await client.query(`INSERT INTO unit_definitions (id,code,name,dimension,active) VALUES ($1,'PERF_EA','Synthetic Each','COUNT',true) ON CONFLICT (id) DO UPDATE SET active=true`, [unitId]);
  for (let index = 1; index <= productCount; index += 1) {
    await client.query(`INSERT INTO product_identities (id,category_id,brand,manufacturer,model_reference,public_specification,unit_id,status,created_by,activated_by,activated_at) VALUES ($1,$2,'Synthetic','SCO Test',$3,$4::jsonb,$5,'ACTIVE',$6,$6,now()) ON CONFLICT (id) DO UPDATE SET status='ACTIVE'`, [uuid('60000000', index), categoryId, `PERF-${index.toString().padStart(4, '0')}`, JSON.stringify({ synthetic: true, sequence: index }), unitId, userId]);
  }

  const permissions = await client.query(`SELECT id,code FROM "Permission" WHERE code = ANY($1::text[])`, [['identity.company.read', 'partner.portal.read']]);
  if (permissions.rowCount !== 2) throw new Error('Expected benchmark permissions are missing');
  for (const [companyId, roleCode, permissionCode] of [
    [scoCompanyId, 'performance-operations', 'identity.company.read'],
    [partnerCompanyId, 'performance-partner', 'partner.portal.read'],
  ]) {
    const role = await client.query(`INSERT INTO "Role" (company_id,code,name) VALUES ($1,$2,$3) ON CONFLICT (company_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [companyId, roleCode, roleCode]);
    const permissionId = permissions.rows.find((row) => row.code === permissionCode).id;
    await client.query(`INSERT INTO "RolePermission" (company_id,role_id,permission_id) VALUES ($1,$2,$3) ON CONFLICT (role_id,permission_id) DO NOTHING`, [companyId, role.rows[0].id, permissionId]);
    const membership = await client.query(`SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2`, [userId, companyId]);
    await client.query(`INSERT INTO "MembershipRole" (company_id,membership_id,role_id) VALUES ($1,$2,$3) ON CONFLICT (membership_id,role_id) DO NOTHING`, [companyId, membership.rows[0].id, role.rows[0].id]);
  }
  await client.query('COMMIT');
  console.info(JSON.stringify({ kind: 'sco-performance-dataset', companies: companyCount + 2, memberships: companyCount + 2, activeProducts: productCount }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}