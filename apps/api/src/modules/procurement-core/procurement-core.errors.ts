import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../../common/http/api-error.js';

const codes: Readonly<Record<string, HttpStatus>> = {
  PARTNER_PROCUREMENT_FORBIDDEN: HttpStatus.FORBIDDEN,
  PARTNER_PROCUREMENT_INELIGIBLE: HttpStatus.FORBIDDEN,
  PROCUREMENT_REQUIREMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROCUREMENT_REQUIREMENT_NOT_DRAFT: HttpStatus.CONFLICT,
  PROCUREMENT_BOQ_REQUIRED: HttpStatus.BAD_REQUEST,
  PROCUREMENT_LINE_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROCUREMENT_LINE_FOREIGN: HttpStatus.BAD_REQUEST,
  PROCUREMENT_REVIEW_FORBIDDEN: HttpStatus.FORBIDDEN,
  PROCUREMENT_STATE_INVALID: HttpStatus.CONFLICT,
  PROCUREMENT_SUPPLIER_INVALID: HttpStatus.BAD_REQUEST,
  DOCUMENT_LINK_INVALID: HttpStatus.BAD_REQUEST,
  PROCUREMENT_COMPARISON_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROCUREMENT_ASSESSMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROCUREMENT_QUOTE_NOT_IN_COMPARISON: HttpStatus.BAD_REQUEST,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
};

function mapMessage(message: string): string | undefined {
  if (Object.hasOwn(codes, message)) return message;
  for (const code of Object.keys(codes)) {
    if (message.includes(code)) return code;
  }
  return undefined;
}

export async function withProcurementErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof Error) || error instanceof ApiError) throw error;
    const code = mapMessage(error.message);
    if (code === undefined) throw error;
    throw new ApiError(code, codes[code]);
  }
}
