import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PURPOSE, PURPOSE_FLOW, type PurposeCode, type PurposeFlowStatus } from '../../src/modules/rbac/purpose-registry.js';

const contractUrl = new URL('../../../../docs/architecture/stage-006-purpose-taxonomy-cross-purpose-flow-contract.md', import.meta.url);
const statusByContractText: Record<string, PurposeFlowStatus> = {
  ALLOWED: 'ALLOWED',
  'ALLOWED (minimized)': 'ALLOWED',
  'ALLOWED (canonical reference data only)': 'ALLOWED',
  'ALLOWED (mandatory)': 'ALLOWED',
  'ALLOWED (aggregate, non-identifiable output)': 'ALLOWED',
  'DENIED BY DEFAULT': 'DENIED_BY_DEFAULT',
  'OWNER DECISION REQUIRED': 'OWNER_DECISION_REQUIRED',
  'NOT IMPLEMENTED': 'NOT_IMPLEMENTED',
};
const purposeCodes = new Set<string>(Object.values(PURPOSE));
const semanticEndpointPurpose: Record<string, PurposeCode> = {
  'all purposes (minimum actor attribution only)': PURPOSE.IDENTITY,
  'all purposes (decision/context metadata only)': PURPOSE.AUTHORIZATION,
  'partner egress': PURPOSE.COMMERCIAL_OFFER,
  'purposes needing canonical product/unit/currency reference': PURPOSE.CATALOG,
  'partner Verify result': PURPOSE.VERIFY,
  'Verify raw content': PURPOSE.VERIFY,
  'any non-Verify purpose': PURPOSE.VERIFY,
  'Partner/project identity': PURPOSE.PROJECT_CONTEXT,
  'supplier-facing context': PURPOSE.SUPPLY_NETWORK,
  'commercial purposes': PURPOSE.COMMERCIAL_PRICING,
  'Operational procurement history': PURPOSE.PROCUREMENT_OPERATIONS,
  'buying-power aggregation': PURPOSE.PROCUREMENT_INTELLIGENCE,
  'Buy-side cost / supplier performance': PURPOSE.BUY_SIDE_SOURCING,
  'Partner/project-identifiable data': PURPOSE.PROJECT_CONTEXT,
  'PUR-17 beyond buying power': PURPOSE.PROCUREMENT_INTELLIGENCE,
  'PUR-05/PUR-06 Procurement': PURPOSE.PROCUREMENT_NEED_INTAKE,
  'All purposes': PURPOSE.AUDIT,
};
const flowSpecificSemanticEndpointPurpose: Record<string, PurposeCode> = {
  'CPF-15:target:partner egress': PURPOSE.DELIVERY,
  'CPF-16:target:partner egress': PURPOSE.COMMERCIAL_COMMITMENT,
};

type ContractFlow = {
  id: string;
  source: string;
  target: string;
  sourcePurpose: PurposeCode;
  targetPurpose: PurposeCode;
  status: PurposeFlowStatus;
};

function endpointPurpose(endpoint: string, flowId: string, side: 'source' | 'target'): PurposeCode {
  const flowSpecificSemantic = flowSpecificSemanticEndpointPurpose[`${flowId}:${side}:${endpoint}`];
  if (flowSpecificSemantic) return flowSpecificSemantic;
  const identifiers = [...endpoint.matchAll(/\bPUR-\d{2}\b/g)].map((match) => match[0]);
  if (identifiers.length === 1 && purposeCodes.has(identifiers[0])) return identifiers[0] as PurposeCode;
  if (identifiers.length > 1) {
    const semantic = semanticEndpointPurpose[endpoint];
    if (semantic) return semantic;
    throw new Error(`MALFORMED_${side.toUpperCase()}_ENDPOINT:${flowId}:${endpoint}`);
  }
  const semantic = semanticEndpointPurpose[endpoint];
  if (semantic) return semantic;
  throw new Error(`UNKNOWN_${side.toUpperCase()}_ENDPOINT:${flowId}:${endpoint}`);
}

async function contractFlows(): Promise<ContractFlow[]> {
  const lines = (await readFile(contractUrl, 'utf8')).split('\n');
  const header = '| ID | Source → Destination | Policy Status | Current Technical Enforcement |';
  const start = lines.indexOf(header);
  if (start === -1) throw new Error('CPF_CONTRACT_TABLE_NOT_FOUND');

  const rows: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  if (!rows.length) throw new Error('CPF_CONTRACT_ROWS_NOT_FOUND');

  return rows.map((line) => {
    const cells = line.split('|');
    if (cells.length !== 6 || cells[0] !== '' || cells[5] !== '') throw new Error(`MALFORMED_CPF_CONTRACT_ROW:${line}`);
    const [id, endpoints, statusText] = cells.slice(1, 4).map((cell) => cell.trim());
    if (!/^CPF-\d{2}$/.test(id)) throw new Error(`MALFORMED_CPF_ID:${id}`);
    const endpointParts = endpoints.split(' → ');
    if (endpointParts.length !== 2 || !endpointParts[0] || !endpointParts[1]) throw new Error(`MALFORMED_CPF_ENDPOINTS:${id}:${endpoints}`);
    const status = statusByContractText[statusText];
    if (!status) throw new Error(`UNRECOGNIZED_CPF_CONTRACT_STATUS:${id}:${statusText}`);
    return {
      id: id.replace('-', '_'),
      source: endpointParts[0],
      target: endpointParts[1],
      sourcePurpose: endpointPurpose(endpointParts[0], id, 'source'),
      targetPurpose: endpointPurpose(endpointParts[1], id, 'target'),
      status,
    };
  });
}

describe('Stage-006-B purpose and CPF registry correspondence', () => {
  it('contains exactly the 18 authorized purpose IDs', () => {
    expect(Object.values(PURPOSE)).toHaveLength(18);
    expect(new Set(Object.values(PURPOSE)).size).toBe(18);
    expect(Object.values(PURPOSE)).toEqual(Array.from({ length: 18 }, (_, index) => `PUR-${String(index + 1).padStart(2, '0')}`));
  });

  it('fails closed unless every authoritative CPF row exactly corresponds to the registry', async () => {
    const contract = await contractFlows();
    const registry = Object.values(PURPOSE_FLOW);

    expect(contract).toHaveLength(41);
    expect(new Set(contract.map((flow) => flow.id)).size).toBe(41);
    expect(registry).toHaveLength(41);
    expect(new Set(registry.map((flow) => flow.id)).size).toBe(41);
    expect(contract.map((flow) => flow.id).sort()).toEqual(registry.map((flow) => flow.id).sort());

    for (const expected of contract) {
      const actual = registry.find((flow) => flow.id === expected.id);
      expect(actual, `${expected.id} is absent from the registry`).toBeDefined();
      expect(actual?.source, `${expected.id} source (${expected.source})`).toBe(expected.sourcePurpose);
      expect(actual?.target, `${expected.id} target (${expected.target})`).toBe(expected.targetPurpose);
      expect(actual?.status, `${expected.id} policy status`).toBe(expected.status);
    }
  });
});
