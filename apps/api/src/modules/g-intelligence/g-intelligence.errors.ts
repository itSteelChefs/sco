import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export async function withGIntelligenceErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/FORBIDDEN|INELIGIBLE/.test(message)) throw new ForbiddenException(message);
    if (/NOT_FOUND/.test(message)) throw new NotFoundException(message);
    if (/IN_PROGRESS|EXISTS|IDEMPOTENCY|ALREADY/.test(message)) throw new ConflictException(message);
    if (/G_|VALIDATION/.test(message)) throw new BadRequestException(message);
    throw error;
  }
}
