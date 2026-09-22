import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const runtimePassword = process.env.RUNTIME_DATABASE_PASSWORD;

if (!databaseUrl || !runtimePassword) {
  throw new Error('DATABASE_URL and RUNTIME_DATABASE_PASSWORD are required.');
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const result = await client.query('SELECT quote_literal($1) AS password_literal', [runtimePassword]);
  await client.query(`ALTER ROLE sco_runtime LOGIN PASSWORD ${result.rows[0].password_literal}`);
  await client.query('ALTER ROLE sco_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  console.info('Provisioned the local runtime database role from environment variables.');
} finally {
  await client.end();
}
