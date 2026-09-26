import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { captureOperationalException, operationalLogger, safeFields } from './telemetry.js';

const safeCode = /^[A-Z][A-Z0-9_]{1,63}$/;

function explicitCode(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (response && typeof response === 'object') {
    const error = (response as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && safeCode.test(code)) return code;
    }
  }
  if (typeof response === 'string' && safeCode.test(response)) return response;
  return undefined;
}

function codeFor(exception: HttpException): string {
  const explicit = explicitCode(exception);
  if (explicit) return explicit;
  if (exception.getStatus() >= 500) return 'INTERNAL_ERROR';
  const defaults: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  };
  return defaults[exception.getStatus()] ?? 'REQUEST_FAILED';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest & { correlationId?: string }>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = exception instanceof HttpException ? codeFor(exception) : 'INTERNAL_ERROR';

    if (status >= 500 && code === 'INTERNAL_ERROR') {
      const context = { request_id: request.correlationId, operation: `${request.method} ${request.routeOptions?.url ?? 'unknown'}`, error_category: exception instanceof Error ? exception.name : 'UnknownError' };
      const stack = exception instanceof Error ? exception.stack?.split('\n').slice(1).join('\n') : undefined;
      operationalLogger.error(safeFields({ event: 'unexpected_error', ...context, error_category: exception instanceof Error ? exception.name : 'UnknownError', stack }));
      captureOperationalException(exception, context);
    }

    reply.status(status).send({ error: { code } });
  }
}