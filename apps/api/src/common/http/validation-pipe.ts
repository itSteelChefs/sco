import { BadRequestException, Injectable, ValidationPipe } from '@nestjs/common';
@Injectable()
export class ApiValidationPipe extends ValidationPipe {
  constructor() {
    super({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED' } }) });
  }
}
