import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { AuthorizedDownload, StagedObject, StorageProvider } from './storage-provider.js';

function storageKey(value: string): string {
  const key = value.trim();
  if (!key || key.startsWith('/') || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  return key;
}

export class S3StorageProvider implements StorageProvider {
  constructor(private readonly client: Pick<S3Client, 'send'>, private readonly bucket: string) {}

  async stage(input: { storageKey: string; content: Uint8Array }): Promise<StagedObject> {
    const key = storageKey(input.storageKey);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: input.content }));
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
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error('DOCUMENT_STORAGE_OBJECT_MISSING');
    return response.Body.transformToByteArray();
  }
}