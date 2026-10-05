import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { withAdmissionErrors } from './partner-admission.errors.js';

@Injectable()
export class PartnershipsService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}

  create(actorUserId: string, companyId: string, type: 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP') {
    return withAdmissionErrors(() => this.internal.partnershipCreate(actorUserId, companyId, type));
  }

  activate(actorUserId: string, id: string) {
    return withAdmissionErrors(() => this.internal.partnershipActivate(actorUserId, id));
  }

  approve(actorUserId: string, id: string, reason: string) {
    return withAdmissionErrors(() => this.internal.partnershipApprove(actorUserId, id, reason, randomUUID()));
  }

  suspend(actorUserId: string, id: string, reason: string) {
    return withAdmissionErrors(() => this.internal.partnershipSuspend(actorUserId, id, reason, randomUUID()));
  }

  revoke(actorUserId: string, id: string, reason: string) {
    return withAdmissionErrors(() => this.internal.partnershipRevoke(actorUserId, id, reason, randomUUID()));
  }

  reject(actorUserId: string, id: string, reason: string) {
    return withAdmissionErrors(() => this.internal.partnershipReject(actorUserId, id, reason, randomUUID()));
  }

  createAgreementPolicy(actorUserId: string, input: {
    agreementType: string; versionCode: string; contentText: string; effectiveAt: string;
    acceptancePermissionCode: string; reacceptanceRequired: boolean; suspensionEffect: string;
    terminationEffect: string; retentionClassification: string; required: boolean;
  }) {
    return withAdmissionErrors(() => this.internal.agreementPolicyCreate(actorUserId, { ...input, correlationId: randomUUID() }));
  }

  publishAgreementPolicy(actorUserId: string, id: string) {
    return withAdmissionErrors(() => this.internal.agreementPolicyPublish(actorUserId, id, randomUUID()));
  }

  transitionAgreementPolicy(actorUserId: string, id: string, state: 'SUSPENDED' | 'TERMINATED', reason: string) {
    return withAdmissionErrors(() => this.internal.agreementPolicyTransition(actorUserId, id, state, reason, randomUUID()));
  }
}
