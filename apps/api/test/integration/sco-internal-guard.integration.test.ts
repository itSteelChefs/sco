import { describe, expect, it } from 'vitest';
import { ScoInternalGuard } from '../../src/modules/identity/sco-internal.guard.js';

type Membership = { membershipId: string; companyId: string };

function guardFor(eligibleMembershipIds: string[], memberships: Membership[]) {
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM "CompanyMembership" cm JOIN "Company"')) {
        return { rowCount: memberships.length, rows: memberships };
      }
      if (sql.includes("SELECT set_config('app.tenant_id'")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("p.code = 'sco.internal.manage'")) {
        const membershipId = values?.[0];
        return { rowCount: eligibleMembershipIds.includes(membershipId as string) ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const database = {
    withActor: async (_actorUserId: string, callback: (transactionClient: typeof client) => Promise<boolean>) => callback(client),
  };
  return new ScoInternalGuard(database as never);
}

const requestContext = {
  switchToHttp: () => ({
    getRequest: () => ({
      scoUser: { id: 'actor' },
      companyId: 'caller-controlled-company-must-not-select-internal-context',
    }),
  }),
};

describe('ScoInternalGuard trusted SCO context', () => {
  it('allows exactly one active eligible SCO membership', async () => {
    const guard = guardFor(['membership-a'], [{ membershipId: 'membership-a', companyId: 'sco-a' }]);
    await expect(guard.canActivate(requestContext as never)).resolves.toBe(true);
  });

  it('fails closed when no SCO membership has the capability', async () => {
    const guard = guardFor([], [{ membershipId: 'membership-a', companyId: 'sco-a' }]);
    await expect(guard.canActivate(requestContext as never)).rejects.toMatchObject({ status: 403 });
  });

  it('fails closed when two SCO memberships are both eligible', async () => {
    const guard = guardFor(
      ['membership-a', 'membership-b'],
      [
        { membershipId: 'membership-a', companyId: 'sco-a' },
        { membershipId: 'membership-b', companyId: 'sco-b' },
      ],
    );
    await expect(guard.canActivate(requestContext as never)).rejects.toMatchObject({ status: 403 });
  });
});
