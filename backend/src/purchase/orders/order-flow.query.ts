import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { INVOICE_APPROVED_EVENT } from '../invoices/invoices.query';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { GOODS_RECEIVED_EVENT } from '../receipts/receipts.query';
import { RETURN_RELEASED_EVENT } from '../returns/returns.query';
import { LinkedDocsService, type LinkedDoc } from '../shared/linked-docs.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { plainQty } from '../shared/text.rules';

const FINANCE_EVENTS = [INVOICE_APPROVED_EVENT, RETURN_RELEASED_EVENT, 'purchase.debit_note.released'];
const INVENTORY_EVENTS = [GOODS_RECEIVED_EVENT, RETURN_RELEASED_EVENT];

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** One row of "Quantity through the chain". Text cells so "10 returned" / "85 kept" fit. */
export interface FlowQtyRow {
  type: string;
  id: string | null;
  docNo: string;
  date: string | null;
  fromPrevious: string;
  movedToNext: string;
  stillOpen: string;
  label: string;
  group: LinkedDoc['group'];
}

/** P03 · Document flow of one purchase order: the chain, quantities per document, audit trail, what is still open. */
@Injectable()
export class OrderFlowQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linked: LinkedDocsService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
  ) {}

  async flow(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const po = await this.prisma.purPurchaseOrder.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!po) throw new NotFoundError('Purchase order');

    const docs = await this.linked.forDocument(tenantId, PUR_ENTITY.ORDER, po.id);
    const poLabel = {
      DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'],
      PARTIAL: ['Partial', 'partial'], DONE: ['Done', 'done'], CANCELLED: ['Cancelled', 'cancelled'],
    } as const;
    const first = po.lines[0];
    const ordered = sum(po.lines.map((l) => l.orderedQty));
    const received = sum(po.lines.map((l) => l.receivedQty));
    const cancelled = sum(po.lines.map((l) => l.cancelledQty));
    const open = ordered.sub(received).sub(cancelled);

    const upstream = docs.filter((d) => d.upstream);
    const downstream = docs.filter((d) => !d.upstream);
    const chain = [
      ...upstream,
      { type: PUR_ENTITY.ORDER, id: po.id, docNo: po.docNo, summary: '', status: po.status, label: poLabel[po.status][0], group: poLabel[po.status][1], upstream: false, current: true },
      ...downstream,
    ].map((d) => ({ ...d, current: 'current' in d ? d.current : false }));

    const ids = chain.map((d) => d.id).filter((x): x is string => Boolean(x));
    const [quantity, activities, queued] = await Promise.all([
      first ? this.quantityRows(tenantId, po, first.id) : Promise.resolve(null),
      Promise.all(chain.filter((d) => d.id).map(async (d) => (await this.activity.listFor(tenantId, d.type, d.id!)).map((a) => ({ ...a, docNo: d.docNo })))),
      this.prisma.sysOutbox.findMany({ where: { tenantId, aggregateId: { in: ids }, status: { not: 'DISPATCHED' } }, select: { name: true } }),
    ]);

    const openStatuses = ['RELEASED', 'PARTIAL'];
    return {
      po: {
        id: po.id,
        docNo: po.docNo,
        status: po.status,
        supplierName: po.supplierName,
        ordered: toQty(ordered),
        open: toQty(open),
        uomCode: first?.uomCode ?? '',
      },
      chain,
      quantity: first && quantity ? { itemCode: first.itemCode, itemName: first.itemName, more: po.lines.length - 1, rows: quantity } : null,
      audit: activities.flat().sort((a, b) => a.at.localeCompare(b.at)),
      stillOpen: openStatuses.includes(po.status) && open.gt(0)
        ? {
            qty: toQty(open),
            uomCode: first?.uomCode ?? '',
            promisedDate: isoDate(po.promisedDate ?? po.expectedDate),
            canReceive: this.permissions.has(ctx.user.roles, P.RECEIPT_EDIT),
            canCancel: this.permissions.has(ctx.user.roles, P.CANCEL_ORDER_EDIT),
          }
        : null,
      waiting: {
        finance: queued.filter((q) => FINANCE_EVENTS.includes(q.name)).length,
        inventory: queued.filter((q) => INVENTORY_EVENTS.includes(q.name)).length,
      },
    };
  }

  /** Quantity of the PO's first line as it moved request → PO → receipts → invoices → returns / cancels. */
  private async quantityRows(tenantId: string, po: { id: string; docNo: string; docDate: Date; status: string; requestId: string | null; lines: { id: string; orderedQty: Prisma.Decimal; receivedQty: Prisma.Decimal; cancelledQty: Prisma.Decimal; itemCode: string }[] }, poLineId: string): Promise<FlowQtyRow[]> {
    const line = po.lines.find((l) => l.id === poLineId)!;
    const [request, grnLines, invoiceLines, returnLines, cancelLines] = await Promise.all([
      po.requestId ? this.prisma.purRequest.findFirst({ where: { id: po.requestId, tenantId }, include: { lines: { where: { itemCode: line.itemCode } } } }) : null,
      this.prisma.purGoodsReceiptLine.findMany({ where: { tenantId, poLineId, grn: { status: 'CONFIRMED' } }, include: { grn: { select: { id: true, docNo: true, docDate: true } } } }),
      this.prisma.purInvoiceLine.findMany({ where: { tenantId, poLineId, invoice: { status: { notIn: ['DRAFT', 'REJECTED'] } } }, include: { invoice: { select: { id: true, docNo: true, docDate: true, status: true } } } }),
      this.prisma.purReturnLine.findMany({ where: { tenantId, poLineId, purReturn: { status: { not: 'DRAFT' } } }, include: { purReturn: { select: { id: true, docNo: true, docDate: true, status: true } } } }),
      this.prisma.purCancelOrderLine.findMany({ where: { tenantId, poLineId, cancelOrder: { status: 'RELEASED' } }, include: { cancelOrder: { select: { id: true, docNo: true, docDate: true } } } }),
    ]);
    const rows: FlowQtyRow[] = [];
    const returnedTotal = sum(returnLines.map((r) => r.qty));

    if (request) {
      const qty = sum(request.lines.map((l) => l.qty));
      const moved = request.status === 'CONVERTED' ? qty : dec(0);
      rows.push({
        type: PUR_ENTITY.REQUEST, id: request.id, docNo: request.docNo, date: isoDate(request.docDate),
        fromPrevious: '—', movedToNext: plainQty(moved), stillOpen: plainQty(qty.sub(moved)),
        label: request.status === 'CONVERTED' ? 'Done' : request.status === 'REJECTED' ? 'Rejected' : 'Submitted',
        group: request.status === 'CONVERTED' ? 'done' : request.status === 'REJECTED' ? 'cancelled' : 'released',
      });
    }

    const poOpen = line.orderedQty.sub(line.receivedQty).sub(line.cancelledQty);
    const poMap: Record<string, [string, FlowQtyRow['group']]> = {
      DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'],
      PARTIAL: ['Partial', 'partial'], DONE: ['Done', 'done'], CANCELLED: ['Cancelled', 'cancelled'],
    };
    rows.push({
      type: PUR_ENTITY.ORDER, id: po.id, docNo: po.docNo, date: isoDate(po.docDate),
      fromPrevious: plainQty(line.orderedQty), movedToNext: plainQty(line.receivedQty), stillOpen: plainQty(poOpen),
      label: poMap[po.status]![0], group: poMap[po.status]![1],
    });

    for (const g of grnLines.sort((a, b) => a.grn.docNo.localeCompare(b.grn.docNo))) {
      const billed = sum(invoiceLines.filter((i) => i.grnLineId === g.id).map((i) => i.qty));
      const left = g.receivedQty.sub(billed);
      rows.push({
        type: PUR_ENTITY.RECEIPT, id: g.grn.id, docNo: g.grn.docNo, date: isoDate(g.grn.docDate),
        fromPrevious: plainQty(g.receivedQty), movedToNext: plainQty(billed), stillOpen: plainQty(left),
        label: left.lte(0) ? 'Billed' : 'Received', group: left.lte(0) ? 'done' : 'released',
      });
    }

    const invoiceMap: Record<string, [string, FlowQtyRow['group']]> = {
      TO_MATCH: ['To match', 'pending'], PENDING_APPROVAL: ['Pending approval', 'pending'], APPROVED: ['Unpaid', 'released'], PAID: ['Paid', 'done'],
    };
    const invoices = invoiceLines.sort((a, b) => a.invoice.docNo.localeCompare(b.invoice.docNo));
    invoices.forEach((i, index) => {
      // Returns are shown against the last invoice: the goods came back after being billed.
      const returned = index === invoices.length - 1 ? returnedTotal : dec(0);
      rows.push({
        type: PUR_ENTITY.INVOICE, id: i.invoice.id, docNo: i.invoice.docNo, date: isoDate(i.invoice.docDate),
        fromPrevious: plainQty(i.qty),
        movedToNext: returned.gt(0) ? `${plainQty(returned)} returned` : '—',
        stillOpen: returned.gt(0) ? `${plainQty(i.qty.sub(returned))} kept` : '0',
        label: invoiceMap[i.invoice.status]?.[0] ?? i.invoice.status, group: invoiceMap[i.invoice.status]?.[1] ?? 'draft',
      });
    });

    for (const r of returnLines.sort((a, b) => a.purReturn.docNo.localeCompare(b.purReturn.docNo))) {
      rows.push({
        type: PUR_ENTITY.RETURN, id: r.purReturn.id, docNo: r.purReturn.docNo, date: isoDate(r.purReturn.docDate),
        fromPrevious: plainQty(r.qty), movedToNext: '—', stillOpen: '0',
        label: r.purReturn.status === 'SETTLED' ? 'Settled' : 'Released', group: r.purReturn.status === 'SETTLED' ? 'done' : 'released',
      });
    }

    for (const c of cancelLines) {
      rows.push({
        type: PUR_ENTITY.CANCEL_ORDER, id: c.cancelOrder.id, docNo: c.cancelOrder.docNo, date: isoDate(c.cancelOrder.docDate),
        fromPrevious: plainQty(c.cancelQty), movedToNext: '—', stillOpen: '0', label: 'Cancelled', group: 'cancelled',
      });
    }
    return rows;
  }
}
