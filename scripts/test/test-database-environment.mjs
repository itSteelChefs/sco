const TEST_DATABASE = Object.freeze({
  host: '127.0.0.1',
  port: '55432',
  database: 'sco_test',
  project: 'sco-test',
  applicationName: 'sco-test',
});

const credentials = Object.freeze({
  DATABASE_URL: ['sco_test_owner', 'sco-test-owner-password'],
  RUNTIME_DATABASE_URL: ['sco_runtime', 'sco-test-runtime-password'],
  SCO_INTERNAL_DATABASE_URL: ['sco_internal_executor', 'sco-test-internal-password'],
  VERIFY_SYSTEM_DATABASE_URL: ['sco_verify_system_executor', 'sco-test-verify-password'],
  PURPOSE_AUTHORITY_DATABASE_URL: ['sco_purpose_authority', 'sco-test-purpose-authority-password'],
});

function databaseUrl(username, password) {
  return `postgresql://${username}:${password}@${TEST_DATABASE.host}:${TEST_DATABASE.port}/${TEST_DATABASE.database}?application_name=${TEST_DATABASE.applicationName}`;
}

export function buildTestDatabaseEnvironment(base = process.env) {
  const environment = {
    ...base,
    NODE_ENV: 'test',
    SCO_TEST_DATABASE: '1',
    DATABASE_URL: databaseUrl(...credentials.DATABASE_URL),
    RUNTIME_DATABASE_URL: databaseUrl(...credentials.RUNTIME_DATABASE_URL),
    SCO_INTERNAL_DATABASE_URL: databaseUrl(...credentials.SCO_INTERNAL_DATABASE_URL),
    VERIFY_SYSTEM_DATABASE_URL: databaseUrl(...credentials.VERIFY_SYSTEM_DATABASE_URL),
    PURPOSE_AUTHORITY_DATABASE_URL: databaseUrl(...credentials.PURPOSE_AUTHORITY_DATABASE_URL),
    RUNTIME_DATABASE_PASSWORD: credentials.RUNTIME_DATABASE_URL[1],
    SCO_INTERNAL_DATABASE_PASSWORD: credentials.SCO_INTERNAL_DATABASE_URL[1],
    VERIFY_SYSTEM_DATABASE_PASSWORD: credentials.VERIFY_SYSTEM_DATABASE_URL[1],
    PURPOSE_AUTHORITY_DATABASE_PASSWORD: credentials.PURPOSE_AUTHORITY_DATABASE_URL[1],
    SESSION_SECRET: 'sco-test-session-secret-not-for-deployment',
    SCO_DOCUMENT_STORAGE: 'local',
    SCO_SEED_PASSWORD: 'sco-test-seed-password',
  };
  return environment;
}

export function assertTestDatabaseSafety(environment = process.env) {
  if (environment.NODE_ENV !== 'test') throw new Error('TEST_DATABASE_SAFETY: NODE_ENV=test is required.');
  if (environment.SCO_TEST_DATABASE !== '1') throw new Error('TEST_DATABASE_SAFETY: SCO_TEST_DATABASE=1 is required.');

  for (const [name, [expectedUser]] of Object.entries(credentials)) {
    const value = environment[name];
    if (!value) throw new Error(`TEST_DATABASE_SAFETY: ${name} must be explicitly configured.`);

    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`TEST_DATABASE_SAFETY: ${name} is not a valid connection URL.`);
    }

    if (url.protocol !== 'postgresql:' || url.hostname !== TEST_DATABASE.host || url.port !== TEST_DATABASE.port || url.pathname !== `/${TEST_DATABASE.database}` || decodeURIComponent(url.username) !== expectedUser || url.searchParams.get('application_name') !== TEST_DATABASE.applicationName) {
      throw new Error(`TEST_DATABASE_SAFETY: ${name} does not target the explicit test-owned database.`);
    }
  }

  return TEST_DATABASE;
}

export { TEST_DATABASE };