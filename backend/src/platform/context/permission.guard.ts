import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedError } from '../http/errors';
import { PERMISSIONS_KEY } from './context.decorators';
import { PermissionRegistry } from './permission.registry';
import type { ErpRequest } from './request-context';

/** Enforces @RequirePermission(...). Runs after DevUserGuard, which has set request.context. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly registry: PermissionRegistry,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const user = ctx.switchToHttp().getRequest<ErpRequest>().context?.user;
    const missing = required.find((permission) => !user || !this.registry.has(user.roles, permission));
    if (missing) throw new PermissionDeniedError(missing);
    return true;
  }
}
