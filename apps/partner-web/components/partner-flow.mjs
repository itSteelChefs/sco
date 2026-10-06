export function shouldLoadWorkspace(journey) {
  return journey.experiences.some((experience) => experience.code === 'PARTNER_SHELL' && experience.enterable);
}

export function shouldShowProvisionAction(journey, workspace) {
  return workspace === null && shouldLoadWorkspace(journey);
}

export function shouldLoadAgreements(journey) {
  return journey.nextAction?.code === 'ACCEPT_AGREEMENTS';
}

export function isActionableAgreement(agreement) {
  return agreement.actionable === true;
}

export function classifyPartnerJourney(journey, workspace) {
  if (!shouldLoadWorkspace(journey)) {
    return { kind: 'JOURNEY_BLOCKED', reason: journey.experiences.find((experience) => experience.code === 'PARTNER_SHELL')?.reason };
  }
  if (workspace === undefined) return { kind: 'WORKSPACE_LOADING' };
  return workspace ? { kind: 'WORKSPACE_AVAILABLE' } : { kind: 'WORKSPACE_ABSENT' };
}

export function createRequestGeneration() {
  let generation = 0;
  return {
    begin(companyId) {
      generation += 1;
      return { companyId, generation };
    },
    isCurrent(token) {
      return token.generation === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}
