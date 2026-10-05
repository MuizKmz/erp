import { Injectable } from '@nestjs/common';
import { dec, toRmText } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SAL_ENTITY } from './sales.constants';

export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled';

/** One row of the "Linked documents" card. */
export interface LinkedDoc {
  type: string;
  id: string | null;
  docNo: string;
  /** "Quotation", "60 delivered", "RM 16,500.00" */
  summary: string;
  status: string | null;
  label: string | null;
  group: ChipGroup | null;
  upstream: boolean;
}

/** Chain order: enquiry, quotation, order, proforma, delivery, invoice, return, debit note, cancel order. */
const RANK: Record<string, number> = {
  [SAL_ENTITY.ENQUIRY]: 1,
  [SAL_ENTITY.QUOTATION]: 2,
  [SAL_ENTITY.ORDER]: 3,
  [SAL_ENTITY.PROFORMA]: 4,
  [SAL_ENTITY.DELIVERY]: 5,
  [SAL_ENTITY.INVOICE]: 6,
  [SAL_ENTITY.RETURN]: 7,
  [SAL_ENTITY.DEBIT_NOTE]: 8,
  [SAL_ENTITY.CANCEL_ORDER]: 9,
};

const plain = (v: { isInteger(): boolean; toFixed(n: number): string }) => (v.isInteger() ? v.toFixed(0) : v.toFixed(2));

/** Walks sys_doc_link from a Sales document: back to where it came from, forward to what followed. */
@Injectable()
export class SalesLinkedDocsService {
  constructor(private readonly prisma: PrismaService) {}

  async forDocument(tenantId: string, type: string, id: string): Promise<LinkedDoc[]> {
    const found = new Map<string, { type: string; id: string | null; docNo: string; upstream: boolean }>();
    const walk = async (direction: 'up' | 'down') => {
      let frontier = [{ type, id }];
      for (let depth = 0; depth < 6 && frontier.length; depth++) {
        const edges = await this.prisma.sysDocLink.findMany({
          where: { tenantId, OR: frontier.map((f) => (direction === 'up' ? { toType: f.type, toId: f.id } : { fromType: f.type, fromId: f.id })) },
        });
        const next: { type: string; id: string }[] = [];
        for (const e of edges) {
          const t = direction === 'up' ? e.fromType : e.toType;
          const i = direction === 'up' ? e.fromId : e.toId;
          const no = direction === 'up' ? e.fromNo : e.toNo;
          const key = `${t}:${i ?? no}`;
          if (found.has(key) || (t === type && i === id)) continue;
          found.set(key, { type: t, id: i, docNo: no, upstream: direction === 'up' });
          if (i) next.push({ type: t, id: i });
        }
        frontier = next;
      }
    };
    await walk('up');
    await walk('down');
    const described = await Promise.all([...found.values()].map((d) => this.describe(tenantId, d)));
    return described.sort((a, b) => (RANK[a.type] ?? 99) - (RANK[b.type] ?? 99) || a.docNo.localeCompare(b.docNo));
  }

  private async describe(tenantId: string, d: { type: string; id: string | null; docNo: string; upstream: boolean }): Promise<LinkedDoc> {
    const base = { type: d.type, id: d.id, docNo: d.docNo, upstream: d.upstream };
    const none = { ...base, summary: '', status: null, label: null, group: null };
    if (!d.id) return none;
    const where = { id: d.id, tenantId };
    switch (d.type) {
      case SAL_ENTITY.ENQUIRY: {
        const e = await this.prisma.salEnquiry.findFirst({ where, select: { status: true } });
        if (!e) return none;
        const map = { NEW: ['New', 'draft'], FORWARDED: ['Forwarded', 'released'], QUOTED: ['Quoted', 'done'], LOST: ['Lost', 'cancelled'] } as const;
        return { ...base, summary: 'Enquiry', status: e.status, label: map[e.status][0], group: map[e.status][1] };
      }
      case SAL_ENTITY.QUOTATION: {
        const q = await this.prisma.salQuotation.findFirst({ where, select: { status: true } });
        if (!q) return none;
        const map = { DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'], ORDERED: ['Done', 'done'], LOST: ['Lost', 'cancelled'], SUPERSEDED: ['Revised', 'cancelled'] } as const;
        return { ...base, summary: 'Quotation', status: q.status, label: map[q.status][0], group: map[q.status][1] };
      }
      case SAL_ENTITY.ORDER: {
        const o = await this.prisma.salSalesOrder.findFirst({ where, select: { status: true, total: true, balanceCancelled: true } });
        if (!o) return none;
        const map = { DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'], PARTIAL: ['Partial', 'partial'], DONE: ['Done', 'done'], CANCELLED: ['Cancelled', 'cancelled'] } as const;
        return { ...base, summary: 'Sales order', status: o.status, label: o.balanceCancelled ? 'Balance cancelled' : map[o.status][0], group: o.balanceCancelled ? 'cancelled' : map[o.status][1] };
      }
      case SAL_ENTITY.DELIVERY: {
        const g = await this.prisma.salDelivery.findFirst({ where, select: { status: true, lines: { select: { qty: true } } } });
        if (!g) return none;
        const qty = plain(g.lines.reduce((s, l) => s.add(l.qty), dec(0)));
        return g.status === 'CONFIRMED'
          ? { ...base, summary: `${qty} delivered`, status: g.status, label: 'Released', group: 'released' }
          : { ...base, summary: `${qty} to deliver`, status: g.status, label: 'Draft', group: 'draft' };
      }
      case SAL_ENTITY.INVOICE: {
        const v = await this.prisma.salInvoice.findFirst({ where, select: { status: true, total: true } });
        if (!v) return none;
        const map = { DRAFT: ['Draft', 'draft'], PENDING_APPROVAL: ['Pending approval', 'pending'], RELEASED: ['Released', 'released'] } as const;
        return { ...base, summary: toRmText(v.total), status: v.status, label: map[v.status][0], group: map[v.status][1] };
      }
      case SAL_ENTITY.PROFORMA: {
        const p = await this.prisma.salProforma.findFirst({ where, select: { status: true, amount: true } });
        if (!p) return none;
        const map = { DRAFT: ['Draft', 'draft'], SENT: ['Sent', 'released'], PAID: ['Paid', 'done'], USED: ['Used', 'done'], CANCELLED: ['Cancelled', 'cancelled'] } as const;
        return { ...base, summary: `deposit ${toRmText(p.amount)}`, status: p.status, label: map[p.status][0], group: map[p.status][1] };
      }
      case SAL_ENTITY.RETURN: {
        const r = await this.prisma.salReturn.findFirst({ where, select: { status: true, lines: { select: { qty: true } } } });
        if (!r) return none;
        const qty = plain(r.lines.reduce((s, l) => s.add(l.qty), dec(0)));
        return { ...base, summary: `${qty} returned`, status: r.status, label: r.status === 'RELEASED' ? 'Released' : 'Draft', group: r.status === 'RELEASED' ? 'released' : 'draft' };
      }
      case SAL_ENTITY.DEBIT_NOTE: {
        const n = await this.prisma.salDebitNote.findFirst({ where, select: { status: true, total: true } });
        if (!n) return none;
        return { ...base, summary: toRmText(n.total), status: n.status, label: n.status === 'RELEASED' ? 'Released' : 'Draft', group: n.status === 'RELEASED' ? 'released' : 'draft' };
      }
      case SAL_ENTITY.CANCEL_ORDER: {
        const c = await this.prisma.salCancelOrder.findFirst({ where, select: { status: true, summary: true } });
        if (!c) return none;
        return { ...base, summary: c.summary ?? 'Cancel order', status: c.status, label: c.status === 'RELEASED' ? 'Released' : 'Draft', group: c.status === 'RELEASED' ? 'released' : 'draft' };
      }
      default:
        return none;
    }
  }
}
