// Application-level mapping from company service entitlements to Partner-visible workspace capabilities.
//
// Entitlement answers "what is available to this company"; the required permission answers "may this user see/use it".
// Visibility here is advisory only: every operation behind a capability still enforces its own H1 authorization.
// Entitlement codes that are not listed (including internal support-consent codes such as PARTNER_CONTEXT_SUPPORT) are
// never exposed. No Partner-visible, service-bound capability exists in the repository today, so the production
// registry is intentionally empty; adding one is a single entry that must reuse an existing permission code.

export const WORKSPACE_CAPABILITY_REGISTRY = 'WORKSPACE_CAPABILITY_REGISTRY';

export type WorkspaceCapabilityDefinition = {
  // Entitlement code stored in service_entitlements (never returned to the Partner).
  readonly serviceCode: string;
  // Public, Partner-facing capability identifier.
  readonly capability: string;
  // Existing RBAC permission the actor must hold to see the capability.
  readonly requiredPermission: string;
  // When true, the capability is reported unavailable while H2 operational procurement access is RESTRICTED.
  readonly requiresOperationalAccess: boolean;
};

export const DEFAULT_WORKSPACE_CAPABILITIES: readonly WorkspaceCapabilityDefinition[] = Object.freeze([]);

const serviceCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/;
const capabilityPattern = /^[A-Z][A-Z0-9_]{2,63}$/;

// Fails closed at start-up on an ambiguous or malformed mapping instead of guessing at request time.
export function validateWorkspaceCapabilityRegistry(registry: readonly WorkspaceCapabilityDefinition[]): readonly WorkspaceCapabilityDefinition[] {
  const serviceCodes = new Set<string>();
  const capabilities = new Set<string>();
  for (const entry of registry) {
    if (!serviceCodePattern.test(entry.serviceCode) || !capabilityPattern.test(entry.capability) || !entry.requiredPermission.trim()) {
      throw new Error('WORKSPACE_CAPABILITY_REGISTRY_INVALID');
    }
    if (serviceCodes.has(entry.serviceCode) || capabilities.has(entry.capability)) throw new Error('WORKSPACE_CAPABILITY_REGISTRY_AMBIGUOUS');
    serviceCodes.add(entry.serviceCode);
    capabilities.add(entry.capability);
  }
  return registry;
}
