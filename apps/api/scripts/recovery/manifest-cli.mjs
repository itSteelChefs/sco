#!/usr/bin/env node
import { createRecoveryManifest, verifyRecoverySet } from './recovery-manifest.mjs';

function options(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('INVALID_ARGUMENTS');
    result[name.slice(2)] = value;
  }
  return result;
}

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`MISSING_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
}

try {
  const command = process.argv[2];
  const input = options(process.argv.slice(3));
  let manifest;
  if (command === 'create') {
    manifest = await createRecoveryManifest(required(input, 'root'), {
      backupId: required(input, 'backup-id'),
      createdAt: required(input, 'created-at'),
      releaseSha: required(input, 'release-sha'),
      serverVersion: required(input, 'server-version'),
      databaseName: required(input, 'database-name'),
    });
  } else if (command === 'verify') {
    manifest = await verifyRecoverySet(required(input, 'root'));
  } else {
    throw new Error('COMMAND_MUST_BE_CREATE_OR_VERIFY');
  }
  console.info(JSON.stringify({ level: 'info', event: command === 'create' ? 'recovery_manifest_created' : 'recovery_manifest_verified', backup_id: manifest.backupId }));
} catch (error) {
  console.error(JSON.stringify({ level: 'error', event: 'recovery_manifest_failed', reason: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }));
  process.exitCode = 1;
}