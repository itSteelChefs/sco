import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
const safeCorrelationId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export function correlationIdMiddleware(request: IncomingMessage, response: ServerResponse, done: () => void) {
  const incoming = request.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && safeCorrelationId.test(incoming) ? incoming : randomUUID();
  (request as IncomingMessage & { correlationId?: string }).correlationId = id;
  response.setHeader('x-correlation-id', id);
  done();
}
