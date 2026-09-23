import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
export function correlationIdMiddleware(request: IncomingMessage, response: ServerResponse, done: () => void) {
  const incoming = request.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && incoming.length < 128 ? incoming : randomUUID();
  (request as IncomingMessage & { correlationId?: string }).correlationId = id;
  response.setHeader('x-correlation-id', id);
  done();
}
