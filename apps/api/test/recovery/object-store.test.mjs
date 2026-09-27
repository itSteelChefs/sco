import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exportObjectStore, reconciliationIssues, restoreObjectStore } from '../../scripts/recovery/object-store.mjs';

class MemoryS3 {
  constructor(objects = new Map(), versioningStatus = 'Enabled', historicalVersions = []) { this.objects = objects; this.versioningStatus = versioningStatus; this.historicalVersions = historicalVersions; }
  async send(command) {
    const name = command.constructor.name;
    if (name === 'GetBucketVersioningCommand') return { Status: this.versioningStatus };
    if (name === 'ListObjectsV2Command') return { IsTruncated: false, Contents: [...this.objects].map(([Key, Body]) => ({ Key, Size: Body.length })) };
    if (name === 'ListObjectVersionsCommand') return { IsTruncated: false, Versions: this.historicalVersions };
    if (name === 'GetObjectCommand') {
      const body = this.objects.get(command.input.Key);
      if (!body) throw new Error('NoSuchKey');
      return { Body: { transformToByteArray: async () => body } };
    }
    if (name === 'PutObjectCommand') { this.objects.set(command.input.Key, Buffer.from(command.input.Body)); return {}; }
    throw new Error(`Unexpected command ${name}`);
  }
}

test('exports and restores S3-compatible objects byte for byte', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sco-object-recovery-'));
  await mkdir(join(root, 'objects', 'blobs'), { recursive: true });
  try {
    const source = new MemoryS3(new Map([['tenant/one', Buffer.from('one')], ['tenant/two', Buffer.from('two')]]));
    const inventory = await exportObjectStore({ client: source, bucket: 'source', root, backupId: 'sco-20260926T200000Z-012345abcdef', createdAt: '2026-09-26T20:00:00Z' });
    const destination = new MemoryS3();
    await restoreObjectStore({ client: destination, bucket: 'destination', root, expectedBackupId: inventory.backupId });
    assert.deepEqual(destination.objects, source.objects);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to restore into a non-empty bucket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sco-object-recovery-'));
  await mkdir(join(root, 'objects', 'blobs'), { recursive: true });
  try {
    const source = new MemoryS3(new Map([['tenant/one', Buffer.from('one')]]));
    await exportObjectStore({ client: source, bucket: 'source', root, backupId: 'sco-20260926T200000Z-012345abcdef', createdAt: '2026-09-26T20:00:00Z' });
    const destination = new MemoryS3(new Map([['existing', Buffer.from('unsafe')]]));
    await assert.rejects(restoreObjectStore({ client: destination, bucket: 'destination', root, expectedBackupId: 'sco-20260926T200000Z-012345abcdef' }), /RESTORE_BUCKET_NOT_EMPTY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to restore into a bucket with hidden object history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sco-object-recovery-'));
  await mkdir(join(root, 'objects', 'blobs'), { recursive: true });
  try {
    const source = new MemoryS3(new Map([['tenant/one', Buffer.from('one')]]));
    await exportObjectStore({ client: source, bucket: 'source', root, backupId: 'sco-20260926T200000Z-012345abcdef', createdAt: '2026-09-26T20:00:00Z' });
    const destination = new MemoryS3(new Map(), 'Enabled', [{ Key: 'deleted-private-object', VersionId: 'old' }]);
    await assert.rejects(restoreObjectStore({ client: destination, bucket: 'destination', root, expectedBackupId: 'sco-20260926T200000Z-012345abcdef' }), /RESTORE_BUCKET_HAS_OBJECT_HISTORY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to downgrade a versioned backup into an unversioned bucket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sco-object-recovery-'));
  await mkdir(join(root, 'objects', 'blobs'), { recursive: true });
  try {
    const source = new MemoryS3(new Map([['tenant/one', Buffer.from('one')]]));
    await exportObjectStore({ client: source, bucket: 'source', root, backupId: 'sco-20260926T200000Z-012345abcdef', createdAt: '2026-09-26T20:00:00Z' });
    await assert.rejects(restoreObjectStore({ client: new MemoryS3(new Map(), 'Unversioned'), bucket: 'destination', root, expectedBackupId: 'sco-20260926T200000Z-012345abcdef' }), /RESTORE_DESTINATION_VERSIONING_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reconciliation detects missing, orphaned, corrupt, and wrong-generation objects', () => {
  const rows = [
    { storage_key: 'missing', sha256: 'a'.repeat(64), byte_size: '1' },
    { storage_key: 'corrupt', sha256: 'b'.repeat(64), byte_size: '2' },
  ];
  const actual = new Map([
    ['corrupt', { sha256: 'c'.repeat(64), bytes: 2 }],
    ['orphan', { sha256: 'd'.repeat(64), bytes: 3 }],
  ]);
  const inventory = { objects: [
    { key: 'missing', sha256: 'a'.repeat(64), bytes: 1 },
    { key: 'corrupt', sha256: 'b'.repeat(64), bytes: 2 },
  ] };
  const types = reconciliationIssues(rows, actual, inventory).issues.map((issue) => issue.type);
  assert.deepEqual(new Set(types), new Set(['database_reference_missing_object', 'object_checksum_mismatch', 'orphan_object', 'wrong_backup_generation', 'partial_object_restore']));
});