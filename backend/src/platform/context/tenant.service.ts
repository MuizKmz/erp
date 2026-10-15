import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** The tenant this server serves (DEV_TENANT_CODE, in both modes), looked up once. */
@Injectable()
export class TenantService {
  private tenantId: string | undefined;
  private tenantName = '';
  private readonly code: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.code = config.get('DEV_TENANT_CODE', { infer: true });
  }

  async resolve(): Promise<string> {
    if (this.tenantId) return this.tenantId;
    const tenant = await this.prisma.sysTenant.findUnique({ where: { code: this.code }, select: { id: true, name: true } });
    if (!tenant) {
      throw new HttpException({ code: 'NO_TENANT', message: `Tenant "${this.code}" is not set up. Run: npx prisma db seed` }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.tenantId = tenant.id;
    this.tenantName = tenant.name;
    return tenant.id;
  }

  /** "CLB Groups", for the sign-in page and the footer. */
  async name(): Promise<string> {
    await this.resolve();
    return this.tenantName;
  }
}
