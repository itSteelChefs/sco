import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

export const MANIFEST_KIND = 'sco-recovery-manifest';
export const MANIFEST_VERSION = 1;
export const INVENTORY_KIND = 'sco-object-inventory';
export const INVENTORY_VERSION = 1;

export function assertBackupId(value) {
  if (!/^sco-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/.test(value)) throw new Error('INVALID_BACKUP_ID');
  return value;
}

export function assertRelativePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) throw new Error('INVALID_COMPONENT_PATH');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('INVALID_COMPONENT_PATH');
  return value;
}

export function pathWithin(root, relativePath) {
  const safePath = assertRelativePath(relativePath);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, safePath);
  if (!absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error('COMPONENT_PATH_ESCAPE');
  return absolutePath;
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJsonSecure(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, filePath);
}

async function component(root, relativePath) {
  const filePath = pathWithin(root, relativePath);
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('COMPONENT_NOT_REGULAR_FILE');
  return { path: relativePath, bytes: stats.size, sha256: await sha256File(filePath) };
}

export function validateInventory(inventory, backupId) {
  if (inventory?.kind !== INVENTORY_KIND || inventory?.schemaVersion !== INVENTORY_VERSION) throw new Error('UNSUPPORTED_OBJECT_INVENTORY');
  if (inventory.backupId !== backupId) throw new Error('OBJECT_INVENTORY_BACKUP_ID_MISMATCH');
  if (!Array.isArray(inventory.objects) || inventory.objectCount !== inventory.objects.length) throw new Error('INVALID_OBJECT_INVENTORY_COUNT');
  let totalBytes = 0;
  const keys = new Set();
  for (const object of inventory.objects) {
    if (typeof object.key !== 'string' || !object.key || keys.has(object.key)) throw new Error('INVALID_OBJECT_KEY');
    if (!Number.isSafeInteger(object.bytes) || object.bytes < 0 || !/^[a-f0-9]{64}$/.test(object.sha256)) throw new Error('INVALID_OBJECT_METADATA');
    if (object.blob !== `objects/blobs/${object.sha256}`) throw new Error('INVALID_OBJECT_BLOB_PATH');
    keys.add(object.key);
    totalBytes += object.bytes;
  }
  if (inventory.totalBytes !== totalBytes) throw new Error('INVALID_OBJECT_INVENTORY_BYTES');
  return inventory;
}

export async function createRecoveryManifest(root, input) {
  const backupId = assertBackupId(input.backupId);
  const migrations = await readJson(pathWithin(root, 'database-migrations.json'));
  const inventory = validateInventory(await readJson(pathWithin(root, 'objects/inventory.json')), backupId);
  const manifest = {
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_VERSION,
    backupId,
    createdAt: input.createdAt,
    releaseSha: input.releaseSha,
    database: {
      format: 'postgresql-custom-v1',
      serverVersion: input.serverVersion,
      databaseName: input.databaseName,
      archive: await component(root, 'database.dump'),
      migrations: { ...(await component(root, 'database-migrations.json')), appliedCount: migrations.appliedCount, latest: migrations.latest },
    },
    objects: {
      inventory: await component(root, 'objects/inventory.json'),
      reconciliation: await component(root, 'objects/reconciliation.json'),
      objectCount: inventory.objectCount,
      totalBytes: inventory.totalBytes,
      versioningStatus: inventory.versioningStatus,
      generation: 'current-visible-objects',
    },
    encryption: { required: true, scheme: 'age-x25519' },
  };
  await writeJsonSecure(pathWithin(root, 'manifest.json'), manifest);
  return manifest;
}

export async function verifyRecoverySet(root) {
  const manifestPath = pathWithin(root, 'manifest.json');
  const manifestStats = await lstat(manifestPath);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) throw new Error('MANIFEST_NOT_REGULAR_FILE');
  const manifest = await readJson(manifestPath);
  if (manifest?.kind !== MANIFEST_KIND || manifest?.schemaVersion !== MANIFEST_VERSION) throw new Error('UNSUPPORTED_RECOVERY_MANIFEST');
  assertBackupId(manifest.backupId);
  const expected = [manifest.database?.archive, manifest.database?.migrations, manifest.objects?.inventory, manifest.objects?.reconciliation];
  for (const item of expected) {
    if (!item || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('INVALID_COMPONENT_METADATA');
    const actual = await component(root, item.path);
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw new Error(`COMPONENT_INTEGRITY_FAILED:${basename(item.path)}`);
  }
  const inventory = validateInventory(await readJson(pathWithin(root, manifest.objects.inventory.path)), manifest.backupId);
  for (const object of inventory.objects) {
    const actual = await component(root, object.blob);
    if (actual.bytes !== object.bytes || actual.sha256 !== object.sha256) throw new Error('OBJECT_BLOB_INTEGRITY_FAILED');
  }
  return manifest;
}