import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';

const absoluteLifetimeMs = 8 * 60 * 60 * 1000;
const idleLifetimeMs = 30 * 60 * 1000;

export type AuthenticatedUser = { id: string; email: string };

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + absoluteLifetimeMs);
    const idleExpiresAt = new Date(now.getTime() + idleLifetimeMs);
    await this.database.query(
      `INSERT INTO "Session" ("userId", "tokenHash", "expiresAt", "idleExpiresAt")
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash(token), expiresAt, idleExpiresAt],
    );
    return token;
  }

  async resolve(token: string): Promise<AuthenticatedUser | null> {
    const now = new Date();
    const result = await this.database.query<{
      sessionId: string;
      userId: string;
      email: string;
      status: 'ACTIVE' | 'DISABLED';
    }>(
      `SELECT s.id AS "sessionId", u.id AS "userId", u.email, u.status
       FROM "Session" s JOIN "User" u ON u.id = s."userId"
       WHERE s."tokenHash" = $1
         AND s."revokedAt" IS NULL
         AND s."expiresAt" > $2
         AND s."idleExpiresAt" > $2`,
      [tokenHash(token), now],
    );
    const session = result.rows[0];
    if (!session || session.status !== 'ACTIVE') return null;

    await this.database.query(
      'UPDATE "Session" SET "lastSeenAt" = $2, "idleExpiresAt" = $3 WHERE id = $1',
      [session.sessionId, now, new Date(now.getTime() + idleLifetimeMs)],
    );
    return { id: session.userId, email: session.email };
  }

  async revoke(token: string): Promise<void> {
    await this.database.query('UPDATE "Session" SET "revokedAt" = now() WHERE "tokenHash" = $1', [tokenHash(token)]);
  }
}
