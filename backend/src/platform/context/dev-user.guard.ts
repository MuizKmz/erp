import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './context.decorators';
import { USER_DIRECTORY, type ErpRequest, type UserDirectory } from './request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function header(request: ErpRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/**
 * No login yet (AUTH_MODE=dev): the user is picked with the x-dev-user header (default from DEV_DEFAULT_USER).
 * Builds the RequestContext that @CurrentUser() / @CurrentContext() read. A JWT guard will replace this
 * class later without any change to controllers or services.
 */
@Injectable()
export class DevUserGuard implements CanActivate {
  private tenantId: string | undefined;
  private readonly defaultUser: string;
  private readonly tenantCode: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    config: ConfigService<Env, true>,
  ) {
    this.defaultUser = config.get('DEV_DEFAULT_USER', { infer: true });
    this.tenantCode = config.get('DEV_TENANT_CODE', { infer: true });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<ErpRequest>();
    const tenantId = await this.resolveTenantId();

    const code = (header(request, 'x-dev-user') ?? this.defaultUser).toUpperCase();
    const user = await this.users.findUserByCode(tenantId, code);
    if (!user || !user.isActive) {
      throw new HttpException(
        { code: 'UNKNOWN_USER', message: `There is no active user "${code}". Pick a user in the dev user switcher.` },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const requestedBranch = header(request, 'x-branch')?.toUpperCase();
    if (requestedBranch && !user.branchCodes.includes(requestedBranch)) {
      throw new HttpException(
        { code: 'BRANCH_NOT_ALLOWED', message: `${user.name} does not work in branch ${requestedBranch}.` },
        HttpStatus.FORBIDDEN,
      );
    }
    const branchCode = requestedBranch ?? user.branchCodes[0];
    if (!branchCode) {
      throw new HttpException(
        { code: 'NO_BRANCH', message: `${user.name} is not assigned to any branch.` },
        HttpStatus.FORBIDDEN,
      );
    }

    const correlation = header(request, 'x-correlation-id');
    const { isActive: _isActive, ...currentUser } = user;
    request.context = {
      tenantId,
      user: currentUser,
      branchCode,
      correlationId: correlation && UUID.test(correlation) ? correlation : randomUUID(),
    };
    return true;
  }

  private async resolveTenantId(): Promise<string> {
    if (this.tenantId) return this.tenantId;
    const code = this.tenantCode;
    const tenant = await this.prisma.sysTenant.findUnique({ where: { code }, select: { id: true } });
    if (!tenant) {
      throw new HttpException(
        { code: 'NO_TENANT', message: `Tenant "${code}" is not set up. Run: npx prisma db seed` },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.tenantId = tenant.id;
    return tenant.id;
  }
}
