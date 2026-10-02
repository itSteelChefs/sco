import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionsService } from './permissions.service.js';
import { PurposeAuthorizationService } from './purpose-authorization.service.js';
import { PurposeDecisionAuthorityService } from './purpose-decision-authority.service.js';
import { PurposeGuard } from './purpose.guard.js';
@Module({ imports: [DatabaseModule, AuditModule], providers: [PermissionsService, PermissionGuard, PurposeAuthorizationService, PurposeDecisionAuthorityService, PurposeGuard], exports: [PermissionsService, PermissionGuard, PurposeAuthorizationService, PurposeDecisionAuthorityService, PurposeGuard] })
export class RbacModule {}
