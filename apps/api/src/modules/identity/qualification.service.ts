import { Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class QualificationService {
  constructor(
    @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(actorUserId: string, legalName: string, contactEmail: string) {
    const row = await this.internal.qualificationCreate(actorUserId, legalName, contactEmail);
    await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: 'qualification.created', entityType: 'QualificationApplication', entityId: row.id });
    return row;
  }

  async decide(actorUserId: string, id: string, status: 'APPROVED' | 'REJECTED', reason?: string) {
    const row = await this.internal.qualificationDecide(actorUserId, id, status, reason);
    if (!row) return null;
    await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: `qualification.${status.toLowerCase()}`, entityType: 'QualificationApplication', entityId: id, metadata: { reasonProvided: Boolean(reason) } });
    return row;
  }

  async list(actorUserId: string) {
    return this.internal.qualificationList(actorUserId);
  }
}
