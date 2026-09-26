import { execFileSync } from 'node:child_process';

if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test is required for CI database preparation');

const required = ['DATABASE_URL', 'RUNTIME_DATABASE_URL', 'SCO_INTERNAL_DATABASE_URL', 'RUNTIME_DATABASE_PASSWORD', 'SCO_INTERNAL_DATABASE_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for CI database preparation`);
}

for (const name of ['DATABASE_URL', 'RUNTIME_DATABASE_URL', 'SCO_INTERNAL_DATABASE_URL']) {
  const url = new URL(process.env[name]);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/sco_dev') {
    throw new Error(`${name} must target the isolated loopback sco_dev test database`);
  }
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit', env: process.env });
}

run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'validate', '--schema', 'prisma/schema.prisma']);
run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
run('node', ['apps/api/scripts/provision-runtime-role.mjs']);
run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'db', 'seed']);
run('corepack', ['pnpm', '--filter', '@sco/api', 'exec', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma']);