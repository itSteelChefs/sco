import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertTestDatabaseSafety } from '../test/test-database-environment.mjs';

const required = ['DATABASE_URL', 'RUNTIME_DATABASE_URL', 'SCO_INTERNAL_DATABASE_URL', 'VERIFY_SYSTEM_DATABASE_URL', 'PURPOSE_AUTHORITY_DATABASE_URL', 'RUNTIME_DATABASE_PASSWORD', 'SCO_INTERNAL_DATABASE_PASSWORD', 'VERIFY_SYSTEM_DATABASE_PASSWORD', 'PURPOSE_AUTHORITY_DATABASE_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for CI database preparation`);
}
assertTestDatabaseSafety();

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit', env: process.env });
}

const sourcePrismaDirectory = join(process.cwd(), 'apps/api/prisma');
const testPrismaDirectory = mkdtempSync(join(tmpdir(), 'sco-test-prisma-'));

try {
  cpSync(sourcePrismaDirectory, testPrismaDirectory, { recursive: true });
  const migrationDirectory = join(testPrismaDirectory, 'migrations');
  for (const entry of await import('node:fs/promises').then(({ readdir }) => readdir(migrationDirectory, { withFileTypes: true }))) {
    if (!entry.isDirectory()) continue;
    const migrationPath = join(migrationDirectory, entry.name, 'migration.sql');
    const source = readFileSync(migrationPath, 'utf8');
    const translated = source.replaceAll('DATABASE sco_dev', 'DATABASE sco_test');
    if (translated.includes('DATABASE sco_dev')) throw new Error(`TEST_DATABASE_SAFETY: unresolved historical database reference in ${entry.name}.`);
    writeFileSync(migrationPath, translated);
  }

  const testSchema = join(testPrismaDirectory, 'schema.prisma');
  run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'generate', '--schema', 'prisma/schema.prisma']);
  run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'validate', '--schema', testSchema]);
  run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', testSchema]);
  run('node', ['apps/api/scripts/provision-runtime-role.mjs']);
  run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'db', 'seed']);
  run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'migrate', 'status', '--schema', testSchema]);
} finally {
  rmSync(testPrismaDirectory, { recursive: true, force: true });
}