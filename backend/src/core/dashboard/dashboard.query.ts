import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CORE_ENTITY } from '../core.constants';
import { ACTIVE_ORDER, statusParts } from './dashboard.rules';

const ITEM_ORDER = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'DISCONTINUED', label: 'Discontinued' },
];
const CUSTOMER_ORDER = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PROSPECT', label: 'Prospect' },
  { key: 'BLOCKED', label: 'Blocked' },
];
const SUPPLIER_ORDER = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'BLOCKED', label: 'Blocked' },
];

/** C01 · Core home: how many of each kind there are, by status, and what changed last. */
@Injectable()
export class CoreDashboardQuery {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ctx: RequestContext) {
    const where = { tenantId: ctx.tenantId };
    const all = { _all: true } as const;
    const [items, customers, suppliers, priceLists, taxCodes, uoms, warehouses, locations, recent] = await Promise.all([
      this.prisma.mdmItem.groupBy({ by: ['status'], where, _count: all }),
      this.prisma.mdmCustomer.groupBy({ by: ['status'], where, _count: all }),
      this.prisma.mdmSupplier.groupBy({ by: ['status'], where, _count: all }),
      this.prisma.mdmPriceList.groupBy({ by: ['isActive'], where, _count: all }),
      this.prisma.mdmTaxCode.groupBy({ by: ['isActive'], where, _count: all }),
      this.prisma.mdmUom.groupBy({ by: ['isActive'], where, _count: all }),
      this.prisma.mdmWarehouse.groupBy({ by: ['isActive'], where, _count: all }),
      this.prisma.mdmLocation.count({ where }),
      this.prisma.sysActivity.findMany({
        where: { tenantId: ctx.tenantId, entityType: { in: Object.values(CORE_ENTITY) } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);
    const status = (rows: { status: string; _count: { _all: number } }[]) => rows.map((r) => ({ value: r.status, count: r._count._all }));
    const active = (rows: { isActive: boolean; _count: { _all: number } }[]) => rows.map((r) => ({ value: r.isActive, count: r._count._all }));

    return {
      cards: [
        { key: 'items', label: 'Items', to: '/core/items', ...statusParts(status(items), ITEM_ORDER) },
        { key: 'customers', label: 'Customers', to: '/core/customers', ...statusParts(status(customers), CUSTOMER_ORDER) },
        { key: 'suppliers', label: 'Suppliers', to: '/core/suppliers', ...statusParts(status(suppliers), SUPPLIER_ORDER) },
        { key: 'price-lists', label: 'Price lists', to: '/core/price-lists', ...statusParts(active(priceLists), ACTIVE_ORDER) },
        { key: 'tax-codes', label: 'Tax codes', to: '/core/tax-codes', ...statusParts(active(taxCodes), ACTIVE_ORDER) },
        { key: 'uoms', label: 'Units of measure', to: '/core/uoms', ...statusParts(active(uoms), ACTIVE_ORDER) },
        { key: 'warehouses', label: 'Warehouses', to: '/core/warehouses', ...statusParts(active(warehouses), ACTIVE_ORDER), note: `${locations} locations` },
      ],
      recent: recent.map((a) => ({
        at: a.createdAt.toISOString(),
        userName: a.userName,
        entityType: a.entityType,
        entityId: a.entityId,
        code: a.docNo,
        message: a.message,
      })),
    };
  }
}
