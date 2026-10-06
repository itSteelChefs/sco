import type { WorkspaceCapabilityDefinition } from './workspace-capability-registry.js';

export type WorkspaceCapabilityState = {
  capability: string;
  // Advisory only. Never an authorization decision: the operation behind a capability enforces its own H1 authorization.
  available: boolean;
  reason?: 'OPERATIONAL_ACCESS_RESTRICTED';
};

// Pure composition of: company entitlement x actor permission x H2 operational access (when the capability needs it).
// - not entitled, unmapped, or actor lacks the required permission -> omitted (nothing is disclosed)
// - entitled and permitted, operational access required but RESTRICTED -> listed as unavailable with a coarse reason
export function composeCapabilityStates(
  registry: readonly WorkspaceCapabilityDefinition[],
  entitledServiceCodes: ReadonlySet<string>,
  permittedPermissions: ReadonlySet<string>,
  operationalAccessAvailable: boolean,
): WorkspaceCapabilityState[] {
  const states: WorkspaceCapabilityState[] = [];
  for (const entry of registry) {
    if (!entitledServiceCodes.has(entry.serviceCode) || !permittedPermissions.has(entry.requiredPermission)) continue;
    states.push(entry.requiresOperationalAccess && !operationalAccessAvailable
      ? { capability: entry.capability, available: false, reason: 'OPERATIONAL_ACCESS_RESTRICTED' }
      : { capability: entry.capability, available: true });
  }
  return states;
}
