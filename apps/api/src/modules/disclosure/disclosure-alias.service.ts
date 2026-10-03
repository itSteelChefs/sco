import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DisclosureDatabaseService } from './disclosure-database.service.js';
import type { DisclosureResourceType, IdentityClass, RecipientContext } from './disclosure.types.js';

const aliasPattern = /^[A-Za-z0-9_-]{32,128}$/;

@Injectable()
export class DisclosureAliasService {
  constructor(@Inject(DisclosureDatabaseService) private readonly database: DisclosureDatabaseService) {}

  async createTrustedAlias(actorUserId: string, input: {
    ownerCompanyId: string;
    recipientCompanyId: string;
    recipientContext: RecipientContext;
    resourceType: DisclosureResourceType;
    resourceId: string;
    identityClass: IdentityClass;
    subjectReference: string;
  }, generator: () => string = () => randomBytes(24).toString('base64url')): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const alias = generator();
      if (!aliasPattern.test(alias)) throw new Error('DISCLOSURE_ALIAS_GENERATOR_INVALID');
      try {
        await this.database.createAlias(actorUserId, { ...input, alias });
        return alias;
      } catch (error: unknown) {
        if ((error as { code?: string }).code !== '23505' || attempt === 2) throw error;
      }
    }
    throw new Error('DISCLOSURE_ALIAS_CREATION_FAILED');
  }

  async retireTrustedAlias(actorUserId: string, aliasId: string): Promise<void> {
    await this.database.retireAlias(actorUserId, aliasId);
  }
}
