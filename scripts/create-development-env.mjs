import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const environmentFile = resolve(rootDirectory, '.env');

if (!process.argv.includes('--force')) {
  throw new Error('Refusing to replace .env without --force.');
}

const randomValue = () => randomBytes(32).toString('base64url');
const postgresPassword = randomValue();
const runtimePassword = randomValue();
const internalPassword = randomValue();
const sessionSecret = randomValue();

const content = [
  `POSTGRES_PASSWORD=${postgresPassword}`,
  `DATABASE_URL=postgresql://sco_dev:${postgresPassword}@127.0.0.1:54329/sco_dev`,
  `RUNTIME_DATABASE_PASSWORD=${runtimePassword}`,
  `RUNTIME_DATABASE_URL=postgresql://sco_runtime:${runtimePassword}@127.0.0.1:54329/sco_dev`,
  `SCO_INTERNAL_DATABASE_PASSWORD=${internalPassword}`,
  `SCO_INTERNAL_DATABASE_URL=postgresql://sco_internal_executor:${internalPassword}@127.0.0.1:54329/sco_dev`,
  `SESSION_SECRET=${sessionSecret}`,
  'NODE_ENV=development',
  'SCO_DOCUMENT_STORAGE=local',
  'API_ORIGIN=http://127.0.0.1:3101',
  'PARTNER_WEB_ORIGIN=http://127.0.0.1:3102',
  'OPERATIONS_WEB_ORIGIN=http://127.0.0.1:3103',
  '',
].join('\n');

await writeFile(environmentFile, content, { mode: 0o600 });
await chmod(environmentFile, 0o600);
console.info('Created local .env with fresh development credentials.');
