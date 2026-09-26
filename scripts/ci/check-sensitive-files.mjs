import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const candidateFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbiddenNames = /(^|\/)(\.env($|\.)|id_rsa|id_ed25519|credentials(?:\.json)?$|.*\.(?:pem|key|p12|pfx))$/i;
const allowedNames = new Set(['.env.example']);
const forbiddenContents = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];

const forbiddenCandidateFiles = candidateFiles.filter((path) => forbiddenNames.test(path) && !allowedNames.has(basename(path)));
if (forbiddenCandidateFiles.length) throw new Error(`Sensitive files must not be committed: ${forbiddenCandidateFiles.join(', ')}`);

for (const path of candidateFiles) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  for (const check of forbiddenContents) {
    if (check.pattern.test(content)) throw new Error(`Possible ${check.name} found in committable file: ${path}`);
  }
}

const dockerIgnore = readFileSync('.dockerignore', 'utf8').split(/\r?\n/).map((line) => line.trim());
for (const required of ['.env', '.env.*', '.git', '.github', 'node_modules', '**/node_modules']) {
  if (!dockerIgnore.includes(required)) throw new Error(`.dockerignore must exclude ${required}`);
}

console.info(`Sensitive-file gate verified ${candidateFiles.length} committable files and Docker context exclusions.`);