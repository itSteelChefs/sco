import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repositoryRoot = process.cwd();
const migrationRoot = 'apps/api/prisma/migrations';
const migrationPattern = /^(\d{4})_[a-z0-9][a-z0-9_]*$/;
const requestedBase = process.env.MIGRATION_BASE_REF || process.argv[2] || 'HEAD^';

function git(...args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function resolveBase(reference) {
  if (/^0+$/.test(reference)) return git('rev-parse', 'HEAD^');
  return git('rev-parse', '--verify', `${reference}^{commit}`);
}

const entries = readdirSync(join(repositoryRoot, migrationRoot), { withFileTypes: true });
const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const invalidDirectories = directories.filter((name) => !migrationPattern.test(name));
if (invalidDirectories.length) throw new Error(`Invalid migration directories: ${invalidDirectories.join(', ')}`);

const numbers = directories.map((name) => Number(migrationPattern.exec(name)[1]));
for (let index = 0; index < numbers.length; index += 1) {
  const expected = index + 1;
  if (numbers[index] !== expected) throw new Error(`Migration sequence must be contiguous; expected ${String(expected).padStart(4, '0')}`);
  const files = readdirSync(join(repositoryRoot, migrationRoot, directories[index]), { withFileTypes: true });
  if (files.length !== 1 || !files[0].isFile() || files[0].name !== 'migration.sql') {
    throw new Error(`${directories[index]} must contain exactly one migration.sql file`);
  }
  if (!readFileSync(join(repositoryRoot, migrationRoot, directories[index], 'migration.sql')).length) {
    throw new Error(`${directories[index]}/migration.sql must not be empty`);
  }
}

const base = resolveBase(requestedBase);
const historicalFiles = git('ls-tree', '-r', '--name-only', base, '--', migrationRoot)
  .split('\n')
  .filter((path) => path.includes('/') && path.endsWith('/migration.sql'));

for (const path of historicalFiles) {
  const currentPath = join(repositoryRoot, path);
  let current;
  try {
    current = readFileSync(currentPath);
  } catch {
    throw new Error(`Historical migration was deleted or renamed: ${path}`);
  }
  const accepted = execFileSync('git', ['show', `${base}:${path}`], { cwd: repositoryRoot });
  if (hash(current) !== hash(accepted)) throw new Error(`Historical migration was modified: ${relative(repositoryRoot, currentPath)}`);
}

const historicalDirectories = new Set(historicalFiles.map((path) => path.split('/').at(-2)));
const historicalMaximum = Math.max(0, ...[...historicalDirectories].map((name) => Number(migrationPattern.exec(name)?.[1] ?? 0)));
for (const directory of directories.filter((name) => !historicalDirectories.has(name))) {
  const number = Number(migrationPattern.exec(directory)[1]);
  if (number <= historicalMaximum) throw new Error(`New migration must follow accepted history: ${directory}`);
}

console.info(`Migration integrity verified: ${directories.length} directories; historical base ${base}.`);