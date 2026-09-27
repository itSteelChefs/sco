#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  CreateBucketCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';
import { INVENTORY_KIND, INVENTORY_VERSION, pathWithin, readJson, sha256File, validateInventory, writeJsonSecure } from './recovery-manifest.mjs';

const { Client } = pg;

function safeError(error) {
  return error instanceof Error ? error.name : 'UnknownError';
}

function log(event, fields = {}) {
  console.info(JSON.stringify({ level: 'info', event, ...fields }));
}

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function boolean(value) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('INVALID_BOOLEAN_CONFIGURATION');
}

function s3Configuration(prefix, source = process.env) {
  const accessKeyId = source[`${prefix}_ACCESS_KEY_ID`]?.trim();
  const secretAccessKey = source[`${prefix}_SECRET_ACCESS_KEY`]?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error(`${prefix}_CREDENTIAL_PAIR_REQUIRED`);
  return {
    bucket: required(source, `${prefix}_BUCKET`),
    client: new S3Client({
      region: required(source, `${prefix}_REGION`),
      endpoint: source[`${prefix}_ENDPOINT`]?.trim() || undefined,
      forcePathStyle: boolean(source[`${prefix}_FORCE_PATH_STYLE`]),
      credentials: accessKeyId ? { accessKeyId, secretAccessKey, sessionToken: source[`${prefix}_SESSION_TOKEN`]?.trim() || undefined } : undefined,
    }),
  };
}

async function objectBytes(response) {
  if (!response.Body) throw new Error('OBJECT_BODY_MISSING');
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function listCurrentObjects(client, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    for (const item of result.Contents ?? []) {
      if (typeof item.Key !== 'string' || !item.Key) throw new Error('INVALID_LISTED_OBJECT_KEY');
      objects.push({ key: item.Key, etag: item.ETag?.replaceAll('"', '') ?? null, lastModified: item.LastModified?.toISOString() ?? null });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !continuationToken) throw new Error('INVALID_OBJECT_PAGINATION');
  } while (continuationToken);
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

async function hasObjectHistory(client, bucket) {
  let keyMarker;
  let versionIdMarker;
  do {
    const result = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }));
    if ((result.Versions?.length ?? 0) > 0 || (result.DeleteMarkers?.length ?? 0) > 0) return true;
    keyMarker = result.IsTruncated ? result.NextKeyMarker : undefined;
    versionIdMarker = result.IsTruncated ? result.NextVersionIdMarker : undefined;
    if (result.IsTruncated && !keyMarker) throw new Error('INVALID_OBJECT_VERSION_PAGINATION');
  } while (keyMarker);
  return false;
}

export async function exportObjectStore({ client, bucket, root, backupId, createdAt }) {
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  const listed = await listCurrentObjects(client, bucket);
  const objects = [];
  let totalBytes = 0;
  for (const listedObject of listed) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: listedObject.key }));
    const content = await objectBytes(response);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const blob = `objects/blobs/${sha256}`;
    const blobPath = pathWithin(root, blob);
    try {
      await writeFile(blobPath, content, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error?.code !== 'EEXIST' || await sha256File(blobPath) !== sha256) throw error;
    }
    objects.push({ key: listedObject.key, bytes: content.length, sha256, blob, etag: listedObject.etag, lastModified: listedObject.lastModified });
    totalBytes += content.length;
  }
  const inventory = {
    kind: INVENTORY_KIND,
    schemaVersion: INVENTORY_VERSION,
    backupId,
    createdAt,
    versioningStatus: versioning.Status ?? 'Unversioned',
    generation: 'current-visible-objects',
    objectCount: objects.length,
    totalBytes,
    objects,
  };
  validateInventory(inventory, backupId);
  await writeJsonSecure(pathWithin(root, 'objects/inventory.json'), inventory);
  log('object_backup_created', { backup_id: backupId, object_count: objects.length, total_bytes: totalBytes, versioning_status: inventory.versioningStatus });
  return inventory;
}

export async function restoreObjectStore({ client, bucket, root, expectedBackupId }) {
  const existing = await listCurrentObjects(client, bucket);
  if (existing.length !== 0) throw new Error('RESTORE_BUCKET_NOT_EMPTY');
  if (await hasObjectHistory(client, bucket)) throw new Error('RESTORE_BUCKET_HAS_OBJECT_HISTORY');
  const inventory = validateInventory(await readJson(pathWithin(root, 'objects/inventory.json')), expectedBackupId);
  if (inventory.versioningStatus === 'Enabled') {
    const destinationVersioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (destinationVersioning.Status !== 'Enabled') throw new Error('RESTORE_DESTINATION_VERSIONING_MISMATCH');
  }
  for (const object of inventory.objects) {
    const blobPath = pathWithin(root, object.blob);
    if (await sha256File(blobPath) !== object.sha256) throw new Error('OBJECT_BLOB_INTEGRITY_FAILED');
    const content = await readFile(blobPath);
    if (content.length !== object.bytes) throw new Error('OBJECT_BLOB_SIZE_FAILED');
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: object.key, Body: content, Metadata: { 'sco-backup-sha256': object.sha256 } }));
    const restored = await objectBytes(await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key })));
    if (restored.length !== object.bytes || createHash('sha256').update(restored).digest('hex') !== object.sha256) throw new Error('RESTORED_OBJECT_INTEGRITY_FAILED');
  }
  log('object_restore_verified', { backup_id: expectedBackupId, object_count: inventory.objectCount, total_bytes: inventory.totalBytes });
  return inventory;
}

function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function reconciliationIssues(rows, actual, inventory) {
  const expected = new Map();
  const issues = [];
  for (const row of rows) {
    const previous = expected.get(row.storage_key);
    if (previous && previous.sha256 !== row.sha256) issues.push({ type: 'conflicting_database_reference', keyFingerprint: fingerprint(row.storage_key) });
    expected.set(row.storage_key, { sha256: row.sha256, bytes: row.byte_size === null ? null : Number(row.byte_size) });
  }
  for (const [key, metadata] of expected) {
    const object = actual.get(key);
    if (!object) issues.push({ type: 'database_reference_missing_object', keyFingerprint: fingerprint(key) });
    else if (object.sha256 !== metadata.sha256 || (metadata.bytes !== null && object.bytes !== metadata.bytes)) issues.push({ type: 'object_checksum_mismatch', keyFingerprint: fingerprint(key) });
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) issues.push({ type: 'orphan_object', keyFingerprint: fingerprint(key) });
  }
  if (inventory) {
    const inventoryObjects = new Map(inventory.objects.map((object) => [object.key, object]));
    for (const [key, object] of actual) {
      const recorded = inventoryObjects.get(key);
      if (!recorded || recorded.sha256 !== object.sha256 || recorded.bytes !== object.bytes) issues.push({ type: 'wrong_backup_generation', keyFingerprint: fingerprint(key) });
    }
    for (const key of inventoryObjects.keys()) {
      if (!actual.has(key)) issues.push({ type: 'partial_object_restore', keyFingerprint: fingerprint(key) });
    }
  }
  return { expected, issues };
}

export async function reconcileObjectStore({ client, bucket, databaseUrl, inventoryPath, reportPath }) {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  let rows;
  try {
    rows = (await database.query(`
      SELECT storage_key, sha256, byte_size::text AS byte_size, 'document' AS source FROM documents
      UNION ALL
      SELECT storage_key, sha256, NULL AS byte_size, 'document_version' AS source FROM document_versions
      ORDER BY storage_key
    `)).rows;
  } finally {
    await database.end();
  }
  const listed = await listCurrentObjects(client, bucket);
  const actual = new Map();
  for (const listedObject of listed) {
    const content = await objectBytes(await client.send(new GetObjectCommand({ Bucket: bucket, Key: listedObject.key })));
    actual.set(listedObject.key, { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  let inventory;
  if (inventoryPath) {
    inventory = await readJson(inventoryPath);
  }
  const { expected, issues } = reconciliationIssues(rows, actual, inventory);
  const report = { kind: 'sco-recovery-reconciliation', schemaVersion: 1, checkedAt: new Date().toISOString(), databaseReferences: expected.size, storageObjects: actual.size, issueCount: issues.length, issues };
  if (reportPath) await writeJsonSecure(reportPath, report);
  log('object_reconciliation_completed', { database_references: expected.size, storage_objects: actual.size, issue_count: issues.length });
  if (issues.length) throw new Error('OBJECT_RECONCILIATION_FAILED');
  return report;
}

async function ensureBucket(client, bucket, enableVersioning) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!['NotFound', 'NoSuchBucket'].includes(safeError(error)) && error?.$metadata?.httpStatusCode !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  if (enableVersioning) await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  log('recovery_bucket_ready', { versioning_enabled: enableVersioning });
}

async function seedDrill(client, bucket, outputPath) {
  if (process.env.SCO_RECOVERY_ENVIRONMENT !== 'local-drill') throw new Error('LOCAL_DRILL_ENVIRONMENT_REQUIRED');
  const fixtures = [
    { key: '10000000-0000-4000-8000-000000000001/drill-document', content: Buffer.from('SCO synthetic recovery document\n') },
    { key: '10000000-0000-4000-8000-000000000001/drill-document-version', content: Buffer.from('SCO synthetic recovery document version\n') },
  ];
  const output = [];
  for (const fixture of fixtures) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: fixture.key, Body: fixture.content }));
    output.push({ key: fixture.key, bytes: fixture.content.length, sha256: createHash('sha256').update(fixture.content).digest('hex') });
  }
  await writeJsonSecure(outputPath, { objects: output });
  log('recovery_drill_objects_seeded', { object_count: output.length });
}

function options(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || values[index + 1] === undefined) throw new Error('INVALID_ARGUMENTS');
    result[values[index].slice(2)] = values[index + 1];
  }
  return result;
}

async function main() {
  const command = process.argv[2];
  const input = options(process.argv.slice(3));
  if (command === 'export') {
    const { client, bucket } = s3Configuration('SCO_BACKUP_S3');
    await exportObjectStore({ client, bucket, root: required(input, 'root'), backupId: required(input, 'backup-id'), createdAt: required(input, 'created-at') });
  } else if (command === 'restore') {
    const { client, bucket } = s3Configuration('SCO_RESTORE_S3');
    await restoreObjectStore({ client, bucket, root: required(input, 'root'), expectedBackupId: required(input, 'backup-id') });
  } else if (command === 'reconcile') {
    const prefix = input.prefix ?? 'SCO_RESTORE_S3';
    const databaseUrlEnvironment = input['database-url-environment'] ?? 'SCO_RESTORE_DATABASE_URL';
    const { client, bucket } = s3Configuration(prefix);
    await reconcileObjectStore({ client, bucket, databaseUrl: required(process.env, databaseUrlEnvironment), inventoryPath: input.inventory, reportPath: input.report });
  } else if (command === 'ensure-bucket') {
    const { client, bucket } = s3Configuration(required(input, 'prefix'));
    await ensureBucket(client, bucket, boolean(input['enable-versioning']));
  } else if (command === 'seed-drill') {
    const { client, bucket } = s3Configuration('SCO_BACKUP_S3');
    await seedDrill(client, bucket, required(input, 'output'));
  } else {
    throw new Error('UNKNOWN_OBJECT_STORE_COMMAND');
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ level: 'error', event: 'object_recovery_failed', reason: error instanceof Error ? error.message : 'UNKNOWN_ERROR', error_category: safeError(error) }));
    process.exitCode = 1;
  });
}