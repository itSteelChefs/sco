import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { collectDependencies } from './inventory.mjs';
import { validate } from './check.mjs';

test('the checked-in governance registry validates', () => {
  const result = validate();
  assert.deepEqual(result.errors, []);
  assert.ok(result.candidateCount > 0);
});

test('each external direct dependency is registered', () => {
  const dependencies = collectDependencies();
  assert.ok(dependencies.length > 0);
  assert.ok(dependencies.every((dependency) => !dependency.package.startsWith('@sco/')));
});

test('SBOM generator binds output to current revision', () => {
  const result = JSON.parse(execFileSync('node', ['scripts/oss/generate-sbom.mjs'], { encoding: 'utf8' }));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(result.documentNamespace, `https://sco.local/sbom/${revision}`);
  assert.ok(result.packages.length > 0);
});
