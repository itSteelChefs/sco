import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { unauthenticated } from '../../common/http/api-error.js';
import { AuthGuard, cookieValue, type RequestWithAuth } from './guards/auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

type LoginBody = { email?: unknown; password?: unknown };
type RequestWithHeaders = RequestWithAuth;

const sessionCookie = (token: string) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `sco_session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`;
};

@Controller('/api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('login')
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) reply: FastifyReply) {
    if (typeof body.email !== 'string' || typeof body.password !== 'string') throw unauthenticated();
    const token = await this.auth.login(body.email, body.password);
    reply.header('set-cookie', sessionCookie(token));
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async logout(
    @Req() request: RequestWithHeaders,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() _body: unknown,
  ) {
    const token = cookieValue(request.headers.cookie, 'sco_session');
    if (!token) throw unauthenticated();
    await this.sessions.revoke(token);
    reply.header('set-cookie', 'sco_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { ok: true };
  }
}
