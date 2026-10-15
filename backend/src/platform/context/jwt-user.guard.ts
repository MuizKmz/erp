import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env';
import { IS_PUBLIC_KEY } from './context.decorators';
import { PermissionRegistry } from './permission.registry';
import { USER_DIRECTORY, type ErpRequest, type UserDirectory } from './request-context';
import { SESSION_GATE, type AccessClaims, type SessionGate } from './session-gate';
import { TenantService } from './tenant.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signedOut(code: string, message: string): HttpException {
  return new HttpException({ code, message }, HttpStatus.UNAUTHORIZED);
}

/**
 * Sign-in mode (AUTH_MODE=jwt, Phase 4 · A5): the access token in the Authorization header names the user, the session
 * and the active branch. The session is checked on every request. The branch cannot be set by a header in this mode
 * (SDD 10.2). Builds the same RequestContext the dev guard does, so controllers and services do not change.
 */
@Injectable()
export class JwtUserGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tenants: TenantService,
    private readonly permissions: PermissionRegistry,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    @Inject(SESSION_GATE) private readonly gate: SessionGate,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('AUTH_MODE', { infer: true }) === 'jwt';
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;

    const request = ctx.switchToHttp().getRequest<ErpRequest>();
    const auth = request.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) throw signedOut('NOT_SIGNED_IN', 'Sign in to continue.');

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token);
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw signedOut(expired ? 'TOKEN_EXPIRED' : 'NOT_SIGNED_IN', expired ? 'Your sign-in needs refreshing.' : 'Sign in to continue.');
    }
    const tenantId = await this.tenants.resolve();
    if (claims.tid !== tenantId) throw signedOut('NOT_SIGNED_IN', 'Sign in to continue.');

    const answer = await this.gate.pass(claims);
    if (!answer.ok) throw signedOut(answer.code, answer.message);

    const user = await this.users.findUserByCode(tenantId, claims.code);
    if (!user || user.id !== claims.sub || !user.isActive) throw signedOut('NOT_SIGNED_IN', 'Your account is no longer active. Ask an administrator.');
    // The branch in the token, unless it was made inactive since: then the user's default.
    const branchCode = user.branchCodes.includes(claims.br) ? claims.br : user.branchCodes[0];
    if (!branchCode) throw new HttpException({ code: 'NO_BRANCH', message: `${user.name} is not assigned to any branch.` }, HttpStatus.FORBIDDEN);

    await this.permissions.refresh(tenantId);
    const correlation = request.headers['x-correlation-id'];
    const correlationId = typeof correlation === 'string' && UUID.test(correlation) ? correlation : randomUUID();
    const { isActive: _isActive, ...currentUser } = user;
    request.context = { tenantId, user: currentUser, branchCode, correlationId, sessionId: claims.sid };
    return true;
  }
}
