import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { CurrentUserInfo, ErpRequest, RequestContext } from './request-context';

export const IS_PUBLIC_KEY = 'erp:isPublic';
export const PERMISSIONS_KEY = 'erp:permissions';

/** No user needed (health check). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** The user's roles must grant every listed permission, e.g. @RequirePermission('purchase.order.release'). */
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

function contextOf(ctx: ExecutionContext): RequestContext {
  const request = ctx.switchToHttp().getRequest<ErpRequest>();
  if (!request.context) {
    // Only reachable on a @Public() route, which must not ask for the user.
    throw new Error('No request context: the route is public or the auth guard did not run');
  }
  return request.context;
}

/** The acting user. Works the same with the dev header now and with JWT later. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserInfo => contextOf(ctx).user,
);

/** Tenant, user, branch and correlation id — pass this to services. */
export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => contextOf(ctx),
);
