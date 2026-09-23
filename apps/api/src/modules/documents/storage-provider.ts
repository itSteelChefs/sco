export type StagedObject = { storageKey: string; byteSize: number; sha256: string };
export type AuthorizedDownload = { storageKey: string; absolutePath: string };
export interface StorageProvider {
  stage(input: { storageKey: string; content: Uint8Array }): Promise<StagedObject>;
  authorizeDownload(storageKey: string): Promise<AuthorizedDownload>;
}
