import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { buyToOrderStatus, purchaseReady } from '../buy-to-order/buy-to-order.rules';
import { deliveryValue, dueWithin, waitingState } from '../deliveries/delivery.rules';
import { DepositsService } from '../shared/deposits.service';
import { byReason, isLate, OPEN_SHOW, openQuantities, openReason, reasonLabel } from './open-orders.rules';
import { customersInGroup, iso, ReportFilters } from './report-filters';

const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/**
 * S05 · Open orders (SRS RPT-024): every sales order not finished yet, as it stands today, line by line: what is
 * left to deliver and to invoice, its value, and what it waits for. Uses the delivery waiting list's rules (S15).
 */
@Injectable()
export class OpenOrdersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly filters: ReportFilters,
    private readonly deposits: DepositsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async report(ctx: RequestContext, filter: { branch?: string; agent?: string; group?: string; show?: string }) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const { options, customers } = await this.filters.load(tenantId);
    const inGroup = customersInGroup(customers, filter.group);
    const statuses = OPEN_SHOW[filter.show ?? 'all'] ?? OPEN_SHOW.all!;

    const orders = (await this.prisma.salSalesOrder.findMany({
      where: { tenantId, revision: 0, status: { in: statuses }, ...(filter.branch && { branchCode: filter.branch }), ...(filter.agent && { agentCode: filter.agent }) },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }],
    })).filter((o) => !inGroup || inGroup.has(o.customerCode));
    const codes = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemCode)))];
    const [items, stock, proformas, cancelling] = await Promise.all([
      this.masterData.findItems(tenantId, codes),
      this.stock.listStock(tenantId, codes),
      this.deposits.unpaidForOrders(tenantId, orders.map((o) => o.id)),
      // Draft cancel orders, through their headers: a balance they take is being cancelled.
      this.prisma.salCancelOrder.findMany({
        where: { tenantId, status: 'DRAFT', salesOrderId: { in: orders.map((o) => o.id) } },
        select: { docNo: true, lines: { select: { soLineId: true, cancelQty: true } } },
      }),
    ]);
    const cancelBy = new Map<string, { qty: Prisma.Decimal; docNo: string }>();
    for (const c of cancelling) for (const l of c.lines) if (l.soLineId) cancelBy.set(l.soLineId, { qty: (cancelBy.get(l.soLineId)?.qty ?? dec(0)).add(l.cancelQty), docNo: c.docNo });

    const rows = orders
      .map((o) => {
        const proforma = proformas.get(o.id) ?? null;
        const lines = o.lines
          .map((l) => ({ l, ...openQuantities(l) }))
          .filter((x) => x.open.gt(0) || x.toInvoice.gt(0))
          .map(({ l, open, toInvoice }) => {
            const onHand = sum(stock.filter((s) => s.itemCode === l.itemCode && s.warehouseCode === o.warehouseCode).map((s) => dec(s.onHand)));
            const cancel = cancelBy.get(l.id) ?? null;
            const waiting = waitingState({
              isBuyToOrder: l.isBuyToOrder, isStock: items.find((i) => i.code === l.itemCode)?.type === 'STOCK', balance: open, onHand,
              unpaidProformaNo: proforma?.proforma.docNo ?? null, purchaseReady: purchaseReady(l),
            });
            const reason = openReason({ orderStatus: o.status, openQty: open, cancellingQty: cancel?.qty ?? 0, waiting });
            const openValue = deliveryValue([{ qty: open, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate }]);
            return {
              lineNo: l.lineNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode,
              ordered: toQty(l.orderedQty), delivered: toQty(l.deliveredQty), invoiced: toQty(l.invoicedQty), cancelled: toQty(l.cancelledQty),
              open: toQty(open), toInvoice: toQty(toInvoice), openValue: toMoney(openValue),
              reason, reasonLabel: reasonLabel(reason), detail: this.detail(reason, { onHand, proformaNo: proforma?.proforma.docNo ?? null, cancelNo: cancel?.docNo ?? null, purchase: buyToOrderStatus(l)?.label ?? null, uomCode: l.uomCode }),
              _open: open, _value: openValue,
            };
          });
        const open = sum(lines.map((l) => l._open));
        const wantedBy = iso(o.deliveryWantedBy);
        const promisedDate = iso(o.promisedDate);
        return {
          id: o.id, docNo: o.docNo, docDate: iso(o.docDate), status: o.status, balanceCancelled: o.balanceCancelled, isMigrated: o.isMigrated,
          customerCode: o.customerCode, customerName: o.customerName, agentName: o.agentName, branchCode: o.branchCode,
          wantedBy, promisedDate, late: isLate({ promisedDate, wantedBy }, open, today),
          dueSoon: (o.status === 'RELEASED' || o.status === 'PARTIAL') && open.gt(0) && dueWithin(wantedBy, today, 14),
          total: o.total, openValue: sum(lines.map((l) => l._value)), units: open, lines,
        };
      })
      .filter((o) => o.lines.length > 0);

    const customersOpen = new Map<string, { customerCode: string; customerName: string; orders: number; openValue: Prisma.Decimal }>();
    for (const o of rows) {
      const c = customersOpen.get(o.customerCode) ?? { customerCode: o.customerCode, customerName: o.customerName, orders: 0, openValue: dec(0) };
      c.orders += 1;
      c.openValue = c.openValue.add(o.openValue);
      customersOpen.set(o.customerCode, c);
    }
    const byStatus = (s: string) => rows.filter((o) => o.status === s);
    const approval = byStatus('PENDING_APPROVAL');
    const dueSoon = rows.filter((o) => o.dueSoon);
    const allLines = rows.flatMap((o) => o.lines);
    return {
      today,
      kpis: {
        open: { orders: rows.length, ordered: toMoney(sum(rows.map((o) => o.total))), released: byStatus('RELEASED').length, partial: byStatus('PARTIAL').length, approval: approval.length, draft: byStatus('DRAFT').length },
        toDeliver: { amount: toMoney(sum(rows.map((o) => o.openValue))), units: toQty(sum(rows.map((o) => o.units))), toInvoice: toQty(sum(allLines.map((l) => dec(l.toInvoice)))) },
        dueSoon: { orders: dueSoon.length, orderNos: dueSoon.map((o) => o.docNo), late: rows.filter((o) => o.late).map((o) => o.docNo) },
        approval: { orders: approval.length, amount: toMoney(sum(approval.map((o) => o.total))) },
      },
      byReason: byReason(allLines.map((l) => ({ reason: l.reason, openValue: l._value }))).map((r) => ({ ...r, amount: toMoney(r.amount) })),
      byCustomer: [...customersOpen.values()]
        .sort((a, b) => b.openValue.comparedTo(a.openValue) || a.customerName.localeCompare(b.customerName))
        .map((c) => ({ ...c, openValue: toMoney(c.openValue) })),
      orders: rows.map(({ lines, total, openValue, units: _u, ...o }) => ({
        ...o, total: toMoney(total), openValue: toMoney(openValue),
        lines: lines.map(({ _open, _value, ...l }) => l),
      })),
      totals: { ordered: toMoney(sum(rows.map((o) => o.total))), openValue: toMoney(sum(rows.map((o) => o.openValue))) },
      inventoryConnected: this.stock.connected,
      filters: options,
    };
  }

  /** The second line of the reason chip: "0 in stock", "PO-0003 · waiting for goods", "PF-0004 not paid yet" … */
  private detail(reason: string, x: { onHand: Prisma.Decimal; proformaNo: string | null; cancelNo: string | null; purchase: string | null; uomCode: string }): string | null {
    if (reason === 'NO_STOCK') return `${x.onHand.toString()} in stock`;
    if (reason === 'READY') return `${x.onHand.toString()} ${x.uomCode} in stock`;
    if (reason === 'DEPOSIT') return x.proformaNo ? `${x.proformaNo} not paid yet` : null;
    if (reason === 'CANCELLING') return x.cancelNo ? `${x.cancelNo} (draft)` : null;
    if (reason === 'PURCHASE') return x.purchase;
    return null;
  }
}
