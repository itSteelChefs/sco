import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { StagedObject, StorageProvider } from './storage-provider.js';

@Injectable()
export class DevelopmentStorageProvider implements StorageProvider {
  private readonly root = resolve(process.cwd(), 'storage-development');
  async stage(input: { storageKey: string; content: Uint8Array }): Promise<StagedObject> {
    const safeKey = input.storageKey.split('/').map((segment) => basename(segment)).join('/');
    const target = resolve(this.root, safeKey);
    if (!target.startsWith(`${this.root}/`)) throw new Error('INVALID_STORAGE_KEY');
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, input.content, { flag: 'wx' });
    return { storageKey: safeKey, byteSize: input.content.byteLength, sha256: createHash('sha256').update(input.content).digest('hex') };
  }
  async readPrivate(storageKey: string): Promise<Uint8Array> {
    const safeKey = storageKey.split('/').map((segment) => basename(segment)).join('/');
    const absolutePath = resolve(this.root, safeKey);
    if (!absolutePath.startsWith(`${this.root}/`)) throw new Error('INVALID_STORAGE_KEY');
    return readFile(absolutePath);
  }
}
