import { Injectable } from '@nestjs/common';
import type { MdmUser, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import type { MasterDataPort, MdBranch, MdUser } from './master-data.port';

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toUser(row: MdmUser): MdUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    email: row.email,
    roles: stringArray(row.roles),
    branchCodes: stringArray(row.branchCodes),
    department: row.department,
    isActive: row.isActive,
  };
}

/** Phase 1 adapter: reads the local mdm_ tables. The only class allowed to query mdm_ tables. */
@Injectable()
export class PrismaMasterDataAdapter implements MasterDataPort {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByCode(tenantId: string, code: string): Promise<MdUser | null> {
    const row = await this.prisma.mdmUser.findUnique({ where: { tenantId_code: { tenantId, code } } });
    return row ? toUser(row) : null;
  }

  async listUsers(tenantId: string): Promise<MdUser[]> {
    const rows = await this.prisma.mdmUser.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return rows.map(toUser);
  }

  async listBranches(tenantId: string): Promise<MdBranch[]> {
    return this.prisma.mdmBranch.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, isActive: true },
    });
  }
}
