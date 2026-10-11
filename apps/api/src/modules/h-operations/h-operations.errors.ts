import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export async function withHOperationsErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/FORBIDDEN/.test(message)) throw new ForbiddenException(message);
    if (/NOT_FOUND/.test(message)) throw new NotFoundException(message);
    if (/IN_PROGRESS|RUNNING|TOO_SOON|EXISTS|IDEMPOTENCY/.test(message)) throw new ConflictException(message);
    if (/H_|VALIDATION/.test(message)) throw new BadRequestException(message);
    throw error;
  }
}
