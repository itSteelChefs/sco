import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertTestDatabaseSafety, buildTestDatabaseEnvironment, TEST_DATABASE } from './test-database-environment.mjs';

const command = process.argv.slice(2);
if (command.length === 0) throw new Error('A test command is required.');

const root = fileURLToPath(new URL('../..', import.meta.url));
const composeFile = `${root}/infrastructure/compose/test.yml`;
const environment = buildTestDatabaseEnvironment();
assertTestDatabaseSafety(environment);

function run(executable, argumentsList) {
  const result = spawnSync(executable, argumentsList, { cwd: root, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status ?? 'unknown'}.`);
}

let started = false;
try {
  run('docker', ['compose', '--project-name', TEST_DATABASE.project, '--file', composeFile, 'up', '--detach', '--wait']);
  started = true;
  run('node', ['scripts/ci/prepare-test-database.mjs']);
  run(command[0], command.slice(1));
} finally {
  if (started) run('docker', ['compose', '--project-name', TEST_DATABASE.project, '--file', composeFile, 'down', '--volumes', '--remove-orphans']);
}