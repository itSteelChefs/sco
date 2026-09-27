import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { retentionPlan } from '../../scripts/recovery/retention.mjs';
import { sha256File } from '../../scripts/recovery/recovery-manifest.mjs';

const backup = (day, suffix) => ({ backupId: `sco-20260${day.replaceAll('-', '')}T000000Z-${suffix}`, createdAt: new Date(`2026-0${day}T00:00:00Z`) });

test('retention keeps configurable daily, weekly, monthly generations', () => {
  const backups = [
    backup('9-25', '000000000001'), backup('9-24', '000000000002'), backup('9-17', '000000000003'),
    backup('8-20', '000000000004'), backup('7-20', '000000000005'),
  ];
  const plan = retentionPlan(backups, { keepDaily: 2, keepWeekly: 2, keepMonthly: 2, minimumAgeDays: 1 }, new Date('2026-09-26T12:00:00Z'));
  assert.deepEqual(plan.retained.map((item) => item.backupId), backups.slice(0, 4).map((item) => item.backupId));
  assert.deepEqual(plan.deletable.map((item) => item.backupId), [backups[4].backupId]);
});

test('retention never expires a backup inside the minimum age', () => {
  const recent = backup('9-26', '000000000001');
  const plan = retentionPlan([recent], { keepDaily: 0, keepWeekly: 0, keepMonthly: 0, minimumAgeDays: 1 }, new Date('2026-09-26T12:00:00Z'));
  assert.equal(plan.retained[0].backupId, recent.backupId);
});

test('retention CLI authenticates envelopes before planning deletion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sco-retention-'));
  try {
    const backupId = 'sco-20260926T200000Z-012345abcdef';
    const archivePath = join(directory, `${backupId}.tar.age`);
    const envelopePath = join(directory, `${backupId}.envelope.json`);
    const signaturePath = join(directory, `${backupId}.envelope.sig`);
    const publicKeyPath = join(directory, 'public.pem');
    await writeFile(archivePath, 'encrypted-backup');
    const envelope = Buffer.from(`${JSON.stringify({ kind: 'sco-recovery-envelope', schemaVersion: 1, backupId, createdAt: '2026-09-26T20:00:00Z', archive: `${backupId}.tar.age`, sha256: await sha256File(archivePath) })}\n`);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await writeFile(envelopePath, envelope);
    await writeFile(signaturePath, sign(null, envelope, privateKey));
    await writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
    const args = ['apps/api/scripts/recovery/retention.mjs', '--directory', directory, '--signing-public-key', publicKeyPath, '--keep-daily', '1', '--keep-weekly', '0', '--keep-monthly', '0', '--minimum-age-days', '0', '--execute', 'false'];
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
    await writeFile(signaturePath, 'invalid-signature');
    const rejected = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /ENVELOPE_SIGNATURE_FAILED/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});