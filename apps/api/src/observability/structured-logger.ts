import { Injectable, type LoggerService } from '@nestjs/common';
import { operationalLogger, redactText, safeFields } from './telemetry.js';

@Injectable()
export class StructuredLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    operationalLogger.info(safeFields({ event: 'framework_log', context, message }));
  }

  error(message: unknown, stack?: string, context?: string): void {
    operationalLogger.error(safeFields({ event: 'framework_error', context, message, stack: stack ? redactText(stack) : undefined }));
  }

  warn(message: unknown, context?: string): void {
    operationalLogger.warn(safeFields({ event: 'framework_warning', context, message }));
  }

  debug(message: unknown, context?: string): void {
    operationalLogger.debug(safeFields({ event: 'framework_debug', context, message }));
  }

  verbose(message: unknown, context?: string): void {
    operationalLogger.trace(safeFields({ event: 'framework_verbose', context, message }));
  }

  fatal(message: unknown, context?: string): void {
    operationalLogger.fatal(safeFields({ event: 'framework_fatal', context, message }));
  }
}