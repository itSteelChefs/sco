import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectDependencies } from './inventory.mjs';
import { validate } from './check.mjs';

function fixture({ dependency = null, status = 'CATALOG_APPROVED' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sco-oss-check-'));
  mkdirSync(join(root, 'docs/oss'), { recursive: true });
  writeFileSync(join(root, 'docs/oss/provenance.json'), JSON.stringify({ custodiedSources: [] }));
  writeFileSync(join(root, 'docs/oss/registry.json'), JSON.stringify({
    approvedShadcnScope: [],
    dependencyInventory: [],
    candidates: [{
      id: 'fixture', name: 'Fixture', upstreamName: 'Fixture', upstreamURL: 'https://example.invalid',
      license: 'MIT', governanceStatus: status, reviewDate: '2026-10-10', roadmapCapability: 'X', criticality: 'L0', SCOOwner: 'SCO',
    }],
  }));
  if (dependency) writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { [dependency]: '1.0.0' } }));
  return root;
}

test('the checked-in governance registry validates', () => {
  const result = validate();
  assert.deepEqual(result.errors, []);
  assert.ok(result.candidateCount > 0);
});

test('an unregistered direct dependency fails closed', () => {
  const root = fixture({ dependency: 'unregistered-package' });
  try { assert.match(validate(root).errors.join('\n'), /unregistered direct dependency unregistered-package/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unsupported candidate status fails closed', () => {
  const root = fixture({ status: 'PROMOTED_WITHOUT_REVIEW' });
  try { assert.match(validate(root).errors.join('\n'), /invalid status/); }
  finally { rmSync(root, { recursive: true, force: true }); }
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
