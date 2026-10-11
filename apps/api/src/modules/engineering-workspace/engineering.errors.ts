import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export async function withEngineeringErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/FORBIDDEN|INELIGIBLE/.test(message)) throw new ForbiddenException(message);
    if (/NOT_FOUND/.test(message)) throw new NotFoundException(message);
    if (/EXISTS|IDEMPOTENCY|ALREADY/.test(message)) throw new ConflictException(message);
    if (/ENGINEERING_|PARTNER_/.test(message)) throw new BadRequestException(message);
    throw error;
  }
}
