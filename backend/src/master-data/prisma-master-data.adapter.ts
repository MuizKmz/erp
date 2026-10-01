import { Injectable } from '@nestjs/common';
import type { MdmItem, MdmSupplier, MdmUser, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import type {
  MasterDataPort,
  MdBranch,
  MdContractPrice,
  MdItem,
  MdSupplier,
  MdTaxCode,
  MdUser,
  MdWarehouse,
  SearchOptions,
} from './master-data.port';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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

function toSupplier(row: MdmSupplier): MdSupplier {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    email: row.email,
    paymentTermDays: row.paymentTermDays,
    currency: row.currency,
    isWalkIn: row.isWalkIn,
    status: row.status,
  };
}

function toItem(row: MdmItem): MdItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    itemGroup: row.itemGroup,
    type: row.type,
    uomCode: row.purchaseUom ?? row.baseUom,
    purchaseTaxCode: row.purchaseTaxCode,
    preferredSupplierCode: row.preferredSupplierCode,
    reorderLevel: row.reorderLevel?.toFixed(4) ?? null,
    packSize: row.packSize.toFixed(4),
    isPurchasable: row.isPurchasable,
    isBuyToOrder: row.isBuyToOrder,
    status: row.status,
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

  async listSuppliers(tenantId: string, codes?: string[]): Promise<MdSupplier[]> {
    const rows = await this.prisma.mdmSupplier.findMany({
      where: { tenantId, ...(codes && { code: { in: codes } }) },
      orderBy: { code: 'asc' },
    });
    return rows.map(toSupplier);
  }

  async listPurchasableItems(tenantId: string): Promise<MdItem[]> {
    const rows = await this.prisma.mdmItem.findMany({
      where: { tenantId, isPurchasable: true, status: 'ACTIVE' },
      orderBy: { code: 'asc' },
    });
    return rows.map(toItem);
  }

  async findSupplier(tenantId: string, code: string): Promise<MdSupplier | null> {
    const row = await this.prisma.mdmSupplier.findUnique({ where: { tenantId_code: { tenantId, code } } });
    return row ? toSupplier(row) : null;
  }

  async searchSuppliers(tenantId: string, options: SearchOptions & { activeOnly?: boolean }): Promise<MdSupplier[]> {
    const q = options.q?.trim();
    const rows = await this.prisma.mdmSupplier.findMany({
      where: {
        tenantId,
        ...(options.activeOnly && { status: 'ACTIVE' }),
        ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }, { shortName: { contains: q } }] }),
      },
      orderBy: { name: 'asc' },
      take: options.limit ?? 20,
    });
    return rows.map(toSupplier);
  }

  async findItems(tenantId: string, codes: string[]): Promise<MdItem[]> {
    if (codes.length === 0) return [];
    const rows = await this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: codes } } });
    return rows.map(toItem);
  }

  async searchPurchasableItems(tenantId: string, options: SearchOptions): Promise<MdItem[]> {
    const q = options.q?.trim();
    const rows = await this.prisma.mdmItem.findMany({
      where: {
        tenantId,
        isPurchasable: true,
        status: 'ACTIVE',
        ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }] }),
      },
      orderBy: { code: 'asc' },
      take: options.limit ?? 20,
    });
    return rows.map(toItem);
  }

  async listWarehouses(tenantId: string, branchCode?: string): Promise<MdWarehouse[]> {
    return this.prisma.mdmWarehouse.findMany({
      where: { tenantId, ...(branchCode && { branchCode }) },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, branchCode: true, isActive: true },
    });
  }

  async listTaxCodes(tenantId: string): Promise<MdTaxCode[]> {
    const rows = await this.prisma.mdmTaxCode.findMany({ where: { tenantId, isActive: true }, orderBy: { code: 'asc' } });
    return rows.map((r) => ({ code: r.code, name: r.name, rate: r.rate.toFixed(4) }));
  }

  async listContractPrices(
    tenantId: string,
    filter: { supplierCode?: string; itemCodes?: string[]; onDate: string },
  ): Promise<MdContractPrice[]> {
    const on = day(filter.onDate);
    const rows = await this.prisma.mdmContractPrice.findMany({
      where: {
        tenantId,
        ...(filter.supplierCode && { supplierCode: filter.supplierCode }),
        ...(filter.itemCodes && { itemCode: { in: filter.itemCodes } }),
        validFrom: { lte: on },
        OR: [{ validTo: null }, { validTo: { gte: on } }],
      },
    });
    return rows.map((r) => ({
      itemCode: r.itemCode,
      supplierCode: r.supplierCode,
      unitPrice: r.unitPrice.toFixed(4),
      validFrom: isoDate(r.validFrom),
      validTo: r.validTo ? isoDate(r.validTo) : null,
    }));
  }
}
