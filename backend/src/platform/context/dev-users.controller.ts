import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './context.decorators';
import { USER_DIRECTORY, type UserDirectory } from './request-context';

/**
 * Dev only (AUTH_MODE=dev): the users the dev user switcher offers. Public, because it is called before
 * a user is picked. Disappears with login.
 */
@Controller('dev')
export class DevUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(USER_DIRECTORY) private readonly directory: UserDirectory,
  ) {}

  @Public()
  @Get('users')
  async list() {
    if (this.config.get('AUTH_MODE', { infer: true }) !== 'dev') {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Not available.' }, HttpStatus.NOT_FOUND);
    }
    const tenant = await this.prisma.sysTenant.findUnique({ where: { code: this.config.get('DEV_TENANT_CODE', { infer: true }) } });
    if (!tenant) return { items: [], defaultUser: null };
    const users = await this.directory.listUsers(tenant.id);
    return {
      tenantName: tenant.name,
      defaultUser: this.config.get('DEV_DEFAULT_USER', { infer: true }),
      items: users
        .filter((u) => u.isActive)
        .map((u) => ({ code: u.code, name: u.name, email: u.email, roles: u.roles, branchCodes: u.branchCodes, department: u.department })),
    };
  }
}
