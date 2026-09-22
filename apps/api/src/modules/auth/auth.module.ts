import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [DatabaseModule, forwardRef(() => IdentityModule)],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, AuthGuard],
  exports: [AuthGuard, SessionService],
})
export class AuthModule {}
