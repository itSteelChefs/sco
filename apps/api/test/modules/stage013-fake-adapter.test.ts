import { describe, expect, it } from 'vitest';
import { Stage013FakeAdapter, Stage013PresenceBoundary } from '../../src/modules/collaboration/stage013-fake-adapter.js';

describe('Stage 013 provider-neutral Fake Adapter and Presence boundary', () => {
  it('is deterministic, execution-scoped, and never authorizes', () => {
    const adapter = new Stage013FakeAdapter();
    const established = adapter.establish('execution-a');
    expect(established.status).toBe('ESTABLISHED');
    expect(adapter.establish('execution-a')).toEqual(established);
    expect(adapter.establish('execution-b').handle).not.toBe(established.handle);
    expect(adapter.bind(established.handle!, 'participation-a')).toEqual({ status: 'BOUND' });
    expect(adapter.bind(established.handle!, 'participation-a')).toEqual({ status: 'BOUND' });
    expect(adapter.terminate(established.handle!)).toEqual({ status: 'TERMINATED' });
    expect(adapter.bind(established.handle!, 'participation-b')).toEqual({ status: 'UNAVAILABLE' });
  });

  it('simulates delayed/failure/unavailable establishment and callback/termination outcomes', () => {
    const adapter = new Stage013FakeAdapter();
    expect(adapter.establish('delayed', 'delayed').status).toBe('PENDING');
    expect(adapter.resolve('delayed').status).toBe('ESTABLISHED');
    const handle = adapter.establish('delayed').handle!;
    expect(adapter.callback({ eventId: 'wrong', handle, executionId: 'execution-other', tenantId: 'tenant-a', collaborationId: 'collaboration-a', participationId: 'participation-a', sequence: 1 })).toEqual({ status: 'MAPPING_REJECTED' });
    expect(adapter.bind(handle, 'participation-a')).toEqual({ status: 'BOUND' });
    const event = { eventId: 'event-1', handle, executionId: 'delayed', tenantId: 'tenant-a', collaborationId: 'collaboration-a', participationId: 'participation-a', bindingId: 'binding-a', sequence: 1 };
    expect(adapter.bind(handle, 'participation-a', { tenantId: 'tenant-a', collaborationId: 'collaboration-a', executionId: 'delayed', participationId: 'participation-a', bindingId: 'binding-a' })).toEqual({ status: 'BOUND' });
    expect(adapter.callback(event)).toEqual({ status: 'CALLBACK_ACCEPTED' });
    expect(adapter.callback(event)).toEqual({ status: 'REPLAY_REJECTED' });
    expect(adapter.callback({ ...event, eventId: 'event-0', sequence: 0 })).toEqual({ status: 'REPLAY_REJECTED' });
    expect(adapter.callback({ ...event, eventId: 'event-2', tenantId: 'tenant-b', sequence: 2 })).toEqual({ status: 'MAPPING_REJECTED' });
    const unavailable = new Stage013FakeAdapter();
    expect(unavailable.establish('down', 'unavailable').status).toBe('UNAVAILABLE');
    expect(unavailable.terminate('opaque-missing', 'failure')).toEqual({ status: 'UNAVAILABLE' });
    expect(adapter.terminate(handle, 'failure')).toEqual({ status: 'TERMINATION_FAILED' });
  });

  it('accepts Presence only with authenticated exact current mapping and replay-safe ordering', () => {
    const adapter = new Stage013FakeAdapter();
    const established = adapter.establish('execution-a');
    let now = 100_000;
    const boundary = new Stage013PresenceBoundary({ now: () => now, freshnessWindowMs: 30_000 });
    boundary.registerMapping(established.handle!, {
      tenantId: 'tenant-a', collaborationId: 'collaboration-a', executionId: 'execution-a', participationId: 'participation-a', bindingId: 'binding-a',
    });
    const base = {
      authenticatedSource: true,
      handle: established.handle!,
      tenantId: 'tenant-a', collaborationId: 'collaboration-a', executionId: 'execution-a', participationId: 'participation-a', bindingId: 'binding-a',
      sequence: 1, nonce: 'nonce-a', observedAt: 99_000,
    };
    expect(boundary.observe(base, () => true, 99_000)).toEqual({ status: 'ACCEPTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 1 }, () => true, 99_000)).toEqual({ status: 'REPLAY_REJECTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 2, nonce: 'nonce-b' }, () => false, 99_000)).toEqual({ status: 'AUTHORITY_REJECTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 3, nonce: 'nonce-c', participationId: 'participation-b' }, () => true, 99_000)).toEqual({ status: 'MAPPING_REJECTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 3, nonce: 'nonce-c', observedAt: 1 }, () => true, 1)).toEqual({ status: 'STALE_REJECTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 3, nonce: 'nonce-d', observedAt: 1 }, () => true, 99_000)).toEqual({ status: 'ACCEPTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 4, nonce: 'nonce-e', observedAt: 999_999 }, () => true, 99_000)).toEqual({ status: 'ACCEPTED', disclosure: 'HIDDEN' });
    now = 130_001;
    expect(boundary.observe({ ...base, sequence: 5, nonce: 'nonce-f', observedAt: 999_999 }, () => true, 99_000)).toEqual({ status: 'STALE_REJECTED', disclosure: 'HIDDEN' });
    expect(boundary.observe({ ...base, sequence: 4, nonce: 'nonce-new-timestamp', observedAt: 999_999 }, () => true, 130_001)).toEqual({ status: 'REPLAY_REJECTED', disclosure: 'HIDDEN' });
    expect(boundary.read()).toEqual({ disclosure: 'HIDDEN' });
  });
});
