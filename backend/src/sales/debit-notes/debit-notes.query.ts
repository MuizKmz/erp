import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalDebitNote, SalDebitNoteLine, SalInvoice } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty, toRate } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { SAL_ENTITY, SAL_EVENT } from '../shared/sales.constants';
import { invoiceBalance } from '../shared/totals.rules';
import { allowedDebitActions, DEBIT_REASONS, DN_STATUSES, type DnStatus } from './debit-note.rules';
import type { DebitListQueryDto } from './dto/debit-note.dto';

export type DebitWithLines = SalDebitNote & { lines: SalDebitNoteLine[] };
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Reading debit notes: the list (S25) and one debit note (S26). */
@Injectable()
export class DebitNotesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly linked: SalesLinkedDocsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<DebitWithLines> {
    const row = await this.prisma.salDebitNote.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Debit note');
    return row;
  }

  actions(ctx: RequestContext, d: SalDebitNote) {
    return allowedDebitActions({ status: d.status as DnStatus, isMigrated: d.isMigrated, canEdit: this.permissions.has(ctx.user.roles, P.DEBIT_NOTE_EDIT) });
  }

  async balanceOf(tenantId: string, inv: SalInvoice) {
    const paid = await this.prisma.finReceiptStub.aggregate({ where: { tenantId, appliesToType: 'INVOICE', appliesToNo: inv.docNo }, _sum: { amount: true } });
    return invoiceBalance({ total: inv.total, debited: inv.debitedAmount, credited: inv.creditedAmount, deposit: inv.depositApplied, paid: paid._sum.amount ?? dec(0) });
  }

  /** What the S26 header and side card show about the invoice the charge is added to. */
  async invoiceView(ctx: RequestContext, inv: SalInvoice) {
    const [balance, notes] = await Promise.all([
      this.balanceOf(ctx.tenantId, inv),
      this.prisma.salDebitNote.findMany({ where: { tenantId: ctx.tenantId, invoiceId: inv.id }, orderBy: { docDate: 'asc' } }),
    ]);
    return {
      id: inv.isMigrated ? null : inv.id,
      invoiceId: inv.id,
      no: inv.docNo,
      branchCode: inv.branchCode,
      dueDate: iso(inv.dueDate),
      customer: { code: inv.customerCode, name: inv.customerName },
      balance: toMoney(balance),
      debitNotes: notes.map((n) => ({ id: n.id, docNo: n.docNo, docDate: iso(n.docDate), reason: n.reason, total: toMoney(n.total), status: n.status, isMigrated: n.isMigrated })),
    };
  }

  async invoiceFor(ctx: RequestContext, invoiceId: string) {
    const inv = await this.prisma.salInvoice.findFirst({ where: { id: invoiceId, tenantId: ctx.tenantId } });
    if (!inv) throw new NotFoundError('Invoice');
    return this.invoiceView(ctx, inv);
  }

  /** Released invoices of a customer, for the "Adds to invoice" picker. */
  async invoices(ctx: RequestContext, q?: string) {
    const rows = await this.prisma.salInvoice.findMany({
      where: { tenantId: ctx.tenantId, status: 'RELEASED', ...(q?.trim() && { OR: [{ docNo: { contains: q.trim() } }, { customerName: { contains: q.trim() } }] }) },
      orderBy: { docDate: 'desc' },
      take: 15,
    });
    return { items: rows.map((r) => ({ id: r.id, docNo: r.docNo, docDate: iso(r.docDate), customerName: r.customerName, customerCode: r.customerCode, total: toMoney(r.total), isMigrated: r.isMigrated })) };
  }

  // ── List (S25) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: DebitListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalDebitNoteWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(query.invoice?.trim() && { invoiceNo: { contains: query.invoice.trim() } }),
      ...(query.reason && { reason: query.reason }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { invoiceNo: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, DN_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped, first] = await Promise.all([
      this.prisma.salDebitNote.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salDebitNote.count({ where }),
      this.prisma.salDebitNote.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.salDebitNote.findFirst({ where, orderBy: { docDate: 'asc' }, select: { docDate: true } }),
    ]);
    const events = await this.prisma.sysOutbox.findMany({ where: { tenantId: ctx.tenantId, name: SAL_EVENT.DEBIT_NOTE_RELEASED, aggregateId: { in: rows.map((r) => r.id) } }, select: { aggregateId: true, status: true } });
    const invoices = await this.prisma.salInvoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter((x): x is string => Boolean(x)) } }, select: { id: true, isMigrated: true } });
    const response = toListResponse(
      rows.map((d) => {
        const event = events.find((e) => e.aggregateId === d.id);
        return {
          id: d.id,
          docNo: d.docNo,
          docDate: iso(d.docDate),
          customerName: d.customerName,
          invoiceId: invoices.find((i) => i.id === d.invoiceId && !i.isMigrated) ? d.invoiceId : null,
          invoiceNo: d.invoiceNo,
          reason: d.reason,
          summary: d.summary,
          total: toMoney(d.total),
          eInvoice: d.isMigrated ? 'OLD_SYSTEM' : event?.status === 'PENDING' ? 'PENDING' : event ? 'SUBMITTED' : null,
          status: d.status,
          isMigrated: d.isMigrated,
          version: d.version,
        };
      }),
      total,
      query,
      buildStatusCounts(grouped, DN_STATUSES),
    );
    return { ...response, since: iso(first?.docDate ?? null), reasons: DEBIT_REASONS };
  }

  // ── One debit note (S26) ──────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const d = await this.load(ctx.tenantId, id);
    const inv = d.invoiceId ? await this.prisma.salInvoice.findFirst({ where: { id: d.invoiceId } }) : null;
    const [activity, links, invoice, taxes] = await Promise.all([
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.DEBIT_NOTE, d.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.DEBIT_NOTE, d.id),
      inv ? this.invoiceView(ctx, inv) : null,
      this.masterData.listTaxCodes(ctx.tenantId),
    ]);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    return {
      id: d.id,
      docNo: d.docNo,
      docDate: iso(d.docDate),
      status: d.status,
      isMigrated: d.isMigrated,
      version: d.version,
      reason: d.reason,
      summary: d.summary,
      note: d.note,
      dueDate: iso(d.dueDate),
      totals: {
        subtotal: toMoney(d.subtotal),
        tax: toMoney(d.taxTotal),
        total: toMoney(d.total),
        taxLines: [...new Set(d.lines.map((l) => l.taxCode))].map((code) => ({ code, name: taxName(code), amount: toMoney(d.lines.filter((l) => l.taxCode === code).reduce((s, l) => s.add(l.taxAmount), dec(0))) })),
      },
      invoice: invoice ?? { id: null, invoiceId: null, no: d.invoiceNo, branchCode: d.branchCode, dueDate: iso(d.dueDate), customer: { code: d.customerCode, name: d.customerName }, balance: '0.00', debitNotes: [] },
      lines: d.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxName: taxName(l.taxCode), taxRate: toRate(l.taxRate),
        qty: toQty(l.qty), unitPrice: toPrice(l.unitPrice), amount: toMoney(l.amount), taxAmount: toMoney(l.taxAmount),
      })),
      reasons: DEBIT_REASONS,
      releasedAt: d.releasedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, d),
    };
  }
}
