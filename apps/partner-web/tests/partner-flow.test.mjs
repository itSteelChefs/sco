import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequestGeneration, classifyPartnerJourney, isActionableAgreement, shouldLoadAgreements, shouldLoadWorkspace, shouldShowProvisionAction } from '../components/partner-flow.mjs';

const journey = (overrides = {}) => ({
	company: { id: 'company-a', name: 'Company A' },
	actor: { userId: 'user-a', membershipId: 'membership-a' },
	operational: { procurementAccess: 'AVAILABLE' },
	relationship: { stage: 'ACTIVE', qualification: 'APPROVED', partnership: 'ACTIVE', agreementsSatisfied: true, pendingAgreements: [] },
	nextAction: { code: 'NONE', owner: 'NONE', permitted: true },
	experiences: [
		{ code: 'PARTNER_SHELL', classification: 'C', enterable: true },
		{ code: 'ONBOARDING', classification: 'B', enterable: true },
		{ code: 'PROCUREMENT', classification: 'D', enterable: true },
	],
	capabilities: [],
	...overrides,
});

test('Journey API client support exposes a safe shell decision without authorizing Workspace', () => {
	const result = classifyPartnerJourney(journey(), null);
	assert.equal(result.kind, 'WORKSPACE_ABSENT');
	assert.equal(shouldLoadWorkspace(journey()), true);
	assert.equal(shouldShowProvisionAction(journey(), null), true);
});

test('Partner Web API client declares the server-authoritative Journey route', async () => {
	const source = await readFile(new URL('../../../packages/contracts/src/api.ts', import.meta.url), 'utf8');
	assert.match(source, /partnerJourney/);
	assert.match(source, /\/api\/v1\/partner\/journey/);
});

test('Workspace loading is distinct from an absent Workspace and cannot show provisioning early', () => {
	const current = journey();
	assert.equal(classifyPartnerJourney(current, undefined).kind, 'WORKSPACE_LOADING');
	assert.equal(shouldShowProvisionAction(current, undefined), false);
});

test('onboarding and agreement remediation remain visible while Class C shell entry is allowed', () => {
	const onboarding = journey({
		relationship: { stage: 'AGREEMENT', qualification: 'APPROVED', partnership: 'UNDER_REVIEW', agreementsSatisfied: false, pendingAgreements: [{ agreementType: 'BINDING_CONFIDENTIALITY', version: 'v1', status: 'REACCEPTANCE_REQUIRED', actionable: true }] },
		nextAction: { code: 'ACCEPT_AGREEMENTS', owner: 'PARTNER', permitted: true },
	});
	assert.equal(shouldLoadWorkspace(onboarding), true);
	assert.equal(classifyPartnerJourney(onboarding, null).kind, 'WORKSPACE_ABSENT');

	const restricted = journey({ operational: { procurementAccess: 'RESTRICTED', reason: 'AGREEMENT_REQUIRED' } });
	assert.equal(shouldLoadWorkspace(restricted), true);
	assert.equal(classifyPartnerJourney(restricted, { id: 'workspace-a', capabilities: [], capabilityStates: [] }).kind, 'WORKSPACE_AVAILABLE');
});

test('Journey visibility does not imply Workspace entry or authorization', () => {
	const denied = journey({ experiences: [{ code: 'PARTNER_SHELL', classification: 'C', enterable: false, reason: 'PERMISSION_REQUIRED' }] });
	assert.equal(shouldLoadWorkspace(denied), false);
	assert.equal(shouldShowProvisionAction(denied, null), false);
});

test('agreement activation loads only server-actionable agreements and never auto-accepts', () => {
	const awaiting = journey({
		nextAction: { code: 'ACCEPT_AGREEMENTS', owner: 'PARTNER', permitted: true },
		capabilities: [{ code: 'AGREEMENT_ACCEPTANCE', classification: 'B', available: true }],
	});
	assert.equal(shouldLoadAgreements(awaiting), true);
	assert.equal(isActionableAgreement({ actionable: true }), true);
	assert.equal(isActionableAgreement({ actionable: false, required: true, acceptanceStatus: 'NOT_ACCEPTED' }), false);
	assert.equal(isActionableAgreement({ required: true, acceptanceStatus: 'REACCEPTANCE_REQUIRED' }), false);
});

test('request generation invalidates delayed A responses after switching to B and back to A', () => {
	const gate = createRequestGeneration();
	const a1 = gate.begin('company-a');
	const b = gate.begin('company-b');
	assert.equal(gate.isCurrent(a1), false);
	assert.equal(gate.isCurrent(b), true);
	const a2 = gate.begin('company-a');
	assert.equal(gate.isCurrent(b), false);
	assert.equal(gate.isCurrent(a2), true);
});

test('request generation invalidates all prior requests on session or authorization reset', () => {
	const gate = createRequestGeneration();
	const token = gate.begin('company-a');
	gate.invalidate();
	assert.equal(gate.isCurrent(token), false);
});
