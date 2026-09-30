import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const runtimePassword = process.env.RUNTIME_DATABASE_PASSWORD;
const internalPassword = process.env.SCO_INTERNAL_DATABASE_PASSWORD;
const verifySystemPassword = process.env.VERIFY_SYSTEM_DATABASE_PASSWORD;
const mode = process.argv[2] ?? 'activate';

if (!databaseUrl || !['activate', 'prepare-restore'].includes(mode)) {
  throw new Error('DATABASE_URL and a valid provisioning mode are required.');
}
if (mode === 'activate' && (!runtimePassword || !internalPassword)) {
  throw new Error('RUNTIME_DATABASE_PASSWORD and SCO_INTERNAL_DATABASE_PASSWORD are required.');
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const roleNames = ['sco_runtime', 'sco_internal_executor', 'sco_verify_system_executor'];
  let successMessage;
  await client.query('BEGIN');
  try {
    const existing = await client.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [roleNames]);
    if (mode === 'prepare-restore') {
      if (existing.rowCount !== 0) throw new Error('RESTORE_RUNTIME_ROLE_ALREADY_EXISTS');
      await client.query('CREATE ROLE sco_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
      await client.query('CREATE ROLE sco_internal_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
      await client.query('CREATE ROLE sco_verify_system_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
      successMessage = 'Prepared non-login runtime database roles for restore.';
    } else {
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_runtime') THEN CREATE ROLE sco_runtime; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_internal_executor') THEN CREATE ROLE sco_internal_executor; END IF;
      END $$`);
      const unsafeState = await client.query(`
        SELECT r.rolname
        FROM pg_roles r
        WHERE r.rolname = ANY($1::text[])
          AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
            OR r.rolconfig IS NOT NULL
            OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid))`, [roleNames]);
      if (unsafeState.rowCount !== 0) throw new Error('RUNTIME_ROLE_SECURITY_STATE_INVALID');
      const result = await client.query('SELECT quote_literal($1) AS password_literal', [runtimePassword]);
      await client.query(`ALTER ROLE sco_runtime LOGIN PASSWORD ${result.rows[0].password_literal}`);
      await client.query('ALTER ROLE sco_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
      const internal = await client.query('SELECT quote_literal($1) AS password_literal', [internalPassword]);
      await client.query(`ALTER ROLE sco_internal_executor LOGIN PASSWORD ${internal.rows[0].password_literal}`);
      await client.query('ALTER ROLE sco_internal_executor NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
      if (verifySystemPassword && existing.rows.some((row) => row.rolname === 'sco_verify_system_executor')) {
        const verifySystem = await client.query('SELECT quote_literal($1) AS password_literal', [verifySystemPassword]);
        await client.query(`ALTER ROLE sco_verify_system_executor LOGIN PASSWORD ${verifySystem.rows[0].password_literal}`);
        await client.query('ALTER ROLE sco_verify_system_executor NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
      }
      successMessage = 'Provisioned the local runtime database role from environment variables.';
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  console.info(successMessage);
} finally {
  await client.end();
}
