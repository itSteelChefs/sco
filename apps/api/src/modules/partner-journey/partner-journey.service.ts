import { Inject, Injectable } from '@nestjs/common';
import { notFound } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { AUTHORIZATION_OPERATION } from '../authorization/authorization-operations.js';
import { ResourceAuthorizationService } from '../authorization/resource-authorization.service.js';
import type { AuthorizationAvailability } from '../authorization/resource-authorization.types.js';
import { CompaniesService } from '../identity/companies.service.js';
import { PartnerAdmissionService } from '../identity/partner-admission.service.js';
import { PartnerProcurementAccessService } from '../identity/partner-procurement-access.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { isAgreementAcceptanceLifecycleEligible } from './agreement-actionability.js';
import type {
  JourneyNextActionCode,
  JourneyRelationship,
  JourneyStage,
  PartnerJourney,
  PartnershipState,
  QualificationState,
  UnavailableReason,
} from './partner-journey.types.js';

const QUALIFICATION_STATES: readonly QualificationState[] = ['APPLICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];
const PARTNERSHIP_STATES: readonly PartnershipState[] = ['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'];
// Agreement states a Partner can resolve by accepting the current version.
const ACTIONABLE_AGREEMENT_STATUSES = new Set(['NOT_ACCEPTED', 'REACCEPTANCE_REQUIRED']);
const SATISFIED_AGREEMENT_STATUSES = new Set(['ACCEPTED', 'SUPERSEDED', 'HISTORICALLY_RETAINED', 'ACCEPTED_HISTORICAL_VERSION']);

export function deriveStage(qualification: QualificationState, partnership: PartnershipState, agreementsSatisfied: boolean): JourneyStage {
  switch (partnership) {
    case 'ACTIVE': return 'ACTIVE';
    case 'SUSPENDED': return 'SUSPENDED';
    case 'REVOKED': return 'REVOKED';
    case 'REJECTED': return 'REJECTED';
    case 'APPROVED': return 'ONBOARDING';
    case 'UNDER_REVIEW':
      if (qualification !== 'APPROVED') return qualification === 'REJECTED' ? 'REJECTED' : 'QUALIFICATION';
      return agreementsSatisfied ? 'APPROVAL' : 'AGREEMENT';
    default:
      if (qualification === 'NONE') return 'REGISTRATION';
      if (qualification === 'REJECTED') return 'REJECTED';
      if (qualification === 'APPROVED') return agreementsSatisfied ? 'APPROVAL' : 'AGREEMENT';
      return 'QUALIFICATION';
  }
}

@Injectable()
export class PartnerJourneyService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(PartnerAdmissionService) private readonly admission: PartnerAdmissionService,
    @Inject(PartnerProcurementAccessService) private readonly procurementAccess: PartnerProcurementAccessService,
    @Inject(ResourceAuthorizationService) private readonly authorization: ResourceAuthorizationService,
  ) {}

  // Authorization of the journey read itself is enforced by ResourceAuthorizationGuard (partner_journey.read).
  async get(tenant: TenantContext): Promise<PartnerJourney> {
    const company = await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) => this.companies.findProjection(client, tenant.companyId));
    if (!company) throw notFound();

    const [canReadAdmission, canAcceptAgreements, canEnterShell] = await Promise.all([
      this.permissions.has(tenant, 'partner.admission.read'),
      this.permissions.has(tenant, 'partner.agreement.accept'),
      this.permissions.has(tenant, 'partner.portal.read'),
    ]);
    const relationship = canReadAdmission ? await this.relationship(tenant) : null;

    const verify = await this.authorization.decideAvailability(tenant, AUTHORIZATION_OPERATION.PARTNER_VERIFY_RESULT_READ);
    const extract = await this.authorization.decideAvailability(tenant, AUTHORIZATION_OPERATION.PROCUREMENT_DOCUMENT_EXTRACT);
    // The Class D gate itself, not a re-derivation: Active Partner + required agreements + portal access.
    const procurementEligible = await this.procurementAccess.allowed(tenant);

    const withReason = (availability: AuthorizationAvailability): { available: true } | { available: false; reason: UnavailableReason } => {
      if (availability.available) return { available: true };
      if (availability.reason === 'PERMISSION_MISSING') return { available: false, reason: 'PERMISSION_REQUIRED' };
      if (availability.reason === 'PARTNER_NOT_ELIGIBLE') return { available: false, reason: this.ineligibleReason(relationship, canEnterShell) };
      return { available: false, reason: 'NOT_AVAILABLE' };
    };

    return {
      company: { id: company.id, name: company.name },
      actor: { userId: tenant.userId, membershipId: tenant.membershipId },
      operational: procurementEligible
        ? { procurementAccess: 'AVAILABLE' }
        : { procurementAccess: 'RESTRICTED', reason: this.ineligibleReason(relationship, canEnterShell) },
      relationship,
      nextAction: relationship ? this.nextAction(relationship, canAcceptAgreements) : null,
      experiences: [
        canEnterShell
          ? { code: 'PARTNER_SHELL', classification: 'C', enterable: true }
          : { code: 'PARTNER_SHELL', classification: 'C', enterable: false, reason: 'PERMISSION_REQUIRED' },
        canReadAdmission
          ? { code: 'ONBOARDING', classification: 'B', enterable: true }
          : { code: 'ONBOARDING', classification: 'B', enterable: false, reason: 'PERMISSION_REQUIRED' },
        procurementEligible
          ? { code: 'PROCUREMENT', classification: 'D', enterable: true }
          : { code: 'PROCUREMENT', classification: 'D', enterable: false, reason: this.ineligibleReason(relationship, canEnterShell) },
      ],
      capabilities: [
        canAcceptAgreements
          ? { code: 'AGREEMENT_ACCEPTANCE', classification: 'B', available: true }
          : { code: 'AGREEMENT_ACCEPTANCE', classification: 'B', available: false, reason: 'PERMISSION_REQUIRED' },
        { code: 'VERIFY_RESULT_READ', classification: 'D', ...withReason(verify) },
        { code: 'PROCUREMENT_DOCUMENT_EXTRACTION', classification: 'D', ...withReason(extract) },
      ],
    };
  }

  private ineligibleReason(relationship: JourneyRelationship | null, canEnterShell: boolean): UnavailableReason {
    if (!relationship) return canEnterShell ? 'NOT_AVAILABLE' : 'PERMISSION_REQUIRED';
    if (relationship.partnership !== 'ACTIVE') return 'RELATIONSHIP_NOT_ACTIVE';
    if (!relationship.agreementsSatisfied) return 'AGREEMENT_REQUIRED';
    return canEnterShell ? 'NOT_AVAILABLE' : 'PERMISSION_REQUIRED';
  }

  private async relationship(tenant: TenantContext): Promise<JourneyRelationship> {
    const [status, agreements] = await Promise.all([this.admission.status(tenant), this.admission.agreements(tenant)]);
    const qualification = (QUALIFICATION_STATES as readonly string[]).includes(status.qualificationStatus ?? '') ? status.qualificationStatus as QualificationState : 'NONE';
    const partnership = (PARTNERSHIP_STATES as readonly string[]).includes(status.partnershipStatus ?? '') ? status.partnershipStatus as PartnershipState : 'NONE';
    return {
      stage: deriveStage(qualification, partnership, status.agreementReady),
      qualification,
      partnership,
      agreementsSatisfied: status.agreementReady,
      pendingAgreements: agreements
        .filter((agreement) => agreement.required && !SATISFIED_AGREEMENT_STATUSES.has(agreement.acceptanceStatus))
        .map((agreement) => ({
          agreementType: agreement.agreementType,
          version: agreement.version,
          status: agreement.acceptanceStatus,
          actionable: ACTIONABLE_AGREEMENT_STATUSES.has(agreement.acceptanceStatus)
            && isAgreementAcceptanceLifecycleEligible(status.partnershipStatus, status.qualificationStatus),
        })),
    };
  }

  private nextAction(relationship: JourneyRelationship, canAcceptAgreements: boolean): NonNullable<PartnerJourney['nextAction']> {
    const make = (code: JourneyNextActionCode, owner: 'PARTNER' | 'SCO' | 'NONE', permitted = true) => ({ code, owner, permitted });
    switch (relationship.stage) {
      case 'SUSPENDED':
      case 'REVOKED':
      case 'REJECTED':
        return make('CONTACT_SCO', 'SCO');
      // Agreements are requested of the Partner only after qualification has been approved.
      case 'REGISTRATION':
      case 'QUALIFICATION':
        return make('AWAIT_SCO_REVIEW', 'SCO');
      default:
        break;
    }
    if (!relationship.agreementsSatisfied) {
      return relationship.pendingAgreements.some((agreement) => agreement.actionable)
        ? make('ACCEPT_AGREEMENTS', 'PARTNER', canAcceptAgreements)
        : make('CONTACT_SCO', 'SCO');
    }
    return relationship.stage === 'ACTIVE' ? make('NONE', 'NONE') : make('AWAIT_SCO_REVIEW', 'SCO');
  }
}
