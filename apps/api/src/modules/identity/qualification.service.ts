import { Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { withAdmissionErrors } from './partner-admission.errors.js';

@Injectable()
export class QualificationService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}

  create(actorUserId: string, legalName: string, contactEmail: string, companyId?: string) {
    return withAdmissionErrors(() => companyId
      ? this.internal.qualificationCreateForCompany(actorUserId, companyId, legalName, contactEmail)
      : this.internal.qualificationCreate(actorUserId, legalName, contactEmail));
  }

  decide(actorUserId: string, id: string, status: 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED', reason: string) {
    return withAdmissionErrors(() => this.internal.qualificationDecide(actorUserId, id, status, reason));
  }

  list(actorUserId: string) {
    return withAdmissionErrors(() => this.internal.qualificationList(actorUserId));
  }
}
