export type ErrorEnvelope = { error: { code: string; message?: string; correlationId?: string; details?: unknown } };
export type Page<T> = { items: T[]; page: number; pageSize: number; total?: number };
