#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { collectDependencies } from './inventory.mjs';

const outputIndex = process.argv.indexOf('--output');
const output = outputIndex === -1 ? null : resolve(process.argv[outputIndex + 1] ?? '');
if (outputIndex !== -1 && !process.argv[outputIndex + 1]) throw new Error('--output requires a path');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const components = collectDependencies().map((dependency) => ({
  SPDXID: `SPDXRef-${dependency.package.replace(/[^A-Za-z0-9.-]/g, '-')}`,
  name: dependency.package,
  versionInfo: dependency.requestedRange,
  supplier: 'NOASSERTION',
  downloadLocation: 'NOASSERTION',
  licenseConcluded: 'NOASSERTION',
  licenseDeclared: 'NOASSERTION',
  comment: `Direct ${dependency.section} from ${dependency.manifest}; lockfile/transitive resolution intentionally out of scope.`,
}));
const document = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'SCO-direct-dependency-inventory',
  documentNamespace: `https://sco.local/sbom/${revision}`,
  creationInfo: { creators: ['Tool: scripts/oss/generate-sbom.mjs'], created: new Date().toISOString() },
  packages: components,
  annotations: [{ annotator: 'Tool: scripts/oss/generate-sbom.mjs', annotationType: 'OTHER', annotationDate: new Date().toISOString(), comment: `Bound to Git revision ${revision}; direct manifest dependencies only, no network resolution.` }],
};
const serialized = `${JSON.stringify(document, null, 2)}\n`;
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, serialized); }
else process.stdout.write(serialized);
