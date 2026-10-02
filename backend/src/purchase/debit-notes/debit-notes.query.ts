import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurDebitNote, PurDebitNoteLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { invoiceStatusLabel } from '../invoices/invoices.query';
import { orderStatusLabel, type OrderStatus } from '../orders/order.rules';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { PUR_ENTITY, PUR_ROLE } from '../shared/purchase.constants';
import { qtyWithUnit } from '../shared/text.rules';
import type { DebitNoteListQueryDto } from './dto/debit-note.dto';
import { allowedDebitNoteActions, chargesOnPo, DEBIT_REASONS, DEBITABLE_INVOICE_STATUSES, type DebitNoteStatus } from './debit-note.rules';

export const DEBIT_NOTE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'REJECTED'] as const;
export type DebitNoteWithLines = PurDebitNote & { lines: PurDebitNoteLine[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** Reading supplier debit notes: the list (P20) and one note checked against its PO (P21). */
@Injectable()
export class DebitNotesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<DebitNoteWithLines> {
    const row = await this.prisma.purDebitNote.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Supplier debit note');
    return row;
  }

  actions(ctx: RequestContext, row: Pick<PurDebitNote, 'status' | 'isMigrated' | 'chargeOnPo'>) {
    return allowedDebitNoteActions({
      status: row.status as DebitNoteStatus,
      isMigrated: row.isMigrated,
      canEdit: this.permissions.has(ctx.user.roles, P.DEBIT_NOTE_EDIT),
      onPo: row.chargeOnPo,
    });
  }

  /** The invoice a debit note adds to, with its PO lines (rule: a debit note always points to one invoice). */
  async loadInvoice(ctx: RequestContext, invoiceId: string) {
    const invoice = await this.prisma.purInvoice.findFirst({
      where: { id: invoiceId, tenantId: ctx.tenantId },
      include: { po: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
    });
    if (!invoice) throw new NotFoundError('Supplier invoice');
    if (!ctx.user.branchCodes.includes(invoice.branchCode)) throw new BusinessRuleError('BRANCH_NOT_ALLOWED', `${invoice.docNo} belongs to a branch you do not work in.`);
    if (!(DEBITABLE_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) {
      throw new BusinessRuleError('NOT_DEBITABLE', `${invoice.docNo} was rejected. A debit note must add to an invoice we keep.`);
    }
    return invoice;
  }

  // ── List (P20) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: DebitNoteListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.PurDebitNoteWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.supplier?.trim() && { supplierName: { contains: query.supplier.trim() } }),
      ...(query.invoiceNo?.trim() && { OR: [{ invoiceNo: { contains: query.invoiceNo.trim() } }, { supplierInvoiceNo: { contains: query.invoiceNo.trim() } }] }),
      ...(query.reason && { reason: query.reason }),
      ...(q && { AND: [{ OR: [{ docNo: { contains: q } }, { theirNoteNo: { contains: q } }, { supplierName: { contains: q } }] }] }),
    };
    const status = statusFromKey(query.status, DEBIT_NOTE_STATUSES);
    const where: Prisma.PurDebitNoteWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped, reasons, all] = await Promise.all([
      this.prisma.purDebitNote.findMany({ where, include: { lines: { orderBy: { lineNo: 'asc' }, take: 1 } }, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purDebitNote.count({ where }),
      this.prisma.purDebitNote.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purDebitNote.findMany({ where: { tenantId: ctx.tenantId }, distinct: ['reason'], select: { reason: true } }),
      this.prisma.purDebitNote.findMany({ where, select: { total: true, docDate: true } }),
    ]);
    const earliest = all.reduce<Date | null>((m, r) => (!m || r.docDate < m ? r.docDate : m), null);
    return {
      ...toListResponse(
        rows.map((r) => ({
          id: r.id,
          docNo: r.docNo,
          docDate: isoDate(r.docDate),
          supplierName: r.supplierName,
          theirNoteNo: r.theirNoteNo,
          invoiceId: r.invoiceId,
          invoiceNo: r.invoiceNo,
          supplierInvoiceNo: r.supplierInvoiceNo,
          // "Installation and operator training · not on PO" when approval is needed, else the reason.
          reasonText: !r.chargeOnPo && r.lines[0] ? `${r.lines[0].itemName} · not on PO` : r.reason,
          total: toMoney(r.total),
          status: r.status,
          isMigrated: r.isMigrated,
        })),
        total,
        query,
        buildStatusCounts(grouped, DEBIT_NOTE_STATUSES),
      ),
      reasons: [...new Set([...DEBIT_REASONS, ...reasons.map((r) => r.reason)])],
      totals: {
        count: all.length,
        total: toMoney(sum(all.map((r) => r.total))),
        since: earliest ? new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(earliest) : null,
      },
    };
  }

  /** Invoices of a supplier a debit note can add to (for the invoice picker). */
  async debitableInvoices(ctx: RequestContext, supplierCode: string) {
    const rows = await this.prisma.purInvoice.findMany({
      where: { tenantId: ctx.tenantId, supplierCode, status: { in: [...DEBITABLE_INVOICE_STATUSES] }, branchCode: { in: ctx.user.branchCodes } },
      orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      take: 50,
    });
    return {
      items: rows.map((i) => ({ id: i.id, docNo: i.docNo, supplierInvoiceNo: i.supplierInvoiceNo, docDate: isoDate(i.docDate), total: toMoney(i.total), statusLabel: invoiceStatusLabel(i).label })),
    };
  }

  /**
   * "Checked against PO-0002" and "PI-0002 after this note", worked out for any set of charges, so the form can
   * show the check before the note is saved.
   */
  async check(ctx: RequestContext, invoiceId: string, chargeItemCodes: string[], debitTotal: Prisma.Decimal) {
    const invoice = await this.loadInvoice(ctx, invoiceId);
    const po = invoice.po;
    const result = chargesOnPo(chargeItemCodes, po.lines.map((l) => l.itemCode));
    const items = chargeItemCodes.length ? await this.masterData.findItems(ctx.tenantId, result.notOnPo) : [];
    const units = new Set(po.lines.map((l) => l.uomCode));
    const poWhat =
      po.lines.length === 1
        ? `${qtyWithUnit(po.lines[0]!.orderedQty, po.lines[0]!.uomCode)} of ${po.lines[0]!.itemName}`
        : units.size === 1
          ? qtyWithUnit(sum(po.lines.map((l) => l.orderedQty)), po.lines[0]!.uomCode)
          : `${po.lines.length} items`;
    const names = result.notOnPo.map((c) => items.find((i) => i.code === c)?.name ?? c);
    const approver = result.onPo ? null : await this.manager(ctx, invoice.branchCode);
    return {
      po: { id: po.id, docNo: po.docNo, isMigrated: po.isMigrated, what: poWhat, statusLabel: orderStatusLabel(po.status as OrderStatus, { balanceCancelled: po.balanceCancelled, approved: false }), status: po.status },
      onPo: result.onPo,
      message: result.onPo
        ? `Every charge is an item on ${po.docNo}. It can be released without approval.`
        : `${po.docNo} has ${poWhat} only. ${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} not on the PO or the quotation.`,
      goesTo: approver ? `${approver.name} · Purchasing Manager` : null,
      invoice: {
        id: invoice.id,
        docNo: invoice.docNo,
        supplierInvoiceNo: invoice.supplierInvoiceNo,
        total: toMoney(invoice.total),
        afterTotal: toMoney(invoice.total.add(debitTotal)),
        ...invoiceStatusLabel(invoice),
        isMigrated: invoice.isMigrated,
      },
      paymentTermDays: po.paymentTermDays,
    };
  }

  /** The Purchasing Manager of the branch (Ahmad Zaki at HQ). */
  async manager(ctx: RequestContext, branchCode: string) {
    const users = (await this.masterData.listUsers(ctx.tenantId)).filter((u) => u.isActive && u.roles.includes(PUR_ROLE.MANAGER) && u.code !== ctx.user.code);
    return users.find((u) => u.branchCodes.includes(branchCode)) ?? users[0] ?? null;
  }

  // ── One debit note (P21) ──────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const row = await this.load(ctx.tenantId, id);
    const [links, activity, files, taxes, requests, grns] = await Promise.all([
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.DEBIT_NOTE, row.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.DEBIT_NOTE, row.id),
      this.attachments.listFor(ctx.tenantId, PUR_ENTITY.DEBIT_NOTE, row.id),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.approvals.listForEntity(ctx.tenantId, PUR_ENTITY.DEBIT_NOTE, row.id),
      row.invoiceId
        ? this.prisma.purGoodsReceipt.findMany({ where: { tenantId: ctx.tenantId, lines: { some: { invoiceLines: { some: { invoiceId: row.invoiceId } } } } }, include: { lines: true } })
        : Promise.resolve([]),
    ]);
    const check = row.invoiceId ? await this.check(ctx, row.invoiceId, row.lines.map((l) => l.itemCode), row.total).catch(() => null) : null;
    const pending = requests.find((r) => r.status === 'PENDING');
    const lastDecided = requests.find((r) => r.status === 'REJECTED' || r.status === 'APPROVED');
    const waitingStep = pending?.steps.find((s) => s.stepNo === pending.currentStep);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const taxLines = [...new Set(row.lines.map((l) => l.taxCode))].map((code) => ({ code, name: taxName(code), amount: toMoney(sum(row.lines.filter((l) => l.taxCode === code).map((l) => l.taxAmount))) }));

    return {
      id: row.id,
      docNo: row.docNo,
      docDate: isoDate(row.docDate),
      status: row.status,
      isMigrated: row.isMigrated,
      version: row.version,
      supplier: { code: row.supplierCode, name: row.supplierName },
      invoice: { id: row.invoiceId, docNo: row.invoiceNo, supplierInvoiceNo: row.supplierInvoiceNo },
      theirNoteNo: row.theirNoteNo,
      reason: row.reason,
      reasons: [...new Set([...DEBIT_REASONS, row.reason])],
      chargeOnPo: row.chargeOnPo,
      dueDate: isoDate(row.dueDate),
      subtotal: toMoney(row.subtotal),
      taxLines,
      taxTotal: toMoney(row.taxTotal),
      total: toMoney(row.total),
      remarks: row.remarks,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      waitingFor: waitingStep ? (waitingStep.approverName ?? waitingStep.approverRole) : null,
      rejection: row.status === 'REJECTED' && lastDecided ? { comment: lastDecided.steps.find((s) => s.status === 'REJECTED')?.comment ?? null, byName: lastDecided.steps.find((s) => s.status === 'REJECTED')?.decidedByName ?? null } : null,
      lines: row.lines.map((l) => ({
        id: l.id,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxName: taxName(l.taxCode),
        taxRate: l.taxRate.toFixed(4),
        qty: toQty(l.qty),
        unitPrice: toPrice(l.unitPrice),
        amount: toMoney(l.amount),
        taxAmount: toMoney(l.taxAmount),
      })),
      check,
      grns: grns.map((g) => ({ id: g.id, docNo: g.docNo, docDate: isoDate(g.docDate), isMigrated: g.isMigrated })),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      links,
      activity,
      allowedActions: this.actions(ctx, row),
    };
  }
}
