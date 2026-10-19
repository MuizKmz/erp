import { Injectable, OnModuleInit } from '@nestjs/common';
import { monthRange } from '../../platform/clock/clock.rules';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty, toRmText } from '../../platform/http/decimal';
import { statusKey } from '../../platform/http/list';
import { AGING_BUCKETS, agingBucket, lastMonths, monthOf } from '../../platform/indicators/indicator.rules';
import { IndicatorRegistry } from '../../platform/indicators/indicator.registry';
import type { IndicatorBoard, IndicatorResult } from '../../platform/indicators/indicator.types';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { ReceivablesService } from '../shared/receivables.service';
import { approvalKind, KIND_CHIP, lineValue, shortReason } from './dashboard.rules';
import { OPEN_ORDER_STATUSES, SalesDashboardService } from './dashboard.service';

type Money = ReturnType<typeof dec>;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const STATUS_LABEL: Record<(typeof OPEN_ORDER_STATUSES)[number], string> = { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', RELEASED: 'Released', PARTIAL: 'Partial' };
const TOP = 5;

/** Adds a value under a key, keeping the first label seen. */
function addTo(map: Map<string, { label: string; value: Money; count: number }>, key: string, label: string, value: Money) {
  const row = map.get(key) ?? { label, value: dec(0), count: 0 };
  row.value = row.value.add(value);
  row.count += 1;
  map.set(key, row);
}

/**
 * The Sales home's charts (SRS RPT-035 to RPT-037), registered with the platform. Every one reads through the
 * order and invoice headers, inside the person's request, so the data scopes apply (RPT-036): an agent's top
 * customers are their own.
 */
@Injectable()
export class SalesIndicators implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly dashboard: SalesDashboardService,
    private readonly receivables: ReceivablesService,
    private readonly registry: IndicatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.board());
  }

  private board(): IndicatorBoard {
    const view = P.VIEW;
    const toReport = { label: 'Sales by customer', to: '/sales/reports/by-customer' };
    return {
      key: 'sales',
      defaults: { cols: 2, cards: ['sales.recent_orders', 'sales.waiting_for_me', 'sales.ordered_by_agent'] },
      indicators: [
        {
          key: 'sales.recent_orders', title: 'Recent sales orders', description: 'The latest seven sales orders, what is delivered and where each stands.',
          kind: 'table', wide: true, permission: view, link: { label: 'View all', to: '/sales/orders' }, empty: 'No sales orders yet.',
          compute: (ctx) => this.recentOrders(ctx),
        },
        {
          key: 'sales.waiting_for_me', title: 'Waiting for your approval', description: 'Orders, invoices and quotations waiting for you: credit, price and discount.',
          kind: 'list', permission: view, link: { label: 'Open inbox', to: '/sales/approvals' }, empty: 'Nothing is waiting for you.',
          compute: (ctx) => this.waitingForMe(ctx),
        },
        {
          key: 'sales.ordered_by_agent', title: 'Ordered by agent', description: 'What each sales agent has ordered this month.',
          kind: 'bars', permission: view, empty: 'No sales orders this month yet.',
          compute: (ctx) => this.orderedByAgent(ctx),
        },
        {
          key: 'sales.by_month', title: 'Sales by month', description: 'Value ordered in each of the last six months.',
          kind: 'columns', permission: view, link: toReport, empty: 'No sales orders in the last six months.',
          compute: (ctx) => this.byMonth(ctx),
        },
        {
          key: 'sales.top_customers', title: 'Top customers', description: 'The five customers who ordered the most this month.',
          kind: 'bars', permission: view, link: toReport, empty: 'No sales orders this month yet.',
          compute: (ctx) => this.topCustomers(ctx),
        },
        {
          key: 'sales.top_items', title: 'Top items', description: 'The five items ordered for the most this month, with the quantity.',
          kind: 'bars', permission: view, empty: 'No sales orders this month yet.',
          compute: (ctx) => this.topItems(ctx),
        },
        {
          key: 'sales.open_by_status', title: 'Open sales orders by status', description: 'How many open orders are draft, waiting for approval, released or partly delivered.',
          kind: 'bars', permission: view, link: { label: 'Sales orders', to: '/sales/orders' }, empty: 'No open sales orders.',
          compute: (ctx) => this.openByStatus(ctx),
        },
        {
          key: 'sales.receivables_aging', title: 'What customers owe, by age', description: 'Unpaid invoice balances by how far past their due date they are.',
          kind: 'bars', permission: view, link: { label: 'Invoices', to: '/sales/invoices' }, empty: 'No unpaid invoices.',
          compute: (ctx) => this.receivablesAging(ctx),
        },
      ],
    };
  }

  /** This month's orders that count as ordered: drafts and orders waiting for approval included, cancelled and migrated left out (as S05). */
  private thisMonth(ctx: RequestContext) {
    const month = monthRange(this.clock.today());
    return { month, where: { tenantId: ctx.tenantId, revision: 0, isMigrated: false, status: { not: 'CANCELLED' as const }, docDate: { gte: month.from, lte: month.to } } };
  }

  private async recentOrders(ctx: RequestContext): Promise<IndicatorResult> {
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, revision: 0 },
      include: { lines: { select: { orderedQty: true, deliveredQty: true } } },
      orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      take: 7,
    });
    return {
      data: {
        kind: 'table',
        columns: [
          { key: 'no', label: 'SO no' },
          { key: 'customer', label: 'Customer' },
          { key: 'total', label: 'Total (RM)', num: true },
          { key: 'delivered', label: 'Delivered' },
          { key: 'status', label: 'Status' },
        ],
        rows: orders.map((o) => ({
          id: o.id,
          cells: {
            no: { text: o.docNo, strong: true, ...(!o.isMigrated && { to: `/sales/orders/${o.id}` }) },
            customer: { text: o.customerName },
            total: { money: toMoney(o.total) },
            delivered: {
              progress: { done: toQty(o.lines.reduce((s, l) => s.add(l.deliveredQty), dec(0))), of: toQty(o.lines.reduce((s, l) => s.add(l.orderedQty), dec(0))) },
            },
            status: { chip: { status: o.status, ...(o.balanceCancelled && { label: 'Balance cancelled' }) } },
          },
        })),
      },
    };
  }

  private async waitingForMe(ctx: RequestContext): Promise<IndicatorResult> {
    const waiting = await this.dashboard.waitingForMe(ctx);
    return {
      data: {
        kind: 'list',
        items: waiting.map((w) => {
          const kind = approvalKind(w.entityType, w.steps.find((s) => s.stepNo === w.currentStep)?.approverRole ?? null);
          return {
            id: w.id,
            title: `${w.docNo} · ${w.title.split(' · ')[1] ?? ''}`,
            sub: shortReason(kind, w.reason),
            chip: { status: kind, ...KIND_CHIP[kind] },
            to: `/sales/approvals?id=${w.id}`,
          };
        }),
      },
    };
  }

  private async orderedByAgent(ctx: RequestContext): Promise<IndicatorResult> {
    const { month, where } = this.thisMonth(ctx);
    const orders = await this.prisma.salSalesOrder.findMany({ where, select: { agentCode: true, agentName: true, total: true } });
    const byAgent = new Map<string, { label: string; value: Money; count: number }>();
    for (const o of orders) addTo(byAgent, o.agentCode, o.agentName, o.total);
    return {
      month: month.month,
      data: {
        kind: 'bars',
        unit: 'money',
        rows: [...byAgent].sort(([, a], [, b]) => b.value.cmp(a.value)).map(([key, r]) => ({ key, label: r.label, value: toMoney(r.value) })),
      },
    };
  }

  private async byMonth(ctx: RequestContext): Promise<IndicatorResult> {
    const today = this.clock.today();
    const months = lastMonths(today, 6);
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, revision: 0, status: { not: 'CANCELLED' }, docDate: { gte: new Date(`${months[0]}-01T00:00:00.000Z`), lte: monthRange(today).to } },
      select: { docDate: true, total: true, isMigrated: true },
    });
    const sums = new Map(months.map((m) => [m, dec(0)]));
    for (const o of orders) sums.set(monthOf(o.docDate), (sums.get(monthOf(o.docDate)) ?? dec(0)).add(o.total));
    const migrated = orders.some((o) => o.isMigrated);
    return {
      data: { kind: 'columns', unit: 'money', points: months.map((m) => ({ month: m, value: toMoney(sums.get(m)) })) },
      ...(migrated && { note: 'Includes orders brought over from the old system. Cancelled orders are left out.' }),
    };
  }

  private async topCustomers(ctx: RequestContext): Promise<IndicatorResult> {
    const { month, where } = this.thisMonth(ctx);
    const orders = await this.prisma.salSalesOrder.findMany({ where, select: { customerCode: true, customerName: true, total: true } });
    const byCustomer = new Map<string, { label: string; value: Money; count: number }>();
    for (const o of orders) addTo(byCustomer, o.customerCode, o.customerName, o.total);
    return {
      month: month.month,
      data: {
        kind: 'bars',
        unit: 'money',
        rows: [...byCustomer]
          .sort(([, a], [, b]) => b.value.cmp(a.value))
          .slice(0, TOP)
          .map(([key, r]) => ({ key, label: r.label, value: toMoney(r.value), sub: plural(r.count, 'order', 'orders') })),
      },
      note: 'Drafts and orders waiting for approval count as ordered.',
    };
  }

  private async topItems(ctx: RequestContext): Promise<IndicatorResult> {
    const { month, where } = this.thisMonth(ctx);
    // Through the order headers, so the data scopes apply to the lines too.
    const orders = await this.prisma.salSalesOrder.findMany({
      where,
      select: { lines: { select: { itemCode: true, itemName: true, uomCode: true, orderedQty: true, unitPrice: true, discountPct: true, taxRate: true } } },
    });
    const byItem = new Map<string, { label: string; value: Money; qty: Money; uoms: Set<string> }>();
    for (const l of orders.flatMap((o) => o.lines)) {
      const row = byItem.get(l.itemCode) ?? { label: `${l.itemCode} · ${l.itemName}`, value: dec(0), qty: dec(0), uoms: new Set<string>() };
      row.value = row.value.add(lineValue(l, l.orderedQty));
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

  private async openByStatus(ctx: RequestContext): Promise<IndicatorResult> {
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, revision: 0, status: { in: [...OPEN_ORDER_STATUSES] } },
      select: { status: true, total: true },
    });
    const rows = OPEN_ORDER_STATUSES.map((status) => {
      const these = orders.filter((o) => o.status === status);
      return {
        key: status,
        label: STATUS_LABEL[status],
        value: String(these.length),
        sub: toRmText(these.reduce((s, o) => s.add(o.total), dec(0))),
        to: `/sales/orders?status=${statusKey(status)}`,
      };
    });
    return { data: { kind: 'bars', unit: 'count', rows: orders.length ? rows : [] } };
  }

  private async receivablesAging(ctx: RequestContext): Promise<IndicatorResult> {
    const today = this.clock.today();
    const open = await this.receivables.openInvoices(ctx.tenantId, today);
    const sums = new Map(AGING_BUCKETS.map((b) => [b.key, { value: dec(0), count: 0 }]));
    for (const x of open) {
      const bucket = sums.get(agingBucket(iso(x.invoice.dueDate), today))!;
      bucket.value = bucket.value.add(x.balance);
      bucket.count += 1;
    }
    const total = open.reduce((s, x) => s.add(x.balance), dec(0));
    return {
      data: {
        kind: 'bars',
        unit: 'money',
        rows: open.length
          ? AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: toMoney(sums.get(b.key)!.value), sub: plural(sums.get(b.key)!.count, 'invoice', 'invoices'), tone: b.tone }))
          : [],
      },
      ...(open.length > 0 && { note: `Balance due ${toRmText(total)} on ${plural(open.length, 'invoice', 'invoices')}, after deposits, credits and payments.` }),
    };
  }
}
