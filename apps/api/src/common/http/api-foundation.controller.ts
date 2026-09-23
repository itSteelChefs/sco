import { Controller, Get } from '@nestjs/common';
@Controller('/api/v1')
export class ApiFoundationController {
  @Get('openapi.json')
  openapi() {
    return { openapi: '3.0.3', info: { title: 'SCO API', version: '1.0.0' }, paths: { '/api/v1/auth/login': { post: {} }, '/api/v1/partner/me': { get: {} } } };
  }
}
