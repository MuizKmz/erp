import { Injectable } from '@nestjs/common';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import type { Tx } from '../../platform/prisma/prisma.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import {
  daysChangeError,
  LIST_WORDS,
  lookAlikeWarning,
  referenceDeleteRefusal,
  renameError,
  usedByText,
  type ReferenceList,
  type ReferenceUse,
} from './reference.rules';

/** The columns every reference table has; credit terms add days. */
export interface ReferenceRow {
  id: string;
  name: string;
  days?: number;
  isActive: boolean;
  version: number;
}

/** The part of a Prisma delegate the reference lists use. The four tables share their shape. */
interface ReferenceDelegate {
  findMany(args: { where: object; orderBy?: object }): Promise<ReferenceRow[]>;
  findFirst(args: { where: object }): Promise<ReferenceRow | null>;
  create(args: { data: object }): Promise<ReferenceRow>;
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  deleteMany(args: { where: object }): Promise<{ count: number }>;
}

/** The table behind a list, in or outside a transaction. */
export function referenceTable(db: PrismaService | Tx, list: ReferenceList): ReferenceDelegate {
  const table = { 'item-groups': db.mdmItemGroup, 'customer-categories': db.mdmCustomerCategory, areas: db.mdmArea, 'credit-terms': db.mdmCreditTerm }[list];
  return table as unknown as ReferenceDelegate;
}

/** C12 · Reference lists: the four lists with who uses each entry (counted from Core's own records). */
@Injectable()
export class ReferenceQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionRegistry,
  ) {}

  async lists(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const where = { tenantId };
    const [groups, categories, areas, terms, items, customers, suppliers] = await Promise.all([
      this.prisma.mdmItemGroup.findMany({ where, orderBy: { name: 'asc' } }),
      this.prisma.mdmCustomerCategory.findMany({ where, orderBy: { name: 'asc' } }),
      this.prisma.mdmArea.findMany({ where, orderBy: { name: 'asc' } }),
      this.prisma.mdmCreditTerm.findMany({ where, orderBy: { days: 'asc' } }),
      this.prisma.mdmItem.findMany({ where, select: { code: true, itemGroup: true }, orderBy: { code: 'asc' } }),
      this.prisma.mdmCustomer.findMany({ where, select: { category: true, area: true, creditTermDays: true } }),
      this.prisma.mdmSupplier.findMany({ where, select: { paymentTermDays: true } }),
    ]);
    const same = (a: string | null, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();
    const useOf = (list: ReferenceList, row: ReferenceRow): ReferenceUse => {
      if (list === 'item-groups') return { items: items.filter((i) => same(i.itemGroup, row.name)).length };
      if (list === 'customer-categories') return { customers: customers.filter((c) => same(c.category, row.name)).length };
      if (list === 'areas') return { customers: customers.filter((c) => same(c.area, row.name)).length };
      return { customers: customers.filter((c) => c.creditTermDays === row.days).length, suppliers: suppliers.filter((s) => s.paymentTermDays === row.days).length };
    };
    const shape = (list: ReferenceList, rows: ReferenceRow[]) =>
      rows.map((row) => {
        const use = useOf(list, row);
        const refusals = {
          rename: renameError(list, row.name, use),
          days: list === 'credit-terms' ? daysChangeError(row.name, use) : null,
          delete: referenceDeleteRefusal(row.name, use),
        };
        return {
          id: row.id,
          name: row.name,
          ...(list === 'credit-terms' && { days: row.days }),
          isActive: row.isActive,
          version: row.version,
          usedBy: usedByText(use),
          refusals: Object.fromEntries(Object.entries(refusals).filter(([, v]) => v)),
        };
      });
    return {
      lists: {
        'item-groups': shape('item-groups', groups),
        'customer-categories': shape('customer-categories', categories),
        areas: shape('areas', areas),
        'credit-terms': shape('credit-terms', terms),
      },
      lookAlike: lookAlikeWarning(groups.map((g) => ({ name: g.name, items: items.filter((i) => same(i.itemGroup, g.name)).map((i) => i.code) }))),
      canEdit: this.permissions.has(ctx.user.roles, P.REFERENCE_EDIT),
    };
  }

  async load(ctx: RequestContext, list: ReferenceList, id: string): Promise<ReferenceRow> {
    const row = await referenceTable(this.prisma, list).findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) throw new NotFoundError(LIST_WORDS[list].one.replace(/^./, (c) => c.toUpperCase()));
    return row;
  }

  /** Who uses one entry now, for the checks on save and delete. */
  async useOf(tenantId: string, list: ReferenceList, row: Pick<ReferenceRow, 'name' | 'days'>): Promise<ReferenceUse> {
    if (list === 'item-groups') return { items: await this.prisma.mdmItem.count({ where: { tenantId, itemGroup: row.name } }) };
    if (list === 'customer-categories') return { customers: await this.prisma.mdmCustomer.count({ where: { tenantId, category: row.name } }) };
    if (list === 'areas') return { customers: await this.prisma.mdmCustomer.count({ where: { tenantId, area: row.name } }) };
    const [customers, suppliers] = await Promise.all([
      this.prisma.mdmCustomer.count({ where: { tenantId, creditTermDays: row.days } }),
      this.prisma.mdmSupplier.count({ where: { tenantId, paymentTermDays: row.days } }),
    ]);
    return { customers, suppliers };
  }
}
