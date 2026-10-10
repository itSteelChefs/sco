#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectDependencies } from './inventory.mjs';

const ROOT = process.cwd();
const VALID_STATUSES = new Set([
  'CATALOG_APPROVED', 'UNDER_EVALUATION', 'APPROVED_FOR_INTEGRATION',
  'INTEGRATED_EVIDENCED', 'REJECT_FOR_CURRENT_PROGRAM',
]);
const REQUIRED_CANDIDATE_FIELDS = [
  'id', 'name', 'upstreamName', 'upstreamURL', 'license', 'governanceStatus',
  'reviewDate', 'roadmapCapability', 'criticality', 'SCOOwner',
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function listFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) listFiles(path, files);
    else files.push(path);
  }
  return files;
}
function checkPinnedGitHubActions(errors) {
  const workflowDir = join(ROOT, '.github', 'workflows');
  for (const file of listFiles(workflowDir).filter((path) => /\.ya?ml$/.test(path))) {
    const content = readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*uses:\s*([^\s#]+)$/);
      if (!match || !match[1].includes('@')) continue;
      const ref = match[1].split('@').at(-1);
      if (!/^[a-f0-9]{40}$/i.test(ref)) errors.push(`${relative(ROOT, file)}: action must be SHA-pinned: ${match[1]}`);
    }
  }
}

export function validate(root = ROOT) {
  const errors = [];
  const registryPath = join(root, 'docs/oss/registry.json');
  const provenancePath = join(root, 'docs/oss/provenance.json');
  const registry = loadJson(registryPath);
  const provenance = loadJson(provenancePath);
  const ids = new Set();

  for (const candidate of registry.candidates ?? []) {
    for (const key of REQUIRED_CANDIDATE_FIELDS) {
      if (!candidate[key]) errors.push(`candidate ${candidate.id ?? '<unknown>'}: missing ${key}`);
    }
    if (ids.has(candidate.id)) errors.push(`duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    if (!VALID_STATUSES.has(candidate.governanceStatus)) errors.push(`candidate ${candidate.id}: invalid status ${candidate.governanceStatus}`);
    if (candidate.governanceStatus === 'INTEGRATED_EVIDENCED' && !candidate.sourcePath) {
      errors.push(`candidate ${candidate.id}: integrated record must identify sourcePath`);
    }
  }

  const inventory = new Set(registry.dependencyInventory ?? []);
  for (const dependency of collectDependencies(root)) {
    if (!inventory.has(dependency.package)) errors.push(`unregistered direct dependency ${dependency.package} in ${dependency.manifest}`);
  }

  const permittedShadcn = new Set(registry.approvedShadcnScope ?? []);
  const custodyRoot = join(root, 'docs/oss/custody/shadcn');
  for (const entry of existsSync(custodyRoot) ? readdirSync(custodyRoot, { withFileTypes: true }) : []) {
    if (entry.isDirectory() && !permittedShadcn.has(entry.name)) errors.push(`unapproved shadcn custody scope: ${entry.name}`);
  }

  for (const source of provenance.custodiedSources ?? []) {
    for (const key of ['candidateId', 'localPath', 'localSha256', 'upstreamURL', 'license']) {
      if (!source[key]) errors.push(`custody record missing ${key}`);
    }
    const path = join(root, source.localPath ?? '');
    if (!existsSync(path) || !statSync(path).isFile()) errors.push(`custodied source missing: ${source.localPath}`);
    else if (digest(path) !== source.localSha256) errors.push(`custodied source hash mismatch: ${source.localPath}`);
  }
  if (root === ROOT) checkPinnedGitHubActions(errors);
  return { errors, candidateCount: (registry.candidates ?? []).length, dependencyCount: inventory.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validate();
  if (result.errors.length) {
    process.stderr.write(`OSS governance check failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`OSS governance check passed: ${result.candidateCount} candidates, ${result.dependencyCount} registered direct dependencies.\n`);
  }
}
