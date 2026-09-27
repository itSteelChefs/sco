import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';

const root = process.cwd();
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((path) => !path.startsWith('.performance-results/'))
  .sort();
const fingerprint = createHash('sha256');
for (const path of paths) {
  const metadata = lstatSync(path);
  fingerprint.update(path);
  fingerprint.update('\0');
  fingerprint.update(String(metadata.mode & 0o7777));
  fingerprint.update('\0');
  fingerprint.update(metadata.isSymbolicLink()
    ? `symlink:${readlinkSync(path)}`
    : createHash('sha256').update(readFileSync(path)).digest());
}
console.log(fingerprint.digest('hex'));