#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const IGNORED = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);

function walk(directory, results = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, results);
    else if (entry.name === 'package.json') results.push(path);
  }
  return results;
}

export function collectDependencies(root = ROOT) {
  const records = [];
  for (const manifestPath of walk(root)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (name.startsWith('@sco/')) continue;
        records.push({
          package: name,
          requestedRange: range,
          section,
          manifest: relative(root, manifestPath),
        });
      }
    }
  }
  return records.sort((a, b) => a.package.localeCompare(b.package) || a.manifest.localeCompare(b.manifest));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, dependencies: collectDependencies() }, null, 2)}\n`);
}
