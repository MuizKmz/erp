import { Injectable } from '@nestjs/common';
import type { MdmCustomer, MdmItem, MdmSupplier, MdmUser, Prisma } from '@prisma/client';
import { ClockService } from '../platform/clock/clock.service';
import { PrismaService } from '../platform/prisma/prisma.service';
import { latestValidByKey } from './master-data.rules';
import type {
  MasterDataPort,
  MdBranch,
  MdContractPrice,
  MdCustomer,
  MdItem,
  MdPrice,
  MdPriceList,
  MdSupplier,
  MdLocation,
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
    jobTitle: row.jobTitle,
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
    isSellable: row.isSellable,
    salesUomCode: row.salesUom ?? row.baseUom,
    salesTaxCode: row.salesTaxCode,
    barcode: row.barcode,
    standardCost: row.standardCost?.toFixed(4) ?? null,
    status: row.status,
  };
}

function toCustomer(row: MdmCustomer): MdCustomer {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tin: row.tin,
    billingAddress: row.billingAddress,
    deliveryAddress: row.deliveryAddress,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    category: row.category,
    area: row.area,
    branchCode: row.branchCode,
    defaultAgentCode: row.defaultAgentCode,
    creditTermDays: row.creditTermDays,
    creditLimit: row.creditLimit?.toFixed(2) ?? null,
    overdueLimit: row.overdueLimit?.toFixed(2) ?? null,
    creditScope: row.creditScope,
    priceListCode: row.priceListCode,
    taxMode: row.taxMode === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE',
    isCash: row.isCash,
    status: row.status,
  };
}

/** Phase 1 adapter: reads the local mdm_ tables, which Core writes. Outside Core, the only class allowed to query them. */
@Injectable()
export class PrismaMasterDataAdapter implements MasterDataPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

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

  async listLocations(tenantId: string, warehouseCode?: string): Promise<MdLocation[]> {
    return this.prisma.mdmLocation.findMany({
      where: { tenantId, ...(warehouseCode && { warehouseCode }) },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, warehouseCode: true, isActive: true },
    });
  }

  /** The rate in force today: tax codes keep one row per rate period (SRS BR-TAX-006). */
  async listTaxCodes(tenantId: string): Promise<MdTaxCode[]> {
    const today = this.clock.todayDate();
    const rows = await this.prisma.mdmTaxCode.findMany({
      where: { tenantId, isActive: true, validFrom: { lte: today } },
      orderBy: [{ code: 'asc' }, { validFrom: 'asc' }],
    });
    return latestValidByKey(rows, (r) => r.code, today).map((r) => ({ code: r.code, name: r.name, rate: r.rate.toFixed(4) }));
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

  // ── Sales ──

  async findCustomer(tenantId: string, code: string): Promise<MdCustomer | null> {
    const row = await this.prisma.mdmCustomer.findUnique({ where: { tenantId_code: { tenantId, code } } });
    return row ? toCustomer(row) : null;
  }

  async listCustomers(tenantId: string, codes?: string[]): Promise<MdCustomer[]> {
    const rows = await this.prisma.mdmCustomer.findMany({ where: { tenantId, ...(codes && { code: { in: codes } }) }, orderBy: { name: 'asc' } });
    return rows.map(toCustomer);
  }

  async searchCustomers(tenantId: string, options: SearchOptions & { activeOnly?: boolean }): Promise<MdCustomer[]> {
    const q = options.q?.trim();
    const rows = await this.prisma.mdmCustomer.findMany({
      where: {
        tenantId,
        ...(options.activeOnly && { status: 'ACTIVE' as const }),
        ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }] }),
      },
      orderBy: { name: 'asc' },
      take: options.limit ?? 20,
    });
    return rows.map(toCustomer);
  }

  async listPriceLists(tenantId: string): Promise<MdPriceList[]> {
    return this.prisma.mdmPriceList.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, currency: true, taxInclusive: true },
    });
  }

  async listPrices(tenantId: string, filter: { priceListCode: string; itemCodes?: string[]; onDate: string }): Promise<MdPrice[]> {
    const on = day(filter.onDate);
    const list = await this.prisma.mdmPriceList.findFirst({
      where: { tenantId, code: filter.priceListCode, isActive: true, validFrom: { lte: on }, OR: [{ validTo: null }, { validTo: { gte: on } }] },
    });
    if (!list) return [];
    // Dated prices (SRS BR-PRC-003/004): per item and unit, the newest row that has started by the date.
    const rows = await this.prisma.mdmPriceListItem.findMany({
      where: { tenantId, priceListCode: list.code, validFrom: { lte: on }, ...(filter.itemCodes && { itemCode: { in: filter.itemCodes } }) },
      orderBy: [{ validFrom: 'asc' }, { itemCode: 'asc' }, { uomCode: 'asc' }],
    });
    return latestValidByKey(rows, (r) => `${r.itemCode}|${r.uomCode}`, on).map((r) => ({
      priceListCode: r.priceListCode,
      itemCode: r.itemCode,
      uomCode: r.uomCode,
      unitPrice: r.unitPrice.toFixed(4),
    }));
  }

  async searchSellableItems(tenantId: string, options: SearchOptions & { itemGroup?: string; sellableOnly?: boolean }): Promise<MdItem[]> {
    const q = options.q?.trim();
    const rows = await this.prisma.mdmItem.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        ...(options.sellableOnly !== false && { isSellable: true }),
        ...(options.itemGroup && { itemGroup: options.itemGroup }),
        ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }, { barcode: q }] }),
      },
      orderBy: { code: 'asc' },
      take: options.limit ?? 20,
    });
    return rows.map(toItem);
  }
}
