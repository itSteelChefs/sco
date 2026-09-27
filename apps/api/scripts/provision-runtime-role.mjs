import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const runtimePassword = process.env.RUNTIME_DATABASE_PASSWORD;
const internalPassword = process.env.SCO_INTERNAL_DATABASE_PASSWORD;

if (!databaseUrl || !runtimePassword || !internalPassword) {
  throw new Error('DATABASE_URL, RUNTIME_DATABASE_PASSWORD and SCO_INTERNAL_DATABASE_PASSWORD are required.');
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_runtime') THEN
        CREATE ROLE sco_runtime;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sco_internal_executor') THEN
        CREATE ROLE sco_internal_executor;
      END IF;
    END
  $$`);
  const result = await client.query('SELECT quote_literal($1) AS password_literal', [runtimePassword]);
  await client.query(`ALTER ROLE sco_runtime LOGIN PASSWORD ${result.rows[0].password_literal}`);
  await client.query('ALTER ROLE sco_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  const internal = await client.query('SELECT quote_literal($1) AS password_literal', [internalPassword]);
  await client.query(`ALTER ROLE sco_internal_executor LOGIN PASSWORD ${internal.rows[0].password_literal}`);
  await client.query('ALTER ROLE sco_internal_executor NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  console.info('Provisioned the local runtime database role from environment variables.');
} finally {
  await client.end();
}
