import { Injectable } from '@nestjs/common';
import { dec, toRmText } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { EXTERNAL_ENTITY, PUR_ENTITY } from './purchase.constants';
import { plainQty, qtyWithUnit } from './text.rules';

export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled';

/** One row of the "Linked documents" card. */
export interface LinkedDoc {
  type: string;
  id: string | null;
  docNo: string;
  /** "request", "2 quotes", "95 rolls", "RM 4,180.00", "10 returned" */
  summary: string;
  status: string | null;
  label: string | null;
  group: ChipGroup | null;
  /** Earlier in the chain than the document being viewed */
  upstream: boolean;
}

/** Chain order for display: request, RFQ, sales order, PO, receipt, invoice, return, cancel, debit note. */
const RANK: Record<string, number> = {
  [PUR_ENTITY.REQUEST]: 1,
  [PUR_ENTITY.RFQ]: 2,
  [EXTERNAL_ENTITY.SALES_ORDER]: 3,
  [PUR_ENTITY.ORDER]: 4,
  [PUR_ENTITY.RECEIPT]: 5,
  [PUR_ENTITY.INVOICE]: 6,
  [PUR_ENTITY.RETURN]: 7,
  [PUR_ENTITY.CANCEL_ORDER]: 8,
  [PUR_ENTITY.DEBIT_NOTE]: 9,
};

type Edge = { fromType: string; fromId: string | null; fromNo: string; toType: string; toId: string | null; toNo: string };

/**
 * Walks sys_doc_link from one document: backwards to where it came from, forwards to what followed.
 * Never walks sideways (e.g. from PO-0001 back to its request and on to another PO of the same request).
 */
@Injectable()
export class LinkedDocsService {
  constructor(private readonly prisma: PrismaService) {}

  async forDocument(tenantId: string, type: string, id: string): Promise<LinkedDoc[]> {
    const found = new Map<string, { type: string; id: string | null; docNo: string; upstream: boolean }>();
    const key = (t: string, i: string | null, no: string) => `${t}:${i ?? no}`;

    const walk = async (direction: 'up' | 'down') => {
      let frontier = [{ type, id }];
      for (let depth = 0; depth < 6 && frontier.length; depth++) {
        const edges: Edge[] = await this.prisma.sysDocLink.findMany({
          where: {
            tenantId,
            OR: frontier.map((f) => (direction === 'up' ? { toType: f.type, toId: f.id } : { fromType: f.type, fromId: f.id })),
          },
        });
        const next: { type: string; id: string }[] = [];
        for (const e of edges) {
          const t = direction === 'up' ? e.fromType : e.toType;
          const i = direction === 'up' ? e.fromId : e.toId;
          const no = direction === 'up' ? e.fromNo : e.toNo;
          const k = key(t, i, no);
          if (found.has(k) || (t === type && i === id)) continue;
          found.set(k, { type: t, id: i, docNo: no, upstream: direction === 'up' });
          if (i) next.push({ type: t, id: i });
        }
        frontier = next;
      }
    };
    await walk('up');
    await walk('down');

    const docs = [...found.values()];
    const described = await Promise.all(docs.map((d) => this.describe(tenantId, d)));
    return described.sort((a, b) => (RANK[a.type] ?? 99) - (RANK[b.type] ?? 99) || a.docNo.localeCompare(b.docNo));
  }

  private async describe(tenantId: string, d: { type: string; id: string | null; docNo: string; upstream: boolean }): Promise<LinkedDoc> {
    const base = { type: d.type, id: d.id, docNo: d.docNo, upstream: d.upstream };
    const none = { ...base, summary: '', status: null, label: null, group: null };
    if (!d.id) {
      return d.type === EXTERNAL_ENTITY.SALES_ORDER ? { ...none, summary: 'customer order' } : none;
    }
    const where = { id: d.id, tenantId };

    switch (d.type) {
      case PUR_ENTITY.REQUEST: {
        const r = await this.prisma.purRequest.findFirst({ where, select: { status: true } });
        if (!r) return none;
        const map = { DRAFT: ['Draft', 'draft'], SUBMITTED: ['Submitted', 'released'], CONVERTED: ['Converted', 'done'], REJECTED: ['Rejected', 'cancelled'] } as const;
        return { ...base, summary: 'request', status: r.status, label: map[r.status][0], group: map[r.status][1] };
      }
      case PUR_ENTITY.RFQ: {
        const r = await this.prisma.purRfq.findFirst({ where, select: { status: true, suppliers: { select: { status: true } } } });
        if (!r) return none;
        const quotes = r.suppliers.filter((s) => s.status === 'REPLIED').length;
        const map = { DRAFT: ['Draft', 'draft'], WAITING: ['Waiting', 'released'], READY: ['Ready to compare', 'released'], AWARDED: ['Awarded', 'done'], CLOSED: ['Closed', 'cancelled'] } as const;
        return { ...base, summary: `${quotes} ${quotes === 1 ? 'quote' : 'quotes'}`, status: r.status, label: map[r.status][0], group: map[r.status][1] };
      }
      case PUR_ENTITY.ORDER: {
        const o = await this.prisma.purPurchaseOrder.findFirst({ where, select: { status: true, total: true } });
        if (!o) return none;
        const map = { DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'], PARTIAL: ['Partial', 'partial'], DONE: ['Done', 'done'], CANCELLED: ['Cancelled', 'cancelled'] } as const;
        return { ...base, summary: toRmText(o.total), status: o.status, label: map[o.status][0], group: map[o.status][1] };
      }
      case PUR_ENTITY.RECEIPT: {
        const g = await this.prisma.purGoodsReceipt.findFirst({ where, select: { status: true, lines: { select: { receivedQty: true, uomCode: true } } } });
        if (!g) return none;
        const total = g.lines.reduce((sum, l) => sum.add(l.receivedQty), dec(0));
        const summary = g.lines[0] ? qtyWithUnit(total, g.lines[0].uomCode) : '';
        return g.status === 'CONFIRMED'
          ? { ...base, summary, status: g.status, label: 'Received', group: 'done' }
          : { ...base, summary: 'being counted', status: g.status, label: 'Draft', group: 'draft' };
      }
      case PUR_ENTITY.INVOICE: {
        const p = await this.prisma.purInvoice.findFirst({ where, select: { status: true, total: true } });
        if (!p) return none;
        const map = { DRAFT: ['Draft', 'draft'], TO_MATCH: ['To match', 'pending'], PENDING_APPROVAL: ['Pending approval', 'pending'], APPROVED: ['Matched', 'done'], REJECTED: ['Rejected', 'cancelled'], PAID: ['Paid', 'done'] } as const;
        return { ...base, summary: toRmText(p.total), status: p.status, label: map[p.status][0], group: map[p.status][1] };
      }
      case PUR_ENTITY.RETURN: {
        const r = await this.prisma.purReturn.findFirst({ where, select: { status: true, lines: { select: { qty: true } } } });
        if (!r) return none;
        const qty = plainQty(r.lines.reduce((sum, l) => sum.add(l.qty), dec(0)));
        const map = { DRAFT: ['Draft', 'draft'], RELEASED: ['Awaiting credit', 'pending'], SETTLED: ['Settled', 'done'] } as const;
        return { ...base, summary: `${qty} returned`, status: r.status, label: map[r.status][0], group: map[r.status][1] };
      }
      case PUR_ENTITY.CANCEL_ORDER: {
        const c = await this.prisma.purCancelOrder.findFirst({ where, select: { status: true, lines: { select: { cancelQty: true } } } });
        if (!c) return none;
        const qty = plainQty(c.lines.reduce((sum, l) => sum.add(l.cancelQty), dec(0)));
        return { ...base, summary: `${qty} cancelled`, status: c.status, label: c.status === 'RELEASED' ? 'Released' : 'Draft', group: c.status === 'RELEASED' ? 'released' : 'draft' };
      }
      case PUR_ENTITY.DEBIT_NOTE: {
        const n = await this.prisma.purDebitNote.findFirst({ where, select: { status: true, total: true } });
        if (!n) return none;
        const map = { DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'], REJECTED: ['Rejected', 'cancelled'] } as const;
        return { ...base, summary: toRmText(n.total), status: n.status, label: map[n.status][0], group: map[n.status][1] };
      }
      default:
        return none;
    }
  }
}
