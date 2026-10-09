export type FakeExecutionStatus = 'PENDING' | 'ESTABLISHED' | 'FAILED' | 'TERMINATED' | 'UNAVAILABLE';

export type FakeBindingStatus = 'BOUND' | 'UNAVAILABLE';

type Mapping = {
  tenantId: string;
  collaborationId: string;
  executionId: string;
  participationId: string;
  bindingId?: string;
};

type FakeExecution = {
  executionId: string;
  status: FakeExecutionStatus;
  handle?: string;
  bindings: Set<string>;
};

export type PresenceObservation = Mapping & {
  authenticatedSource: boolean;
  handle: string;
  sequence: number;
  nonce: string;
  observedAt: number;
};

export type FakeCallbackEvent = Mapping & {
  eventId: string;
  handle: string;
  sequence: number;
};

export type PresenceBoundaryOptions = {
  now?: () => number;
  freshnessWindowMs?: number;
};

export type PresenceResult = {
  status: 'ACCEPTED' | 'REPLAY_REJECTED' | 'AUTHORITY_REJECTED' | 'MAPPING_REJECTED' | 'SOURCE_REJECTED' | 'STALE_REJECTED';
  disclosure: 'HIDDEN';
};

export class Stage013FakeAdapter {
  private readonly executions = new Map<string, FakeExecution>();
  private readonly callbackEvents = new Map<string, number>();
  private readonly bindingMappings = new Map<string, Mapping>();
  private nextHandle = 1;

  establish(executionId: string, outcome: 'success' | 'failure' | 'delayed' | 'unavailable' = 'success') {
    const existing = this.executions.get(executionId);
    if (existing) return { status: existing.status, handle: existing.handle };
    const execution: FakeExecution = {
      executionId,
      status: outcome === 'success' ? 'ESTABLISHED' : outcome === 'delayed' ? 'PENDING' : outcome === 'unavailable' ? 'UNAVAILABLE' : 'FAILED',
      handle: outcome === 'success' ? `opaque-${this.nextHandle++}` : undefined,
      bindings: new Set(),
    };
    this.executions.set(executionId, execution);
    return { status: execution.status, handle: execution.handle };
  }

  resolve(executionId: string) {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'PENDING') return { status: execution?.status ?? 'UNAVAILABLE', handle: execution?.handle };
    execution.status = 'ESTABLISHED';
    execution.handle = `opaque-${this.nextHandle++}`;
    return { status: execution.status, handle: execution.handle };
  }

  bind(handle: string, participationId: string, mapping?: Mapping): { status: FakeBindingStatus } {
    const execution = [...this.executions.values()].find((candidate) => candidate.handle === handle);
    if (!execution || execution.status !== 'ESTABLISHED') return { status: 'UNAVAILABLE' };
    execution.bindings.add(participationId);
    if (mapping) this.bindingMappings.set(`${handle}:${participationId}`, { ...mapping });
    return { status: 'BOUND' };
  }

  callback(event: FakeCallbackEvent) {
    const execution = [...this.executions.values()].find((candidate) => candidate.handle === event.handle);
    if (!execution || execution.executionId !== event.executionId || execution.status !== 'ESTABLISHED') return { status: 'MAPPING_REJECTED' as const };
    if (!execution.bindings.has(event.participationId)) return { status: 'MAPPING_REJECTED' as const };
    const mapping = this.bindingMappings.get(`${event.handle}:${event.participationId}`);
    if (!mapping || mapping.tenantId !== event.tenantId || mapping.collaborationId !== event.collaborationId || mapping.executionId !== event.executionId || mapping.participationId !== event.participationId || mapping.bindingId !== event.bindingId) return { status: 'MAPPING_REJECTED' as const };
    const previous = this.callbackEvents.get(`${event.handle}:${event.participationId}`) ?? 0;
    if (event.sequence <= previous || this.callbackEvents.has(`event:${event.eventId}`)) return { status: 'REPLAY_REJECTED' as const };
    this.callbackEvents.set(`event:${event.eventId}`, event.sequence);
    this.callbackEvents.set(`${event.handle}:${event.participationId}`, event.sequence);
    return { status: 'CALLBACK_ACCEPTED' as const };
  }

  terminate(handle: string, outcome: 'success' | 'failure' = 'success') {
    const execution = [...this.executions.values()].find((candidate) => candidate.handle === handle);
    if (!execution || execution.status !== 'ESTABLISHED') return { status: 'UNAVAILABLE' as const };
    if (outcome === 'failure') return { status: 'TERMINATION_FAILED' as const };
    execution.status = 'TERMINATED';
    return { status: 'TERMINATED' as const };
  }
}

export class Stage013PresenceBoundary {
  private readonly mappings = new Map<string, Mapping>();
  private readonly nonces = new Set<string>();
  private readonly lastSequence = new Map<string, number>();
  private readonly now: () => number;
  private readonly freshnessWindowMs: number;

  constructor(options: PresenceBoundaryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.freshnessWindowMs = options.freshnessWindowMs ?? 30_000;
  }

  registerMapping(handle: string, mapping: Mapping) {
    this.mappings.set(handle, { ...mapping });
  }

  observe(observation: PresenceObservation, currentAuthority: (mapping: Mapping) => boolean, receivedAt = this.now()): PresenceResult {
    const hidden = { disclosure: 'HIDDEN' as const };
    if (!observation.authenticatedSource) return { status: 'SOURCE_REJECTED', ...hidden };
    const mapping = this.mappings.get(observation.handle);
    if (!mapping || JSON.stringify(mapping) !== JSON.stringify({
      tenantId: observation.tenantId,
      collaborationId: observation.collaborationId,
      executionId: observation.executionId,
      participationId: observation.participationId,
      ...(observation.bindingId ? { bindingId: observation.bindingId } : {}),
    })) return { status: 'MAPPING_REJECTED', ...hidden };
    const receiptKey = `${observation.handle}:${observation.participationId}`;
    if (!Number.isFinite(receivedAt) || receivedAt < 0 || this.now() - receivedAt > this.freshnessWindowMs || receivedAt > this.now()) return { status: 'STALE_REJECTED', ...hidden };
    const sequenceKey = `${observation.handle}:${observation.tenantId}:${observation.collaborationId}:${observation.executionId}:${observation.participationId}`;
    const previousSequence = this.lastSequence.get(sequenceKey) ?? 0;
    if (observation.sequence <= previousSequence || this.nonces.has(observation.nonce)) return { status: 'REPLAY_REJECTED', ...hidden };
    if (!currentAuthority(mapping)) return { status: 'AUTHORITY_REJECTED', ...hidden };
    this.nonces.add(observation.nonce);
    this.lastSequence.set(sequenceKey, observation.sequence);
    this.lastSequence.set(receiptKey, observation.sequence);
    return { status: 'ACCEPTED', ...hidden };
  }

  read() {
    return { disclosure: 'HIDDEN' as const };
  }
}
