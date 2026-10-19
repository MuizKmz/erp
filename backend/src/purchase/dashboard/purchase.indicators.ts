import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { monthRange } from '../../platform/clock/clock.rules';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { statusKey } from '../../platform/http/list';
import { AGING_BUCKETS, agingBucket, lastMonths, monthOf } from '../../platform/indicators/indicator.rules';
import { IndicatorRegistry } from '../../platform/indicators/indicator.registry';
import type { IndicatorBoard, IndicatorResult } from '../../platform/indicators/indicator.types';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { DemandService } from '../demand/demand.service';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { buySoonNote, pickBuySoon, supplierLine } from './dashboard.rules';
import { DashboardService } from './dashboard.service';

type Money = ReturnType<typeof dec>;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const TOP = 5;

/** Statuses that count as committed spend: released to the supplier. */
const COMMITTED = ['RELEASED', 'PARTIAL', 'DONE'] as const;
const BY_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE'] as const;
const STATUS_LABEL: Record<(typeof BY_STATUS)[number], string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  RELEASED: 'Released',
  PARTIAL: 'Partially received',
  DONE: 'Done',
};
const APPROVAL_CHIP: Record<string, string> = { [PUR_ENTITY.ORDER]: 'Purchase order', [PUR_ENTITY.INVOICE]: 'Invoice', [PUR_ENTITY.DEBIT_NOTE]: 'Debit note' };

/**
 * The Purchase home's charts (SRS RPT-035 to RPT-037), registered with the platform. Every one reads through the
 * order and invoice headers, inside the person's request, so the data scopes apply (RPT-036).
 */
@Injectable()
export class PurchaseIndicators implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly dashboard: DashboardService,
    private readonly demand: DemandService,
    private readonly registry: IndicatorRegistry,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.board());
  }

  private board(): IndicatorBoard {
    const view = P.VIEW;
    return {
      key: 'purchase',
      defaults: { cols: 2, cards: ['purchase.recent_orders', 'purchase.buy_soon', 'purchase.committed_by_supplier'] },
      indicators: [
        {
          key: 'purchase.recent_orders', title: 'Recent purchase orders', description: 'The latest seven purchase orders, what is received and where each stands.',
          kind: 'table', wide: true, permission: view, link: { label: 'View all', to: '/purchase/orders' }, empty: 'No purchase orders yet.',
          compute: (ctx) => this.recentOrders(ctx),
        },
        {
          key: 'purchase.buy_soon', title: 'Buy soon · below reorder level', description: 'Items under their reorder level or short for a sales order.',
          kind: 'list', permission: view, link: { label: 'Demand list', to: '/purchase/demand' }, empty: 'Nothing needs buying right now.',
          compute: (ctx) => this.buySoon(ctx),
        },
        {
          key: 'purchase.committed_by_supplier', title: 'Committed spend by supplier', description: 'Purchase orders released this month, by supplier.',
          kind: 'bars', permission: view, empty: 'No orders released this month yet.',
          compute: (ctx) => this.committedBySupplier(ctx),
        },
        {
          key: 'purchase.waiting_for_me', title: 'Waiting for your approval', description: 'Purchase orders, supplier invoices and debit notes waiting for you.',
          kind: 'list', permission: view, link: { label: 'Open inbox', to: '/purchase/approvals' }, empty: 'Nothing is waiting for you.',
          compute: (ctx) => this.waitingForMe(ctx),
        },
        {
          key: 'purchase.by_month', title: 'Spend by month', description: 'Released purchase orders in each of the last six months.',
          kind: 'columns', permission: view, link: { label: 'Purchase orders', to: '/purchase/orders' }, empty: 'No orders released in the last six months.',
          compute: (ctx) => this.byMonth(ctx),
        },
        {
          key: 'purchase.top_items', title: 'Top items bought', description: 'The five items with the most spend on orders released this month.',
          kind: 'bars', permission: view, empty: 'No orders released this month yet.',
          compute: (ctx) => this.topItems(ctx),
        },
        {
          key: 'purchase.orders_by_status', title: 'Purchase orders by status', description: 'How many orders are draft, waiting for approval, released, partly received or done.',
          kind: 'bars', permission: view, link: { label: 'Purchase orders', to: '/purchase/orders' }, empty: 'No purchase orders yet.',
          compute: (ctx) => this.ordersByStatus(ctx),
        },
        {
          key: 'purchase.payables_aging', title: 'What we owe suppliers, by age', description: 'Approved supplier invoices not yet paid, by how far past their due date they are.',
          kind: 'bars', permission: view, link: { label: 'Supplier invoices', to: '/purchase/invoices' }, empty: 'No approved invoices waiting for payment.',
          compute: (ctx) => this.payablesAging(ctx),
        },
      ],
    };
  }

  /**
   * Released orders dated this month, as PurHome counts committed spend: orders brought over from the old system are
   * left out, like Sales' charts of the month (the six-month chart shows them, and says so).
   */
  private committedThisMonth(ctx: RequestContext) {
    const month = monthRange(this.clock.today());
    return { month, where: { tenantId: ctx.tenantId, isMigrated: false, status: { in: [...COMMITTED] }, docDate: { gte: month.from, lte: month.to } } };
  }

  private async recentOrders(ctx: RequestContext): Promise<IndicatorResult> {
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where: { tenantId: ctx.tenantId, status: { not: 'CANCELLED' } },
      include: { lines: { select: { orderedQty: true, receivedQty: true } } },
      orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      take: 7,
    });
    return {
      data: {
        kind: 'table',
        columns: [
          { key: 'no', label: 'PO no' },
          { key: 'supplier', label: 'Supplier' },
          { key: 'total', label: 'Total (RM)', num: true },
          { key: 'received', label: 'Received' },
          { key: 'status', label: 'Status' },
        ],
        rows: orders.map((o) => ({
          id: o.id,
          cells: {
            no: { text: o.docNo, strong: true, ...(!o.isMigrated && { to: `/purchase/orders/${o.id}` }) },
            supplier: { text: supplierLine(o) },
            total: { money: toMoney(o.total) },
            received: {
              progress: { done: toQty(o.lines.reduce((s, l) => s.add(l.receivedQty), dec(0))), of: toQty(o.lines.reduce((s, l) => s.add(l.orderedQty), dec(0))) },
            },
            status: { chip: { status: o.status } },
          },
        })),
      },
    };
  }

  private async buySoon(ctx: RequestContext): Promise<IndicatorResult> {
    const lines = await this.demand.compute(ctx.tenantId);
    return {
      data: {
        kind: 'list',
        items: pickBuySoon(lines.filter((d) => d.status === 'NEEDS_BUYING')).map((d) => ({
          id: d.itemCode,
          title: `${d.itemCode} · ${d.itemName}`,
          aside: buySoonNote({ onHand: d.onHand, reorderLevel: d.reorderLevel, reason: d.reason, salesOrders: d.salesOrders }),
        })),
      },
    };
  }

  private async committedBySupplier(ctx: RequestContext): Promise<IndicatorResult> {
    const { month, where } = this.committedThisMonth(ctx);
    const [released, pending] = await Promise.all([
      this.prisma.purPurchaseOrder.findMany({ where, select: { supplierCode: true, total: true } }),
      this.prisma.purPurchaseOrder.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING_APPROVAL' }, select: { docNo: true, total: true } }),
    ]);
    const bySupplier = new Map<string, Money>();
    for (const o of released) bySupplier.set(o.supplierCode, (bySupplier.get(o.supplierCode) ?? dec(0)).add(o.total));
    const suppliers = await this.masterData.listSuppliers(ctx.tenantId, [...bySupplier.keys()]);
    const pendingNote = pending.length
      ? ` ${pending.map((p) => `${p.docNo} (${toRmText(p.total)})`).join(' and ')} ${pending.length === 1 ? 'counts' : 'count'} once approved.`
      : '';
    return {
      month: month.month,
      data: {
        kind: 'bars',
        unit: 'money',
        rows: [...bySupplier]
          .sort(([, a], [, b]) => b.cmp(a))
          .map(([code, amount]) => {
            const s = suppliers.find((x) => x.code === code);
            return { key: code, label: s?.shortName ?? s?.name ?? code, value: toMoney(amount) };
          }),
      },
      note: `Released orders only.${pendingNote}`,
    };
  }

  private async waitingForMe(ctx: RequestContext): Promise<IndicatorResult> {
    const waiting = await this.dashboard.waitingForMe(ctx);
    return {
      data: {
        kind: 'list',
        items: waiting.map((w) => ({
          id: w.id,
          title: w.title,
          sub: w.reason.split(' · ')[0] ?? w.reason,
          chip: { status: w.entityType, label: APPROVAL_CHIP[w.entityType] ?? 'Document', group: 'pending' as const },
          to: `/purchase/approvals?id=${w.id}`,
        })),
      },
    };
  }

  private async byMonth(ctx: RequestContext): Promise<IndicatorResult> {
    const today = this.clock.today();
    const months = lastMonths(today, 6);
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where: { tenantId: ctx.tenantId, status: { in: [...COMMITTED] }, docDate: { gte: new Date(`${months[0]}-01T00:00:00.000Z`), lte: monthRange(today).to } },
      select: { docDate: true, total: true, isMigrated: true },
    });
    const sums = new Map(months.map((m) => [m, dec(0)]));
    for (const o of orders) sums.set(monthOf(o.docDate), (sums.get(monthOf(o.docDate)) ?? dec(0)).add(o.total));
    return {
      data: { kind: 'columns', unit: 'money', points: months.map((m) => ({ month: m, value: toMoney(sums.get(m)) })) },
      note: orders.some((o) => o.isMigrated) ? 'Released orders only, including those brought over from the old system.' : 'Released orders only.',
    };
  }

  private async topItems(ctx: RequestContext): Promise<IndicatorResult> {
    const { month, where } = this.committedThisMonth(ctx);
    // Through the order headers, so the data scopes apply to the lines too.
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where,
      select: { lines: { select: { itemCode: true, itemName: true, uomCode: true, orderedQty: true, amount: true, taxAmount: true } } },
    });
    const byItem = new Map<string, { label: string; value: Money; qty: Money; uoms: Set<string> }>();
    for (const l of orders.flatMap((o) => o.lines)) {
      const row = byItem.get(l.itemCode) ?? { label: `${l.itemCode} · ${l.itemName}`, value: dec(0), qty: dec(0), uoms: new Set<string>() };
      row.value = row.value.add(l.amount).add(l.taxAmount);
      row.qty = row.qty.add(l.orderedQty);
      row.uoms.add(l.uomCode);
      byItem.set(l.itemCode, row);
    }
    return {
      month: month.month,
      data: {
        kind: 'bars',
        unit: 'money',
        rows: [...byItem]
          .sort(([, a], [, b]) => b.value.cmp(a.value))
          .slice(0, TOP)
          // Quantities in different units are not added together.
          .map(([key, r]) => ({ key, label: r.label, value: toMoney(r.value), sub: r.uoms.size === 1 ? `${r.qty.toString()} ${[...r.uoms][0]}` : `in ${r.uoms.size} units` })),
      },
    };
  }

  private async ordersByStatus(ctx: RequestContext): Promise<IndicatorResult> {
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where: { tenantId: ctx.tenantId, status: { in: [...BY_STATUS] } },
      select: { status: true, total: true },
    });
    const rows = BY_STATUS.map((status) => {
      const these = orders.filter((o) => o.status === status);
      return {
        key: status,
        label: STATUS_LABEL[status],
        value: String(these.length),
        sub: toRmText(these.reduce((s, o) => s.add(o.total), dec(0))),
        to: `/purchase/orders?status=${statusKey(status)}`,
      };
    });
    return { data: { kind: 'bars', unit: 'count', rows: orders.length ? rows : [] } };
  }

  private async payablesAging(ctx: RequestContext): Promise<IndicatorResult> {
    const today = this.clock.today();
    const invoices = await this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, status: 'APPROVED', paidAt: null }, select: { dueDate: true, total: true } });
    const sums = new Map(AGING_BUCKETS.map((b) => [b.key, { value: dec(0), count: 0 }]));
    for (const i of invoices) {
      const bucket = sums.get(agingBucket(iso(i.dueDate), today))!;
      bucket.value = bucket.value.add(i.total);
      bucket.count += 1;
    }
    const total = invoices.reduce((s, i) => s.add(i.total), dec(0));
    return {
      data: {
        kind: 'bars',
        unit: 'money',
        rows: invoices.length
          ? AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: toMoney(sums.get(b.key)!.value), sub: plural(sums.get(b.key)!.count, 'invoice', 'invoices'), tone: b.tone }))
          : [],
      },
      ...(invoices.length > 0 && { note: `${toRmText(total)} on ${plural(invoices.length, 'approved invoice', 'approved invoices')}, before debit notes and returns. Payments come with Finance.` }),
    };
  }
}
