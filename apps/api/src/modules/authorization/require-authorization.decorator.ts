import { SetMetadata } from '@nestjs/common';
import type { AuthorizationOperation } from './authorization-operations.js';

export const AUTHORIZED_OPERATION_KEY = 'sco:authorized-operation';
export const AuthorizeOperation = (operation: AuthorizationOperation) => SetMetadata(AUTHORIZED_OPERATION_KEY, operation);
