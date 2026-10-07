import { Injectable } from '@nestjs/common';
import type { Prisma, SalSalesOrder, SalSalesOrderLine } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { paymentState, type InvStatus } from '../invoices/invoice.rules';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesLinkedDocsService, type LinkedDoc } from '../shared/linked-docs.service';
import { SAL_ENTITY, SAL_EVENT } from '../shared/sales.constants';
import { invoiceBalance } from '../shared/totals.rules';
import { statusLabel, type SoStatus } from './order.rules';

const FINANCE_EVENTS: string[] = [SAL_EVENT.INVOICE_RELEASED, SAL_EVENT.RETURN_RELEASED, SAL_EVENT.DEBIT_NOTE_RELEASED, SAL_EVENT.CASH_SALE_RELEASED];
const EINVOICE_EVENTS: string[] = [SAL_EVENT.INVOICE_RELEASED, SAL_EVENT.RETURN_RELEASED, SAL_EVENT.DEBIT_NOTE_RELEASED];
const INVENTORY_EVENTS: string[] = [SAL_EVENT.SHIPMENT_REQUESTED, SAL_EVENT.RETURN_RELEASED, SAL_EVENT.ORDER_BALANCE_CANCELLED, SAL_EVENT.CASH_SALE_RELEASED];

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
const plain = (v: Prisma.Decimal) => toQty(v).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
type Group = LinkedDoc['group'];

/** One row of "Quantity through the chain". Text cells so "5 returned" / "55 billed" fit. */
export interface FlowQtyRow {
  type: string;
  id: string | null;
  docNo: string;
  date: string | null;
  fromPrevious: string;
  movedToNext: string;
  stillOpen: string;
  label: string;
  group: Group;
}

const SO_GROUP: Record<SoStatus, NonNullable<Group>> = { DRAFT: 'draft', PENDING_APPROVAL: 'pending', RELEASED: 'released', PARTIAL: 'partial', DONE: 'done', CANCELLED: 'cancelled' };

/** S03 · Document flow of one sales order: the chain, quantities per document, audit trail, what is still open. */
@Injectable()
export class SalesOrderFlowQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linked: SalesLinkedDocsService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
  ) {}

  async flow(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const so = await this.prisma.salSalesOrder.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!so) throw new NotFoundError('Sales order');

    const docs = await this.linked.forDocument(tenantId, SAL_ENTITY.ORDER, so.id);
    const first = so.lines[0];
    const ordered = sum(so.lines.map((l) => l.orderedQty));
    const delivered = sum(so.lines.map((l) => l.deliveredQty));
    const open = sum(so.lines.map((l) => { const o = l.orderedQty.sub(l.deliveredQty).sub(l.cancelledQty); return o.gt(0) ? o : dec(0); }));
    const status = so.status as SoStatus;
    const chain = [
      ...docs.filter((d) => d.upstream).map((d) => ({ ...d, current: false })),
      { type: SAL_ENTITY.ORDER, id: so.id, docNo: so.docNo, summary: '', status: so.status, label: statusLabel(status, so.balanceCancelled), group: so.balanceCancelled ? 'cancelled' as const : SO_GROUP[status], upstream: false, current: true },
      ...docs.filter((d) => !d.upstream).map((d) => ({ ...d, current: false })),
    ];
    const ids = chain.map((d) => d.id).filter((x): x is string => Boolean(x));
    const [quantity, activities, queued] = await Promise.all([
      first ? this.quantityRows(tenantId, so, first) : Promise.resolve(null),
      Promise.all(chain.filter((d) => d.id).map(async (d) => (await this.activity.listFor(tenantId, d.type, d.id!)).map((a) => ({ ...a, docNo: d.docNo })))),
      this.prisma.sysOutbox.findMany({ where: { tenantId, aggregateId: { in: ids }, status: { not: 'DISPATCHED' } }, select: { name: true } }),
    ]);

    return {
      order: { id: so.id, docNo: so.docNo, status: so.status, customerName: so.customerName, ordered: toQty(ordered), delivered: toQty(delivered), open: toQty(open), uomCode: first?.uomCode ?? '' },
      chain,
      quantity: first && quantity ? { itemCode: first.itemCode, itemName: first.itemName, more: so.lines.length - 1, rows: quantity } : null,
      audit: activities.flat().sort((a, b) => a.at.localeCompare(b.at)),
      stillOpen: ['RELEASED', 'PARTIAL'].includes(so.status) && open.gt(0)
        ? {
            qty: toQty(open),
            uomCode: first?.uomCode ?? '',
            wantedBy: iso(so.deliveryWantedBy),
            delivered: delivered.gt(0),
            canDeliver: this.permissions.has(ctx.user.roles, P.DELIVERY_EDIT),
            canCancel: this.permissions.has(ctx.user.roles, P.CANCEL_ORDER_EDIT),
          }
        : null,
      waiting: {
        finance: queued.filter((q) => FINANCE_EVENTS.includes(q.name)).length,
        eInvoice: queued.filter((q) => EINVOICE_EVENTS.includes(q.name)).length,
        inventory: queued.filter((q) => INVENTORY_EVENTS.includes(q.name)).length,
      },
    };
  }

  /** Quantity of the order's first line as it moved quotation → order → deliveries → invoices → returns / cancels. */
  private async quantityRows(tenantId: string, so: SalSalesOrder, line: SalSalesOrderLine): Promise<FlowQtyRow[]> {
    const [quotation, doLines, invLines, cancelLines] = await Promise.all([
      so.quotationId ? this.prisma.salQuotation.findFirst({ where: { id: so.quotationId, tenantId }, include: { lines: { where: { itemCode: line.itemCode } } } }) : null,
      this.prisma.salDeliveryLine.findMany({ where: { tenantId, soLineId: line.id, delivery: { status: 'CONFIRMED' } }, include: { delivery: { select: { id: true, docNo: true, docDate: true, isMigrated: true } } } }),
      this.prisma.salInvoiceLine.findMany({ where: { tenantId, soLineId: line.id, invoice: { status: 'RELEASED' } }, include: { invoice: true } }),
      this.prisma.salCancelOrderLine.findMany({ where: { tenantId, soLineId: line.id, cancelOrder: { status: 'RELEASED' } }, include: { cancelOrder: { select: { id: true, docNo: true, docDate: true } } } }),
    ]);
    const returnLines = invLines.length
      ? await this.prisma.salReturnLine.findMany({ where: { tenantId, invoiceLineId: { in: invLines.map((l) => l.id) }, salesReturn: { status: 'RELEASED' } }, include: { salesReturn: { select: { id: true, docNo: true, docDate: true } } } })
      : [];
    const rows: FlowQtyRow[] = [];

    if (quotation) {
      const qty = sum(quotation.lines.map((l) => l.qty));
      const ordered = quotation.status === 'ORDERED';
      rows.push({
        type: SAL_ENTITY.QUOTATION, id: quotation.id, docNo: quotation.docNo, date: iso(quotation.docDate),
        fromPrevious: '—', movedToNext: plain(ordered ? qty : dec(0)), stillOpen: plain(ordered ? dec(0) : qty),
        label: ordered ? 'Done' : quotation.status === 'LOST' ? 'Lost' : 'Released', group: ordered ? 'done' : quotation.status === 'LOST' ? 'cancelled' : 'released',
      });
    }

    const soOpen = line.orderedQty.sub(line.deliveredQty).sub(line.cancelledQty);
    rows.push({
      type: SAL_ENTITY.ORDER, id: so.id, docNo: so.docNo, date: iso(so.docDate),
      fromPrevious: plain(line.orderedQty), movedToNext: plain(line.deliveredQty), stillOpen: plain(soOpen.gt(0) ? soOpen : dec(0)),
      label: statusLabel(so.status as SoStatus, so.balanceCancelled), group: so.balanceCancelled ? 'cancelled' : SO_GROUP[so.status as SoStatus],
    });

    for (const d of doLines.sort((a, b) => a.delivery.docNo.localeCompare(b.delivery.docNo))) {
      const left = d.qty.sub(d.invoicedQty);
      rows.push({
        type: SAL_ENTITY.DELIVERY, id: d.delivery.isMigrated ? null : d.delivery.id, docNo: d.delivery.docNo, date: iso(d.delivery.docDate),
        fromPrevious: plain(d.qty), movedToNext: plain(d.invoicedQty), stillOpen: plain(left.gt(0) ? left : dec(0)),
        label: left.lte(0) ? 'Invoiced' : 'Delivered', group: left.lte(0) ? 'done' : 'released',
      });
    }

    const today = this.clock.today();
    const paid = invLines.length
      ? await this.prisma.finReceiptStub.groupBy({ by: ['appliesToNo'], where: { tenantId, appliesToType: 'INVOICE', appliesToNo: { in: invLines.map((l) => l.invoice.docNo) } }, _sum: { amount: true } })
      : [];
    for (const l of invLines.sort((a, b) => a.invoice.docNo.localeCompare(b.invoice.docNo))) {
      const inv = l.invoice;
      const balance = invoiceBalance({ total: inv.total, debited: inv.debitedAmount, credited: inv.creditedAmount, deposit: inv.depositApplied, paid: paid.find((p) => p.appliesToNo === inv.docNo)?._sum.amount ?? 0 });
      const pay = paymentState({ status: inv.status as InvStatus, balance, credited: 0, dueDate: iso(inv.dueDate), today });
      rows.push({
        type: SAL_ENTITY.INVOICE, id: inv.isMigrated ? null : inv.id, docNo: inv.docNo, date: iso(inv.docDate),
        fromPrevious: plain(l.qty),
        movedToNext: l.returnedQty.gt(0) ? `${plain(l.returnedQty)} returned` : '—',
        stillOpen: `${plain(l.qty.sub(l.returnedQty))} billed`,
        label: pay.key === 'OVERDUE' ? 'Overdue' : pay.label, group: pay.key === 'PAID' ? 'done' : pay.key === 'OVERDUE' ? 'cancelled' : 'pending',
      });
    }

    for (const r of returnLines.sort((a, b) => a.salesReturn.docNo.localeCompare(b.salesReturn.docNo))) {
      rows.push({
        type: SAL_ENTITY.RETURN, id: r.salesReturn.id, docNo: r.salesReturn.docNo, date: iso(r.salesReturn.docDate),
        fromPrevious: plain(r.qty), movedToNext: '—', stillOpen: '0', label: 'Released', group: 'released',
      });
    }

    for (const c of cancelLines) {
      rows.push({
        type: SAL_ENTITY.CANCEL_ORDER, id: c.cancelOrder.id, docNo: c.cancelOrder.docNo, date: iso(c.cancelOrder.docDate),
        fromPrevious: plain(c.cancelQty), movedToNext: '—', stillOpen: '0', label: 'Cancelled', group: 'cancelled',
      });
    }
    return rows;
  }
}
