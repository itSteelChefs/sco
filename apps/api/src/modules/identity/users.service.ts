import { Inject, Injectable } from '@nestjs/common';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';

@Injectable()
export class UsersService {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async findByEmail(email: string) {
    const result = await this.database.query<{
      id: string;
      email: string;
      passwordHash: string;
      status: 'ACTIVE' | 'DISABLED';
    }>('SELECT id, email, "passwordHash", status FROM "User" WHERE email = $1', [email.toLowerCase()]);
    return result.rows[0] ?? null;
  }
}
