#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonSecure } from './recovery-manifest.mjs';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function pgPass(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

try {
  const environmentName = process.argv[2];
  const outputDirectory = process.argv[3];
  if (!environmentName || !outputDirectory) throw new Error('URL_ENVIRONMENT_AND_OUTPUT_DIRECTORY_REQUIRED');
  const url = new URL(required(environmentName));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error('INVALID_POSTGRESQL_URL');
  const allowedParameters = new Set(['application_name', 'connect_timeout', 'sslcert', 'sslkey', 'sslmode', 'sslrootcert']);
  for (const name of url.searchParams.keys()) if (!allowedParameters.has(name)) throw new Error(`UNSUPPORTED_POSTGRESQL_PARAMETER:${name}`);
  if ([url.hostname, url.username, url.password, url.pathname].some((value) => /[\r\n\0]/.test(value))) throw new Error('INVALID_POSTGRESQL_URL_CHARACTER');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const passwordFile = join(outputDirectory, '.pgpass');
  await writeFile(passwordFile, `${pgPass(url.hostname)}:${url.port || '5432'}:${pgPass(url.pathname.slice(1))}:${pgPass(decodeURIComponent(url.username))}:${pgPass(decodeURIComponent(url.password))}\n`, { mode: 0o600, flag: 'wx' });
  await writeJsonSecure(join(outputDirectory, 'connection.json'), {
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    passwordFile,
    parameters: Object.fromEntries(url.searchParams),
  });
} catch (error) {
  console.error(JSON.stringify({ level: 'error', event: 'postgres_connection_configuration_failed', reason: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }));
  process.exitCode = 1;
}