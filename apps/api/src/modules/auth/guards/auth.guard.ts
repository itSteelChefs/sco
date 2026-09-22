import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { unauthenticated } from '../../../common/http/api-error.js';
import { SessionService, type AuthenticatedUser } from '../session.service.js';

export type RequestWithAuth = { headers: Record<string, string | string[] | undefined>; scoUser?: AuthenticatedUser };

export const cookieValue = (header: string | string[] | undefined, name: string) => {
  const value = Array.isArray(header) ? header.join(';') : header;
  return value?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = cookieValue(request.headers.cookie, 'sco_session');
    if (!token) throw unauthenticated();
    const user = await this.sessions.resolve(token);
    if (!user) throw unauthenticated();
    request.scoUser = user;
    return true;
  }
}
