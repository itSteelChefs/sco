import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(code: string, status: HttpStatus) {
    super({ error: { code } }, status);
  }
}

export const unauthenticated = () => new ApiError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
export const invalidCredentials = () => new ApiError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
export const forbidden = () => new ApiError('FORBIDDEN', HttpStatus.FORBIDDEN);
export const tenantContextRequired = () => new ApiError('TENANT_CONTEXT_REQUIRED', HttpStatus.BAD_REQUEST);
export const notFound = () => new ApiError('NOT_FOUND', HttpStatus.NOT_FOUND);
