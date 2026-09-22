import { Inject, Injectable } from '@nestjs/common';
import { invalidCredentials } from '../../common/http/api-error.js';
import { UsersService } from '../identity/users.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async login(email: string, password: string): Promise<string> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'ACTIVE' || !(await this.passwords.verify(password, user.passwordHash))) {
      throw invalidCredentials();
    }
    return this.sessions.create(user.id);
  }
}
