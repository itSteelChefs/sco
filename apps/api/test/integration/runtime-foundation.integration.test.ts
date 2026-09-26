import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';
import { S3StorageProvider } from '../../src/modules/documents/s3-storage.provider.js';
import { createDocumentStorageProvider } from '../../src/modules/documents/storage-provider.js';

let app: NestFastifyApplication;
const runtimeDatabase = { ping: vi.fn(), onModuleDestroy: vi.fn() };
const internalDatabase = { ping: vi.fn(), onModuleDestroy: vi.fn() };

describe('Stage 004 runtime foundation', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RuntimeDatabaseService)
      .useValue(runtimeDatabase)
      .overrideProvider(InternalDatabaseService)
      .useValue(internalDatabase)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    expect(runtimeDatabase.onModuleDestroy).toHaveBeenCalledOnce();
    expect(internalDatabase.onModuleDestroy).toHaveBeenCalledOnce();
  });

  it('fails closed outside development and test when S3 storage is not configured', () => {
    expect(() => createDocumentStorageProvider({ NODE_ENV: 'production' })).toThrow('SCO_DOCUMENT_STORAGE=s3 is required');
    expect(() => createDocumentStorageProvider({ NODE_ENV: 'staging', SCO_DOCUMENT_STORAGE: 'local' })).toThrow('only allowed');
  });

  it('stores and reads private S3-compatible objects without an ACL or public URL', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => new TextEncoder().encode('private') } });
    const storage = new S3StorageProvider({ send } as never, 'sco-private');
    const staged = await storage.stage({ storageKey: 'company-a/document-a', content: new TextEncoder().encode('private') });
    const content = await storage.readPrivate(staged.storageKey);

    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'sco-private', Key: staged.storageKey });
    expect(send.mock.calls[0][0].input).not.toHaveProperty('ACL');
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    expect(new TextDecoder().decode(content)).toBe('private');
  });

  it('reports liveness independently and readiness only when databases are reachable', async () => {
    runtimeDatabase.ping.mockResolvedValue(undefined);
    internalDatabase.ping.mockResolvedValue(undefined);
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);

    runtimeDatabase.ping.mockRejectedValueOnce(new Error('unavailable'));
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).json()).toEqual({ error: { code: 'NOT_READY' } });
  });
});