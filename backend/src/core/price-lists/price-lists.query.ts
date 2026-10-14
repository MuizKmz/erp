import { Injectable } from '@nestjs/common';
import type { MdmPriceList, MdmPriceListItem, Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { ListQueryDto } from '../../platform/http/list-query.dto';
import { buildStatusCounts, pageArgs, statusFromKey, toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { deleteRefusal } from '../usage/usage.rules';
import {
  deactivateRefusal,
  isHistory,
  pricedCount,
  priceStates,
  STATUS_LABEL,
  statusActions,
  statusOf,
  taxText,
  type PriceListAction,
  type PriceListStatus,
} from './price-lists.rules';

const STATUSES: readonly PriceListStatus[] = ['ACTIVE', 'INACTIVE'];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** C08 price lists and C09 price list (CLAUDE.md → Phase 3). Reads mdm_ tables; Sales documents come from the record-usage check. */
@Injectable()
export class PriceListsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
  ) {}

  async list(ctx: RequestContext, query: ListQueryDto) {
    const tenantId = ctx.tenantId;
    const q = query.q?.trim();
    const base: Prisma.MdmPriceListWhereInput = { tenantId, ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }] }) };
    const status = statusFromKey(query.status, STATUSES);
    const where = { ...base, ...(status && { isActive: status === 'ACTIVE' }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.mdmPriceList.findMany({ where, orderBy: { code: 'asc' }, ...pageArgs(query) }),
      this.prisma.mdmPriceList.count({ where }),
      this.prisma.mdmPriceList.groupBy({ by: ['isActive'], where: base, _count: { _all: true } }),
    ]);
    const codes = rows.map((r) => r.code);
    const [prices, customers] = await Promise.all([
      this.prisma.mdmPriceListItem.findMany({ where: { tenantId, priceListCode: { in: codes } }, select: { priceListCode: true, itemCode: true, uomCode: true } }),
      this.prisma.mdmCustomer.groupBy({ by: ['priceListCode'], where: { tenantId, priceListCode: { in: codes } }, _count: { _all: true } }),
    ]);
    const usedBy = new Map(customers.map((c) => [c.priceListCode, c._count._all]));
    const items = rows.map((l) => {
      const n = usedBy.get(l.code) ?? 0;
      return {
        ...this.fields(l),
        prices: pricedCount(prices.filter((p) => p.priceListCode === l.code)),
        taxText: taxText(l.taxInclusive),
        customers: n,
        usedBy: n === 0 ? 'No customers' : `${n} customer${n === 1 ? '' : 's'}`,
      };
    });
    const counts = buildStatusCounts(
      grouped.map((g) => ({ status: statusOf(g.isActive), _count: g._count })),
      STATUSES,
    );
    return toListResponse(items, total, query, counts);
  }

  async detail(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const l = await this.load(ctx, id);
    const today = this.clock.today();
    const [prices, customers, usage, activity] = await Promise.all([
      this.prices(tenantId, l.code),
      this.customers(tenantId, l.code),
      this.usage.check({ tenantId, kind: 'PRICE_LIST', code: l.code }),
      this.activity.listFor(tenantId, CORE_ENTITY.PRICE_LIST, l.id),
    ]);
    const items = await this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: [...new Set(prices.map((p) => p.itemCode))] } }, select: { id: true, code: true, name: true } });
    const item = new Map(items.map((i) => [i.code, i]));
    const rows = prices.map((p) => ({ itemCode: p.itemCode, uomCode: p.uomCode, validFrom: isoDay(p.validFrom) }));
    const states = priceStates(rows, today);

    const canEdit = this.permissions.has(ctx.user.roles, P.PRICE_LIST_EDIT);
    const deactivate = deactivateRefusal(l.code, customers.map((c) => c.code));
    const remove = deleteRefusal('PRICE_LIST', l.code, usage, [{ label: 'customers', count: customers.length }]);
    const allowedActions: PriceListAction[] = [];
    const refusals: Partial<Record<PriceListAction, string>> = {};
    if (canEdit) {
      allowedActions.push('edit');
      for (const action of statusActions(l.isActive)) {
        if (action === 'deactivate' && deactivate) refusals.deactivate = deactivate;
        else allowedActions.push(action);
      }
      if (remove) refusals.delete = remove;
      else allowedActions.push('delete');
    }
    return {
      ...this.fields(l),
      priceCount: pricedCount(rows),
      prices: prices.map((p, i) => ({
        itemId: item.get(p.itemCode)?.id ?? null,
        itemCode: p.itemCode,
        itemName: item.get(p.itemCode)?.name ?? p.itemCode,
        uomCode: p.uomCode,
        unitPrice: p.unitPrice.toFixed(4),
        validFrom: rows[i]!.validFrom,
        state: states[i]!,
        locked: isHistory(rows[i]!, today),
      })),
      customers,
      documents: usage.documents,
      activity,
      allowedActions,
      refusals,
    };
  }

  async load(ctx: RequestContext, id: string): Promise<MdmPriceList> {
    const l = await this.prisma.mdmPriceList.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!l) throw new NotFoundError('Price list');
    return l;
  }

  prices(tenantId: string, priceListCode: string): Promise<MdmPriceListItem[]> {
    return this.prisma.mdmPriceListItem.findMany({ where: { tenantId, priceListCode }, orderBy: [{ itemCode: 'asc' }, { uomCode: 'asc' }, { validFrom: 'asc' }] });
  }

  /** The customers on this price list, by code (C09 "Used by"). */
  customers(tenantId: string, priceListCode: string) {
    return this.prisma.mdmCustomer.findMany({ where: { tenantId, priceListCode }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
  }

  private fields(l: MdmPriceList) {
    const status = statusOf(l.isActive);
    return {
      id: l.id,
      code: l.code,
      name: l.name,
      currency: l.currency,
      taxInclusive: l.taxInclusive,
      validFrom: isoDay(l.validFrom),
      validTo: l.validTo ? isoDay(l.validTo) : null,
      isActive: l.isActive,
      status,
      statusLabel: STATUS_LABEL[status],
      version: l.version,
    };
  }
}
