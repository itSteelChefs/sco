import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRecoveryManifest, sha256File, verifyRecoverySet, writeJsonSecure } from '../../scripts/recovery/recovery-manifest.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sco-recovery-manifest-'));
  await mkdir(join(root, 'objects', 'blobs'), { recursive: true });
  await writeFile(join(root, 'database.dump'), 'synthetic-database', { mode: 0o600 });
  await writeJsonSecure(join(root, 'database-migrations.json'), { appliedCount: 81, latest: '0081_example', migrations: ['0081_example'] });
  const bytes = Buffer.from('synthetic-private-object');
  const sha256 = await (async () => {
    const path = join(root, 'objects', 'blobs', 'placeholder');
    await writeFile(path, bytes, { mode: 0o600 });
    const hash = await sha256File(path);
    await writeFile(join(root, 'objects', 'blobs', hash), bytes, { mode: 0o600 });
    await rm(path);
    return hash;
  })();
  await writeJsonSecure(join(root, 'objects', 'inventory.json'), {
    kind: 'sco-object-inventory', schemaVersion: 1, backupId: 'sco-20260926T200000Z-012345abcdef', createdAt: '2026-09-26T20:00:00Z',
    versioningStatus: 'Enabled', objectCount: 1, totalBytes: bytes.length,
    objects: [{ key: 'tenant/document', bytes: bytes.length, sha256, blob: `objects/blobs/${sha256}` }],
  });
  await writeJsonSecure(join(root, 'objects', 'reconciliation.json'), { kind: 'sco-recovery-reconciliation', schemaVersion: 1, issueCount: 0 });
  await createRecoveryManifest(root, {
    backupId: 'sco-20260926T200000Z-012345abcdef', createdAt: '2026-09-26T20:00:00Z', releaseSha: '618f3721229c2bba9299f674ae106c01dbabd2eb',
    serverVersion: '17.11', databaseName: 'sco_drill',
  });
  return root;
}

test('creates and verifies a linked recovery manifest', async () => {
  const root = await fixture();
  try {
    const manifest = await verifyRecoverySet(root);
    assert.equal(manifest.database.migrations.appliedCount, 81);
    assert.equal(manifest.objects.objectCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a corrupted database archive', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'database.dump'), 'tampered');
    await assert.rejects(verifyRecoverySet(root), /COMPONENT_INTEGRITY_FAILED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects object inventory traversal before reading a blob', async () => {
  const root = await fixture();
  try {
    const inventoryPath = join(root, 'objects', 'inventory.json');
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    inventory.objects[0].blob = '../private';
    await writeFile(inventoryPath, JSON.stringify(inventory));
    await assert.rejects(verifyRecoverySet(root), /COMPONENT_INTEGRITY_FAILED|INVALID_OBJECT_BLOB_PATH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a manifest linked to the wrong backup generation', async () => {
  const root = await fixture();
  try {
    const manifestPath = join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.backupId = 'sco-20260926T200001Z-fedcba543210';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyRecoverySet(root), /OBJECT_INVENTORY_BACKUP_ID_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});