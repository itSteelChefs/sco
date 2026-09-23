import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionsService } from './permissions.service.js';
@Module({ imports: [DatabaseModule], providers: [PermissionsService, PermissionGuard], exports: [PermissionsService, PermissionGuard] })
export class RbacModule {}
