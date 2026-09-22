import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';

@Module({ imports: [IdentityModule, AuthModule] })
export class AppModule {}
