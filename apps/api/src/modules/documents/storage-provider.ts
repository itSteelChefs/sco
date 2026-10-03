import { S3Client } from '@aws-sdk/client-s3';
import { DevelopmentStorageProvider } from './development-storage.provider.js';
import { S3StorageProvider } from './s3-storage.provider.js';
import type { MetricsService } from '../../observability/metrics.service.js';

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

export type StagedObject = { storageKey: string; byteSize: number; sha256: string };
export interface StorageProvider {
  stage(input: { storageKey: string; content: Uint8Array }): Promise<StagedObject>;
  readPrivate(storageKey: string): Promise<Uint8Array>;
}

type DocumentStorageEnvironment = Record<string, string | undefined>;

function required(source: DocumentStorageEnvironment, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required when SCO_DOCUMENT_STORAGE=s3`);
  return value;
}

export function createDocumentStorageProvider(source: DocumentStorageEnvironment = process.env, metrics?: MetricsService): StorageProvider {
  const environment = source.NODE_ENV ?? 'development';
  const storage = source.SCO_DOCUMENT_STORAGE;

  if (storage === 'local' || (!storage && (environment === 'development' || environment === 'test'))) {
    if (environment !== 'development' && environment !== 'test') {
      throw new Error('SCO_DOCUMENT_STORAGE=local is only allowed in development or test');
    }
    return new DevelopmentStorageProvider();
  }

  if (storage !== 's3') {
    throw new Error('SCO_DOCUMENT_STORAGE=s3 is required outside development or test');
  }

  const endpoint = source.SCO_S3_ENDPOINT?.trim();
  const client = new S3Client({
    region: required(source, 'SCO_S3_REGION'),
    endpoint: endpoint || undefined,
    forcePathStyle: source.SCO_S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: required(source, 'SCO_S3_ACCESS_KEY_ID'),
      secretAccessKey: required(source, 'SCO_S3_SECRET_ACCESS_KEY'),
      sessionToken: source.SCO_S3_SESSION_TOKEN?.trim() || undefined,
    },
  });
  return new S3StorageProvider(client, required(source, 'SCO_S3_BUCKET'), metrics);
}
