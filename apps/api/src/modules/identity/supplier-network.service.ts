import { Inject, Injectable } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';

@Injectable()
export class SupplierNetworkService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService) {}
  async eligibleSources(actor: string, executionItemId: string) {
    return this.internal.supplierEligibleSources(actor, executionItemId);
  }

  async recordQualificationDecision(actorUserId: string, qualificationId: string, status: string, reason?: string) {
    return this.internal.supplierQualificationDecide(actorUserId, qualificationId, status, reason);
  }

  async createPurchaseSource(actorUserId: string, input: { supplierCompanyId: string; supplierPartnershipId: string; sourceCode: string; sourceTypeId: string; branchContext?: string; commercialRoute?: string; operationalContext?: string }) {
    return this.internal.purchaseSourceCreate(actorUserId, input);
  }
}
