import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { AuthorizedDownload, StagedObject, StorageProvider } from './storage-provider.js';
import { MetricsService } from '../../observability/metrics.service.js';
import { operationalLogger } from '../../observability/telemetry.js';

function storageKey(value: string): string {
  const key = value.trim();
  if (!key || key.startsWith('/') || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  return key;
}

export class S3StorageProvider implements StorageProvider {
  constructor(private readonly client: Pick<S3Client, 'send'>, private readonly bucket: string, private readonly metrics?: MetricsService) {}

  async stage(input: { storageKey: string; content: Uint8Array }): Promise<StagedObject> {
    const key = storageKey(input.storageKey);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: input.content }));
    } catch (error) {
      this.metrics?.storageFailed('write');
      operationalLogger.error({ event: 'storage_operation_failed', operation: 'write', error_category: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    }
    return {
      storageKey: key,
      byteSize: input.content.byteLength,
      sha256: createHash('sha256').update(input.content).digest('hex'),
    };
  }

  async authorizeDownload(input: string): Promise<AuthorizedDownload> {
    return { storageKey: storageKey(input) };
  }

  async readPrivate(input: string): Promise<Uint8Array> {
    const key = storageKey(input);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) throw new Error('DOCUMENT_STORAGE_OBJECT_MISSING');
      return response.Body.transformToByteArray();
    } catch (error) {
      this.metrics?.storageFailed('read');
      operationalLogger.error({ event: 'storage_operation_failed', operation: 'read', error_category: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    }
  }
}