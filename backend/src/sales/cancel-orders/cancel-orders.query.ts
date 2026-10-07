import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalCancelOrder, SalCancelOrderLine, SalSalesOrder, SalSalesOrderLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toMoney, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { openToDeliver, waitingState } from '../deliveries/delivery.rules';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { DepositsService } from '../shared/deposits.service';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { allowedCancelActions, CANCEL_REASONS, CO_STATUSES, type CoStatus } from './cancel-order.rules';
import type { CancelListQueryDto } from './dto/cancel-order.dto';

export type CancelWithLines = SalCancelOrder & { lines: SalCancelOrderLine[] };
type OrderWithLines = SalSalesOrder & { lines: SalSalesOrderLine[] };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
const qtyText = (v: Prisma.Decimal) => toQty(v).replace(/\.0+$/, '');

/** Reading cancel orders: the list and open balances (S13), one cancellation (S14). */
@Injectable()
export class CancelOrdersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly linked: SalesLinkedDocsService,
    private readonly deposits: DepositsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async load(tenantId: string, id: string): Promise<CancelWithLines> {
    const row = await this.prisma.salCancelOrder.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Cancel order');
    return row;
  }

  actions(ctx: RequestContext, c: SalCancelOrder) {
    const has = (p: string) => this.permissions.has(ctx.user.roles, p);
    return allowedCancelActions({ status: c.status as CoStatus, isMigrated: c.isMigrated, canEdit: has(P.CANCEL_ORDER_EDIT), canRelease: has(P.CANCEL_ORDER_RELEASE) });
  }

  /** Value of a cancelled quantity at the order's price, discount and tax. */
  value(l: SalSalesOrderLine, qty: Prisma.Decimal) {
    const amount = roundMoney(qty.mul(l.unitPrice).mul(dec(100).sub(l.discountPct)).div(100));
    return { amount, taxAmount: roundMoney(amount.mul(l.taxRate)) };
  }

  /** Quantities other draft cancellations already hold, per order line. */
  async heldByDrafts(tenantId: string, soLineIds: string[], excludeId?: string) {
    const rows = await this.prisma.salCancelOrderLine.groupBy({
      by: ['soLineId'],
      where: { tenantId, soLineId: { in: soLineIds }, cancelOrder: { status: 'DRAFT', ...(excludeId && { id: { not: excludeId } }) } },
      _sum: { cancelQty: true },
    });
    return new Map(rows.map((r) => [r.soLineId!, r._sum.cancelQty ?? dec(0)]));
  }

  // ── List (S13) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: CancelListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalCancelOrderWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(query.order?.trim() && { salesOrderNo: { contains: query.order.trim() } }),
      ...(query.reason && { reason: query.reason }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { salesOrderNo: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, CO_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped, all] = await Promise.all([
      this.prisma.salCancelOrder.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salCancelOrder.count({ where }),
      this.prisma.salCancelOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.salCancelOrder.findMany({ where, select: { total: true, docDate: true }, orderBy: { docDate: 'asc' } }),
    ]);
    const response = toListResponse(
      rows.map((c) => ({
        id: c.id,
        docNo: c.docNo,
        docDate: iso(c.docDate),
        salesOrderId: c.salesOrderId,
        salesOrderNo: c.salesOrderNo,
        customerName: c.customerName,
        summary: c.summary,
        total: toMoney(c.total),
        reason: c.reason,
        status: c.status,
        isMigrated: c.isMigrated,
        version: c.version,
      })),
      total,
      query,
      buildStatusCounts(grouped, CO_STATUSES),
    );
    return { ...response, totals: { value: toMoney(sum(all.map((a) => a.total))), since: iso(all[0]?.docDate ?? null) }, reasons: CANCEL_REASONS };
  }

  /**
   * Released orders with something still to deliver that no draft cancellation covers (S13 bottom list, S14 picker),
   * with what the open balance waits for.
   */
  async openOrders(ctx: RequestContext) {
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, isMigrated: false, status: { in: ['RELEASED', 'PARTIAL'] } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ promisedDate: 'asc' }, { docNo: 'asc' }],
    });
    const lineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
    const codes = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemCode)))];
    const [held, items, stock, unpaid] = await Promise.all([
      this.heldByDrafts(ctx.tenantId, lineIds),
      this.masterData.findItems(ctx.tenantId, codes),
      this.stock.listStock(ctx.tenantId, codes),
      this.deposits.unpaidForOrders(ctx.tenantId, orders.map((o) => o.id)),
    ]);
    return {
      items: orders
        .map((o) => {
          const open = o.lines.map((l) => ({ l, balance: openToDeliver(l).sub(held.get(l.id) ?? dec(0)) })).filter((x) => x.balance.gt(0));
          if (!open.length) return null;
          const proforma = unpaid.get(o.id) ?? null;
          const states = open.map(({ l, balance }) => {
            const onHand = sum(stock.filter((s) => s.itemCode === l.itemCode && s.warehouseCode === o.warehouseCode).map((s) => dec(s.onHand)));
            return { l, state: waitingState({ isBuyToOrder: l.isBuyToOrder, isStock: items.find((i) => i.code === l.itemCode)?.type === 'STOCK', balance, onHand, unpaidProformaNo: proforma?.proforma.docNo ?? null }) };
          });
          const first = states[0]!;
          const waitingFor =
            first.state === 'DEPOSIT' ? `Deposit · ${proforma!.proforma.docNo}`
            : first.state === 'PURCHASE' ? `Buy to order${first.l.purchaseOrderNo ? ` · ${first.l.purchaseOrderNo}` : ''}`
            : first.state === 'NO_STOCK' ? 'Stock'
            : 'Delivery';
          const units = [...new Set(open.map((x) => x.l.uomCode))];
          return {
            id: o.id,
            docNo: o.docNo,
            customerName: o.customerName,
            open: `${qtyText(sum(open.map((x) => x.balance)))} ${units.join('/')}`,
            promisedDate: iso(o.promisedDate ?? o.deliveryWantedBy),
            waitingFor,
            linkedToPo: open.some((x) => x.l.isBuyToOrder && x.l.purchaseOrderNo),
          };
        })
        .filter((o) => o !== null),
    };
  }

  /** Lines of an order as they can be cancelled now (S14 when an order is picked). */
  async orderLines(ctx: RequestContext, orderId: string, excludeId?: string) {
    const order = await this.prisma.salSalesOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!order) throw new NotFoundError('Sales order');
    return this.orderView(ctx, order, excludeId);
  }

  private async orderView(ctx: RequestContext, order: OrderWithLines, excludeId?: string) {
    const held = await this.heldByDrafts(ctx.tenantId, order.lines.map((l) => l.id), excludeId);
    const invoiced = await this.prisma.salInvoice.aggregate({ where: { tenantId: ctx.tenantId, salesOrderId: order.id, status: 'RELEASED' }, _sum: { total: true } });
    return {
      id: order.id,
      no: order.docNo,
      status: order.status,
      customer: { code: order.customerCode, name: order.customerName },
      contactName: order.contactName,
      total: toMoney(order.total),
      invoiced: toMoney(invoiced._sum.total ?? 0),
      lines: order.lines.map((l) => {
        const balance = openToDeliver(l).sub(held.get(l.id) ?? dec(0));
        return {
          soLineId: l.id,
          lineNo: l.lineNo,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          unitPrice: l.unitPrice.toString(),
          discountPct: l.discountPct.toString(),
          taxRate: l.taxRate.toString(),
          orderedQty: toQty(l.orderedQty),
          deliveredQty: toQty(l.deliveredQty),
          invoicedQty: toQty(l.invoicedQty),
          cancelledQty: toQty(l.cancelledQty),
          balanceQty: toQty(balance.gt(0) ? balance : dec(0)),
          isBuyToOrder: l.isBuyToOrder,
          purchaseOrderNo: l.purchaseOrderNo,
        };
      }),
    };
  }

  // ── One cancellation (S14) ────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const c = await this.load(ctx.tenantId, id);
    const order = c.salesOrderId ? await this.prisma.salSalesOrder.findFirst({ where: { id: c.salesOrderId }, include: { lines: { orderBy: { lineNo: 'asc' } } } }) : null;
    const [activity, links, recent, orderView] = await Promise.all([
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.CANCEL_ORDER, c.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.CANCEL_ORDER, c.id),
      this.prisma.salCancelOrder.findMany({ where: { tenantId: ctx.tenantId, isMigrated: false }, include: { lines: true }, orderBy: { docDate: 'desc' }, take: 5 }),
      order && !c.isMigrated ? this.orderView(ctx, order, c.id) : null,
    ]);
    const draft = c.status === 'DRAFT';
    return {
      id: c.id,
      docNo: c.docNo,
      docDate: iso(c.docDate),
      status: c.status,
      isMigrated: c.isMigrated,
      version: c.version,
      reason: c.reason,
      askedBy: c.askedBy,
      customerRef: c.customerRef,
      note: c.note,
      summary: c.summary,
      total: toMoney(c.total),
      order: orderView ?? { id: c.salesOrderId, no: c.salesOrderNo, status: null, customer: { code: c.customerCode, name: c.customerName }, contactName: null, total: '0.00', invoiced: '0.00', lines: [] },
      lines: c.lines.map((l) => {
        const live = draft ? orderView?.lines.find((x) => x.soLineId === l.soLineId) : null;
        return {
          id: l.id,
          lineNo: l.lineNo,
          soLineId: l.soLineId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          orderedQty: toQty(l.orderedQty),
          deliveredQty: live ? live.deliveredQty : toQty(l.deliveredQty),
          invoicedQty: live ? live.invoicedQty : toQty(l.invoicedQty),
          balanceQty: live ? live.balanceQty : toQty(l.balanceQty),
          cancelQty: toQty(l.cancelQty),
          amount: toMoney(l.amount),
          taxAmount: toMoney(l.taxAmount),
          linkedPo: live?.isBuyToOrder && live.purchaseOrderNo ? live.purchaseOrderNo : null,
        };
      }),
      recent: recent.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        docDate: iso(r.docDate),
        salesOrderNo: r.salesOrderNo,
        customerName: r.customerName,
        qty: qtyText(sum(r.lines.map((l) => l.cancelQty))),
        reason: r.reason,
        status: r.status,
      })),
      reasons: CANCEL_REASONS,
      releasedAt: c.releasedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, c),
    };
  }
}
