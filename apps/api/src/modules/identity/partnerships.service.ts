import { Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class PartnershipsService {
  constructor(
    @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(actorUserId: string, companyId: string, type: 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP') {
    const row = await this.internal.partnershipCreate(actorUserId, companyId, type);
    if (!row) return null;
    await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: 'partnership.created', entityType: 'CompanyPartnership', entityId: row.id, metadata: { type } });
    return row;
  }

  async activate(actorUserId: string, id: string) {
    const row = await this.internal.partnershipActivate(actorUserId, id);
    if (!row) return null;
    await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: 'partnership.activated', entityType: 'CompanyPartnership', entityId: id });
    return row;
  }
}
