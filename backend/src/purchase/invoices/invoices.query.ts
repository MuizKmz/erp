import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurInvoice, PurInvoiceLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toMoney, toPrice, toQty, toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { OutboxConsumers } from '../../platform/outbox/outbox.consumers';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import { plainQty, qtyWithUnit } from '../shared/text.rules';
import type { InvoiceListQueryDto } from './dto/invoice.dto';
import {
  allowedInvoiceActions,
  matchInvoice,
  recordedLines,
  signed,
  type InvoiceDecision,
  type InvoiceStatus,
  type MatchLineInput,
  type MatchResult,
  type Tolerance,
} from './invoice.rules';

export const INVOICE_STATUSES = ['DRAFT', 'TO_MATCH', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID'] as const;
export const OPEN_INVOICE_STATUSES = ['TO_MATCH', 'PENDING_APPROVAL'] as const;
export const INVOICE_APPROVED_EVENT = 'purchase.invoice.approved';
/** Orders that can be billed: goods arrive only on released orders, which then become partial or done. */
const BILLABLE_PO_STATUSES = ['RELEASED', 'PARTIAL', 'DONE'] as const;

export type InvoiceWithLines = PurInvoice & { lines: PurInvoiceLine[] };
type Money = Prisma.Decimal;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Money[]) => values.reduce((s, v) => s.add(v), dec(0));
const rm = (v: Money | string) => toRmText(v);

/** The words for an invoice's state: "To match", "Needs a decision", "On hold", "Pending approval" … */
export function invoiceStatusLabel(i: Pick<PurInvoice, 'status' | 'decision' | 'matchResult'>): { label: string; group: 'draft' | 'pending' | 'done' | 'cancelled' } {
  if (i.status === 'TO_MATCH') {
    if (i.decision === 'HOLD') return { label: 'On hold', group: 'pending' };
    return i.matchResult === 'DIFFERENCE' ? { label: 'Needs a decision', group: 'pending' } : { label: 'To match', group: 'draft' };
  }
  return {
    DRAFT: { label: 'Draft', group: 'draft' as const },
    PENDING_APPROVAL: { label: 'Pending approval', group: 'pending' as const },
    APPROVED: { label: 'Approved', group: 'done' as const },
    PAID: { label: 'Paid', group: 'done' as const },
    REJECTED: { label: 'Rejected', group: 'cancelled' as const },
    TO_MATCH: { label: 'To match', group: 'draft' as const },
  }[i.status];
}

/** Reading supplier invoices: the list (P16) and the three-way match (P17). */
@Injectable()
export class InvoicesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    private readonly settings: PurchaseSettingsService,
    private readonly consumers: OutboxConsumers,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<InvoiceWithLines> {
    const invoice = await this.prisma.purInvoice.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!invoice) throw new NotFoundError('Purchase invoice');
    return invoice;
  }

  async tolerance(tenantId: string): Promise<Tolerance> {
    const s = await this.settings.settings(tenantId);
    return { pricePct: s.priceTolerancePct, qtyOver: s.qtyToleranceOver, taxAmount: s.taxToleranceAmount };
  }

  get financeConnected(): boolean {
    return this.consumers.hasSubscribers(INVOICE_APPROVED_EVENT);
  }

  /**
   * What may still be billed on each PO line: received − returned − already billed − what other open invoices
   * (to match, pending approval) want to record. Rule 2: billing follows received, never ordered.
   */
  async billable(tenantId: string, poLineIds: string[], excludeInvoiceId?: string): Promise<Map<string, Money>> {
    const [lines, open] = await Promise.all([
      this.prisma.purPurchaseOrderLine.findMany({ where: { tenantId, id: { in: poLineIds } } }),
      this.prisma.purInvoiceLine.findMany({
        where: {
          tenantId,
          poLineId: { in: poLineIds },
          invoice: { status: { in: [...OPEN_INVOICE_STATUSES] }, ...(excludeInvoiceId && { id: { not: excludeInvoiceId } }) },
        },
        select: { poLineId: true, qty: true },
      }),
    ]);
    return new Map(
      lines.map((l) => [
        l.id,
        l.receivedQty.sub(l.returnedQty).sub(l.billedQty).sub(sum(open.filter((o) => o.poLineId === l.id).map((o) => o.qty))),
      ]),
    );
  }

  /** The latest confirmed goods receipt line for each PO line (the invoice line points to it). */
  async latestReceiptLines(tenantId: string, poLineIds: string[]) {
    const rows = await this.prisma.purGoodsReceiptLine.findMany({
      where: { tenantId, poLineId: { in: poLineIds }, grn: { status: 'CONFIRMED' } },
      include: { grn: { select: { id: true, docNo: true, docDate: true } } },
      orderBy: { grn: { docDate: 'desc' } },
    });
    return new Map(poLineIds.map((id) => [id, rows.find((r) => r.poLineId === id) ?? null]));
  }

  actions(ctx: RequestContext, invoice: Pick<PurInvoice, 'status' | 'isMigrated' | 'matchResult'>, matched: boolean) {
    return allowedInvoiceActions({
      status: invoice.status as InvoiceStatus,
      isMigrated: invoice.isMigrated,
      canEdit: this.permissions.has(ctx.user.roles, P.INVOICE_EDIT),
      matched,
    });
  }

  // ── List (P16) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: InvoiceListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const q = query.q?.trim();
    const docDate = dateRange(query);
    const base: Prisma.PurInvoiceWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.supplier?.trim() && { supplierName: { contains: query.supplier.trim() } }),
      ...(query.supplierInvoiceNo?.trim() && { supplierInvoiceNo: { contains: query.supplierInvoiceNo.trim() } }),
      ...(query.match && { matchResult: query.match as 'MATCHED' | 'DIFFERENCE' | 'NOT_MATCHED' }),
      ...(q && { OR: [{ docNo: { contains: q } }, { supplierInvoiceNo: { contains: q } }, { poNo: { contains: q } }, { supplierName: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, INVOICE_STATUSES);
    const where: Prisma.PurInvoiceWhereInput = { ...base, ...(status && { status }) };
    const today = this.clock.today();
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);

    const [rows, total, grouped, month] = await Promise.all([
      this.prisma.purInvoice.findMany({
        where,
        include: { lines: { include: { grnLine: { include: { grn: { select: { id: true, docNo: true } } } } } } },
        orderBy: [toOrderBy(sort), { docNo: sort.direction }],
        ...pageArgs(query),
      }),
      this.prisma.purInvoice.count({ where }),
      this.prisma.purInvoice.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purInvoice.aggregate({ where: { ...base, docDate: { gte: monthStart } }, _sum: { total: true }, _count: { _all: true } }),
    ]);

    return {
      ...toListResponse(
        rows.map((r) => {
          const grns = new Map(r.lines.filter((l) => l.grnLine).map((l) => [l.grnLine!.grn.docNo, l.grnLine!.grn.id]));
          const state = invoiceStatusLabel(r);
          return {
            id: r.id,
            docNo: r.docNo,
            docDate: isoDate(r.docDate),
            supplierName: r.supplierName,
            supplierInvoiceNo: r.supplierInvoiceNo,
            poId: r.poId,
            poNo: r.poNo,
            grns: [...grns].map(([docNo, id]) => ({ id, docNo })),
            total: toMoney(r.total),
            matchResult: r.matchResult,
            matchSummary: r.matchResult === 'NOT_MATCHED' ? 'Not matched yet' : r.matchSummary,
            // Amber once a difference was settled by recording what was received.
            matchTone: r.matchResult === 'MATCHED' ? 'good' : r.matchResult === 'NOT_MATCHED' ? 'muted' : r.decision === 'RECORD_RECEIVED' ? 'warn' : 'bad',
            status: r.status,
            statusLabel: state.label,
            statusGroup: state.group,
            isMigrated: r.isMigrated,
          };
        }),
        total,
        query,
        buildStatusCounts(grouped, INVOICE_STATUSES),
      ),
      month: { name: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(monthStart), count: month._count._all, total: toMoney(month._sum.total ?? 0) },
    };
  }

  /** The four cards on the list. */
  async kpis(ctx: RequestContext) {
    const today = this.clock.today();
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
    const pick = { docNo: true, docDate: true, matchSummary: true, total: true, rejectReason: true } as const;
    const [toMatch, pending, approved, rejected] = await Promise.all([
      this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, status: 'TO_MATCH' }, select: pick, orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }] }),
      this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING_APPROVAL' }, select: pick, orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }] }),
      this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, status: 'APPROVED' }, select: pick }),
      this.prisma.purInvoice.findMany({
        where: { tenantId: ctx.tenantId, status: 'REJECTED', docDate: { gte: monthStart } },
        select: pick,
        orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      }),
    ]);
    const lower = (s: string | null) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
    const why = (r: (typeof rejected)[number]) =>
      r.matchSummary?.startsWith('Billed') ? 'billed more than received' : r.matchSummary?.startsWith('Price') ? 'price differs' : lower(r.rejectReason);
    return {
      toMatch: { count: toMatch.length, latest: toMatch[0] ? { docNo: toMatch[0].docNo, docDate: isoDate(toMatch[0].docDate) } : null },
      pending: { count: pending.length, latest: pending[0] ? { docNo: pending[0].docNo, summary: lower(pending[0].matchSummary?.split(' · ')[0] ?? null) } : null },
      approved: { count: approved.length, total: toMoney(sum(approved.map((a) => a.total))) },
      rejected: { count: rejected.length, latest: rejected[0] ? { docNo: rejected[0].docNo, why: why(rejected[0]) } : null },
      financeConnected: this.financeConnected,
    };
  }

  // ── Recording a new invoice ───────────────────────────────────────────────

  /** POs of a supplier with something received and not yet billed. */
  async billableOrders(ctx: RequestContext, supplierCode: string) {
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where: { tenantId: ctx.tenantId, supplierCode, status: { in: [...BILLABLE_PO_STATUSES] }, branchCode: { in: ctx.user.branchCodes } },
      include: { lines: true },
      orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
    });
    const billable = await this.billable(ctx.tenantId, orders.flatMap((o) => o.lines.map((l) => l.id)));
    return {
      items: orders
        .map((o) => {
          const lines = o.lines.filter((l) => billable.get(l.id)!.gt(0));
          const units = new Set(lines.map((l) => l.uomCode));
          const qty = sum(lines.map((l) => billable.get(l.id)!));
          return {
            id: o.id,
            docNo: o.docNo,
            docDate: isoDate(o.docDate),
            isMigrated: o.isMigrated,
            billableText: lines.length ? (units.size === 1 ? `${qtyWithUnit(qty, lines[0]!.uomCode)} to bill` : `${lines.length} items to bill`) : '',
            hasBillable: lines.length > 0,
          };
        })
        .filter((o) => o.hasBillable),
    };
  }

  async loadPo(ctx: RequestContext, poId: string) {
    const po = await this.prisma.purPurchaseOrder.findFirst({ where: { id: poId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!po) throw new NotFoundError('Purchase order');
    if (!ctx.user.branchCodes.includes(po.branchCode)) throw new BusinessRuleError('BRANCH_NOT_ALLOWED', `${po.docNo} belongs to a branch you do not work in.`);
    if (!(BILLABLE_PO_STATUSES as readonly string[]).includes(po.status)) {
      throw new BusinessRuleError('NOT_BILLABLE', `${po.docNo} has no goods received yet, so there is nothing to bill.`);
    }
    return po;
  }

  /** A new invoice for a PO, filled in with what was received and not yet billed. */
  async template(ctx: RequestContext, poId: string) {
    const po = await this.loadPo(ctx, poId);
    const ids = po.lines.map((l) => l.id);
    const [billable, receipts, taxes, supplier] = await Promise.all([
      this.billable(ctx.tenantId, ids),
      this.latestReceiptLines(ctx.tenantId, ids),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.findSupplier(ctx.tenantId, po.supplierCode),
    ]);
    const lines = po.lines.filter((l) => billable.get(l.id)!.gt(0));
    if (!lines.length) throw new BusinessRuleError('NOTHING_TO_BILL', `Everything received on ${po.docNo} has been billed.`);
    return {
      po: { id: po.id, docNo: po.docNo, isMigrated: po.isMigrated, paymentTermDays: po.paymentTermDays },
      supplier: { code: po.supplierCode, name: po.supplierName, shortName: supplier?.shortName ?? null },
      invoiceDate: this.clock.today(),
      grns: [...new Map(lines.map((l) => receipts.get(l.id)).filter((r) => r).map((r) => [r!.grn.docNo, { id: r!.grn.id, docNo: r!.grn.docNo }])).values()],
      lines: lines.map((l) => ({
        poLineId: l.id,
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxName: taxes.find((t) => t.code === l.taxCode)?.name ?? l.taxCode,
        taxRate: l.taxRate.toFixed(4),
        orderedQty: toQty(l.orderedQty),
        orderedPrice: toPrice(l.unitPrice),
        billableQty: toQty(billable.get(l.id)!),
      })),
    };
  }

  // ── Three-way match (P17) ─────────────────────────────────────────────────

  /** Match inputs: live billable quantities while the invoice is open, the saved snapshot once decided. */
  async matchInputs(tenantId: string, invoice: InvoiceWithLines): Promise<MatchLineInput[]> {
    const live = invoice.status === 'TO_MATCH' ? await this.billable(tenantId, invoice.lines.map((l) => l.poLineId), invoice.id) : null;
    return invoice.lines.map((l) => ({
      lineNo: l.lineNo,
      orderedQty: l.orderedQty,
      orderedPrice: l.orderedPrice,
      billableQty: live ? live.get(l.poLineId)! : l.receivedQty,
      billedQty: l.billedQty,
      billedPrice: l.billedUnitPrice,
      taxRate: l.taxRate,
    }));
  }

  async detail(ctx: RequestContext, id: string) {
    const invoice = await this.load(ctx.tenantId, id);
    const [inputs, tol, taxes, supplier, links, activity, files, approvalRequests, grnLines, users, po] = await Promise.all([
      this.matchInputs(ctx.tenantId, invoice),
      this.tolerance(ctx.tenantId),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.findSupplier(ctx.tenantId, invoice.supplierCode),
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.INVOICE, invoice.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.INVOICE, invoice.id),
      this.attachments.listFor(ctx.tenantId, PUR_ENTITY.INVOICE, invoice.id),
      this.approvals.listForEntity(ctx.tenantId, PUR_ENTITY.INVOICE, invoice.id),
      this.prisma.purGoodsReceiptLine.findMany({
        where: { id: { in: invoice.lines.map((l) => l.grnLineId).filter((x): x is string => !!x) } },
        include: { grn: { select: { id: true, docNo: true, docDate: true } } },
      }),
      this.masterData.listUsers(ctx.tenantId),
      this.prisma.purPurchaseOrder.findUniqueOrThrow({ where: { id: invoice.poId }, select: { id: true, docNo: true, isMigrated: true, paymentTermDays: true } }),
    ]);
    const match = matchInvoice(inputs, invoice.billedTax, tol);
    const pending = approvalRequests.find((r) => r.status === 'PENDING');
    const waitingStep = pending?.steps.find((s) => s.stepNo === pending.currentStep);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const grns = [...new Map(grnLines.map((g) => [g.grn.docNo, g.grn])).values()].sort((a, b) => b.docDate.getTime() - a.docDate.getTime());
    const contact = supplier?.shortName ?? invoice.supplierName;
    // While open, the label follows the live match ("Needs a decision" as soon as something differs).
    const state = invoiceStatusLabel({ ...invoice, matchResult: invoice.status === 'TO_MATCH' ? (match.matched ? 'MATCHED' : 'DIFFERENCE') : invoice.matchResult });

    return {
      id: invoice.id,
      docNo: invoice.docNo,
      docDate: isoDate(invoice.docDate),
      status: invoice.status,
      statusLabel: state.label,
      statusGroup: state.group,
      isMigrated: invoice.isMigrated,
      version: invoice.version,
      supplier: { code: invoice.supplierCode, name: invoice.supplierName, shortName: supplier?.shortName ?? null },
      supplierInvoiceNo: invoice.supplierInvoiceNo,
      invoiceDate: isoDate(invoice.invoiceDate),
      dueDate: isoDate(invoice.dueDate),
      paymentTermDays: po.paymentTermDays,
      po: { id: po.id, docNo: po.docNo, isMigrated: po.isMigrated },
      grns: grns.map((g) => ({ id: g.id, docNo: g.docNo, docDate: isoDate(g.docDate) })),
      billedTax: invoice.billedTax.toFixed(2),
      supplierNote: invoice.supplierNote,
      decision: invoice.decision,
      decisionNote: invoice.decisionNote,
      messageToSupplier: invoice.messageToSupplier,
      eInvoiceStatus: invoice.eInvoiceStatus,
      matchSummary: invoice.matchSummary,
      rejectReason: invoice.rejectReason,
      approvedAt: invoice.approvedAt?.toISOString() ?? null,
      approvedByName: invoice.approvedByCode ? (users.find((u) => u.code === invoice.approvedByCode)?.name ?? invoice.approvedByCode) : null,
      waitingFor: waitingStep ? (waitingStep.approverName ?? waitingStep.approverRole) : null,
      lines: invoice.lines.map((l, i) => ({
        id: l.id,
        lineNo: l.lineNo,
        poLineId: l.poLineId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxName: taxName(l.taxCode),
        taxRate: l.taxRate.toFixed(4),
        orderedQty: toQty(l.orderedQty),
        orderedPrice: toPrice(l.orderedPrice),
        receivedQty: toQty(dec(inputs[i]!.billableQty).lt(0) ? 0 : inputs[i]!.billableQty),
        billedQty: toQty(l.billedQty),
        billedUnitPrice: toPrice(l.billedUnitPrice),
        recordedQty: toQty(l.qty),
        recordedPrice: toPrice(l.unitPrice),
        match: match.lines[i]!,
      })),
      match: {
        matched: match.matched,
        summary: match.summary,
        taxOk: match.taxOk,
        taxDiff: match.taxDiff,
        expectedTax: match.expectedTax,
        tolerance: { pricePct: dec(tol.pricePct).toString(), qtyOver: plainQty(tol.qtyOver), taxAmount: toMoney(tol.taxAmount) },
      },
      columns: this.columns(invoice, inputs, taxName),
      ...this.options(invoice, inputs, match, contact, grns[0]?.docDate ?? null, tol),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, downloadUrl: f.downloadUrl })),
      financeConnected: this.financeConnected,
      links,
      activity,
      allowedActions: this.actions(ctx, invoice, match.matched),
    };
  }

  /** Ordered · Received · Billed totals for the match table, with tax per tax code. */
  private columns(invoice: InvoiceWithLines, inputs: MatchLineInput[], taxName: (code: string) => string) {
    const column = (qtyOf: (i: number) => Money, priceOf: (i: number) => Money) => {
      const lines = invoice.lines.map((l, i) => {
        const amount = roundMoney(qtyOf(i).mul(priceOf(i)));
        return { taxCode: l.taxCode, amount, tax: roundMoney(amount.mul(l.taxRate)) };
      });
      const codes = [...new Set(lines.map((l) => l.taxCode))];
      const subtotal = sum(lines.map((l) => l.amount));
      const taxLines = codes.map((code) => ({ code, name: taxName(code), amount: sum(lines.filter((l) => l.taxCode === code).map((l) => l.tax)) }));
      return { subtotal, taxLines, total: subtotal.add(sum(taxLines.map((t) => t.amount))) };
    };
    const received = (i: number) => (dec(inputs[i]!.billableQty).lt(0) ? dec(0) : dec(inputs[i]!.billableQty));
    const ordered = column((i) => invoice.lines[i]!.orderedQty, (i) => invoice.lines[i]!.orderedPrice);
    const rec = column(received, (i) => invoice.lines[i]!.orderedPrice);
    const billed = column((i) => invoice.lines[i]!.billedQty, (i) => invoice.lines[i]!.billedUnitPrice);
    // Their own tax total, when it differs from the worked-out tax.
    if (billed.taxLines.length === 1 && !invoice.billedTax.eq(billed.taxLines[0]!.amount)) {
      billed.taxLines[0]!.amount = invoice.billedTax;
      billed.total = billed.subtotal.add(invoice.billedTax);
    }
    const out = (c: typeof ordered) => ({ subtotal: toMoney(c.subtotal), taxLines: c.taxLines.map((t) => ({ ...t, amount: toMoney(t.amount) })), total: toMoney(c.total) });
    return { ordered: out(ordered), received: out(rec), billed: out(billed) };
  }

  /** The three choices with their effect in plain words (FlowP5 step 4), and the prefilled messages. */
  private options(invoice: InvoiceWithLines, inputs: MatchLineInput[], match: MatchResult, contact: string, receivedOn: Date | null, tol: Tolerance) {
    const totalOf = (decision: InvoiceDecision | 'MATCHED') => {
      const lines = recordedLines(inputs, match.lines, decision);
      return sum(lines.map((l) => l.amount.add(l.taxAmount)));
    };
    const billedTotal = invoice.billedSubtotal.add(invoice.billedTax);
    const recordTotal = totalOf('RECORD_RECEIVED');
    const qtyIssue = match.lines.some((l) => !l.qtyOk);
    const priceIssue = match.lines.some((l) => !l.priceOk);
    const single = invoice.lines.length === 1 ? invoice.lines[0]! : null;
    const recordQty = single ? match.lines[0]!.recordQty : null;
    const shortQty = single ? single.billedQty.sub(dec(recordQty!)) : null;
    const receivedDate = receivedOn ? `${receivedOn.getUTCDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(receivedOn)}` : null;

    let label: string;
    let description: string;
    let message: string;
    if (qtyIssue && single) {
      label = `Record only what was received · ${qtyWithUnit(recordQty!, single.uomCode)} · ${rm(recordTotal)}`;
      description = `The supplier is told the last ${qtyWithUnit(shortQty!, single.uomCode)} are billed when they arrive.`;
      message =
        `Dear ${contact}, we have recorded ${invoice.supplierInvoiceNo} for the ${qtyWithUnit(recordQty!, single.uomCode)} received` +
        `${receivedDate ? ` on ${receivedDate}` : ''} (${rm(recordTotal)}). Please bill the last ${qtyWithUnit(shortQty!, single.uomCode)} when they are delivered.`;
    } else if (qtyIssue) {
      label = `Record only what was received · ${rm(recordTotal)}`;
      description = 'The supplier is told the rest is billed when it arrives.';
      message = `Dear ${contact}, we have recorded ${invoice.supplierInvoiceNo} for the goods received (${rm(recordTotal)}). Please bill the rest when it is delivered.`;
    } else if (priceIssue) {
      label = `Record at the PO price · ${rm(recordTotal)}`;
      description = 'The supplier is told we pay the price agreed on the purchase order.';
      message =
        `Dear ${contact}, we have recorded ${invoice.supplierInvoiceNo} at the price agreed on ${invoice.poNo} (${rm(recordTotal)}). ` +
        `The difference of ${rm(billedTotal.sub(recordTotal))} is not paid unless we agree it in writing.`;
    } else {
      label = `Record with the worked-out tax · ${rm(recordTotal)}`;
      description = `The supplier is told the tax should be ${rm(match.expectedTax)}.`;
      message = `Dear ${contact}, we have recorded ${invoice.supplierInvoiceNo} with tax of ${rm(match.expectedTax)} (${rm(recordTotal)}). Please send a corrected invoice.`;
    }

    // Why the Purchasing Manager is asked (accept as billed).
    const reasons: string[] = [];
    if (priceIssue) {
      const worst = match.lines.reduce((w, l) => (dec(l.pricePct).abs().gt(dec(w.pricePct).abs()) ? l : w), match.lines[0]!);
      const ordered = sum(invoice.lines.map((l) => roundMoney(l.billedQty.mul(l.orderedPrice))));
      reasons.push(`Billed ${rm(invoice.billedSubtotal)} against PO price ${rm(ordered)} · ${signed(worst.pricePct)}%, over the ${dec(tol.pricePct).toString()}% tolerance`);
    }
    if (qtyIssue) reasons.push(single ? `Billed ${plainQty(single.billedQty)} but ${plainQty(recordQty!)} received` : 'Quantity billed above quantity received');
    if (!match.taxOk) reasons.push(`Tax differs by ${rm(dec(match.taxDiff).abs())}`);

    return {
      totals: { billed: toMoney(billedTotal), matched: toMoney(totalOf('MATCHED')), record: toMoney(recordTotal), recorded: toMoney(invoice.total) },
      options: { record: { label, description }, approvalReason: reasons.join(' · ') || 'Outside tolerance' },
      messages: {
        record: message,
        hold: `Dear ${contact}, we cannot record ${invoice.supplierInvoiceNo} yet: ${match.summary.charAt(0).toLowerCase()}${match.summary.slice(1)}. Please send a corrected invoice or a credit note.`,
      },
    };
  }
}
