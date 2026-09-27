#!/usr/bin/env node
import { verify } from 'node:crypto';
import { readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, sha256File } from './recovery-manifest.mjs';

function options(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || values[index + 1] === undefined) throw new Error('INVALID_ARGUMENTS');
    result[values[index].slice(2)] = values[index + 1];
  }
  return result;
}

function count(input, name) {
  const value = Number(input[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
}

function dayKey(date) { return date.toISOString().slice(0, 10); }
function monthKey(date) { return date.toISOString().slice(0, 7); }
function weekKey(date) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - weekday + 1);
  return dayKey(monday);
}

function retainBuckets(backups, key, limit, retained) {
  const buckets = new Set();
  for (const backup of backups) {
    const bucket = key(backup.createdAt);
    if (buckets.has(bucket) || buckets.size >= limit) continue;
    buckets.add(bucket);
    retained.add(backup.backupId);
  }
}

export function retentionPlan(backups, policy, now = new Date()) {
  const sorted = [...backups].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const retained = new Set();
  const minimum = now.getTime() - policy.minimumAgeDays * 86_400_000;
  for (const backup of sorted) if (backup.createdAt.getTime() >= minimum) retained.add(backup.backupId);
  retainBuckets(sorted, dayKey, policy.keepDaily, retained);
  retainBuckets(sorted, weekKey, policy.keepWeekly, retained);
  retainBuckets(sorted, monthKey, policy.keepMonthly, retained);
  return { retained: sorted.filter((backup) => retained.has(backup.backupId)), deletable: sorted.filter((backup) => !retained.has(backup.backupId)) };
}

async function authenticateBackup(backup, signingPublicKey) {
  const envelopeBytes = await readFile(backup.envelopePath);
  const signature = await readFile(backup.signaturePath);
  if (!verify(null, envelopeBytes, signingPublicKey, signature)) throw new Error(`ENVELOPE_SIGNATURE_FAILED:${backup.backupId}`);
  if (await sha256File(backup.archivePath) !== backup.sha256) throw new Error(`ARCHIVE_INTEGRITY_FAILED:${backup.backupId}`);
}

async function discover(directory, signingPublicKey) {
  const files = await readdir(directory);
  const backups = [];
  const backupIds = new Set();
  for (const file of files.filter((name) => name.endsWith('.envelope.json')).sort()) {
    const envelopePath = join(directory, file);
    const envelopeBytes = await readFile(envelopePath);
    const envelope = JSON.parse(envelopeBytes.toString('utf8'));
    if (envelope?.kind !== 'sco-recovery-envelope' || envelope?.schemaVersion !== 1 || !/^sco-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/.test(envelope.backupId)) throw new Error(`UNKNOWN_ENVELOPE:${file}`);
    if (file !== `${envelope.backupId}.envelope.json`) throw new Error(`ENVELOPE_FILENAME_MISMATCH:${file}`);
    if (backupIds.has(envelope.backupId)) throw new Error(`DUPLICATE_BACKUP_ID:${envelope.backupId}`);
    backupIds.add(envelope.backupId);
    const archiveName = `${envelope.backupId}.tar.age`;
    if (envelope.archive !== archiveName) throw new Error(`ENVELOPE_ARCHIVE_MISMATCH:${file}`);
    const archivePath = join(directory, archiveName);
    const signaturePath = join(directory, `${envelope.backupId}.envelope.sig`);
    const createdAt = new Date(envelope.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error(`INVALID_CREATED_AT:${envelope.backupId}`);
    const backup = { backupId: envelope.backupId, createdAt, envelopePath, archivePath, signaturePath, sha256: envelope.sha256 };
    await authenticateBackup(backup, signingPublicKey);
    backups.push(backup);
  }
  const expectedFiles = new Set(backups.flatMap((backup) => [
    backup.envelopePath,
    backup.archivePath,
    backup.signaturePath,
  ]));
  for (const file of files) {
    if (/^sco-.*\.(?:tar\.age|envelope\.json|envelope\.sig)$/.test(file) && !expectedFiles.has(join(directory, file))) {
      throw new Error(`ORPHAN_RECOVERY_ARTIFACT:${file}`);
    }
  }
  return backups;
}

async function main() {
  const input = options(process.argv.slice(2));
  const directory = await realpath(input.directory);
  const signingPublicKey = await readFile(input['signing-public-key']);
  const policy = {
    keepDaily: count(input, 'keep-daily'),
    keepWeekly: count(input, 'keep-weekly'),
    keepMonthly: count(input, 'keep-monthly'),
    minimumAgeDays: count(input, 'minimum-age-days'),
  };
  const backups = await discover(directory, signingPublicKey);
  const plan = retentionPlan(backups, policy);
  const execute = input.execute === 'true';
  if (execute && input.confirm !== `DELETE:${directory}`) throw new Error('RETENTION_DELETE_CONFIRMATION_MISMATCH');
  if (execute && (policy.keepDaily + policy.keepWeekly + policy.keepMonthly === 0 || policy.minimumAgeDays < 1)) throw new Error('UNSAFE_RETENTION_POLICY');
  if (input.execute !== undefined && !['true', 'false'].includes(input.execute)) throw new Error('INVALID_EXECUTE_VALUE');
  if (execute) {
    for (const backup of plan.deletable) {
      await authenticateBackup(backup, signingPublicKey);
      await rm(backup.archivePath);
      await rm(backup.signaturePath);
      await rm(backup.envelopePath);
    }
  }
  console.info(JSON.stringify({ level: 'info', event: execute ? 'retention_applied' : 'retention_planned', retained: plan.retained.map((item) => item.backupId), deletable: plan.deletable.map((item) => item.backupId) }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ level: 'error', event: 'retention_failed', reason: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }));
    process.exitCode = 1;
  });
}