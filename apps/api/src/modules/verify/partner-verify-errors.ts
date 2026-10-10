import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../../common/http/api-error.js';

const verifyErrors: Readonly<Record<string, HttpStatus>> = {
  PARTNER_VERIFY_FORBIDDEN: HttpStatus.FORBIDDEN,
  PARTNER_VERIFY_NOT_AVAILABLE: HttpStatus.NOT_FOUND,
  PARTNER_VERIFY_NOT_SUBMITTABLE: HttpStatus.CONFLICT,
  VERIFY_QUOTE_REQUIRED: HttpStatus.BAD_REQUEST,
  VERIFY_QUOTE_REVISION_INVALID: HttpStatus.BAD_REQUEST,
  VERIFY_QUOTE_REVISION_IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  VERIFY_QUOTE_REVISION_STALE_PREDECESSOR: HttpStatus.CONFLICT,
  VERIFY_REQUEST_ENVELOPE_INCOMPLETE: HttpStatus.BAD_REQUEST,
  VERIFY_ALREADY_SUBMITTED: HttpStatus.CONFLICT,
  VERIFY_QUOTE_LINE_NOT_READY: HttpStatus.BAD_REQUEST,
  DOCUMENT_LINK_INVALID: HttpStatus.BAD_REQUEST,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
};

function mapMessage(message: string): string | undefined {
  if (Object.hasOwn(verifyErrors, message)) return message;
  for (const code of Object.keys(verifyErrors)) {
    if (message.includes(code)) return code;
  }
  return undefined;
}

export async function withPartnerVerifyErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error instanceof ApiError) throw error;
    const code = mapMessage(error.message);
    if (code === undefined) throw error;
    throw new ApiError(code, verifyErrors[code]);
  }
}
