import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalQuotation, SalQuotationLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty, toRate, toRmText } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { dateRange, pageArgs, parseSort, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreditService } from '../shared/credit.service';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { CREDIT_DOC, SAL_ENTITY } from '../shared/sales.constants';
import type { QuotationListQueryDto } from './dto/quotation.dto';
import { allowedQuotationActions, discountOverLimit, expiresSoon, isExpired, quotationLabel, type QtStatus } from './quotation.rules';

export type QuotationWithLines = SalQuotation & { lines: SalQuotationLine[] };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** Reading quotations: the list with expiry warning (S08) and one quotation with its revisions (S09). */
@Injectable()
export class QuotationsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
    private readonly permissions: PermissionRegistry,
    private readonly credit: CreditService,
    private readonly linked: SalesLinkedDocsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<QuotationWithLines> {
    const row = await this.prisma.salQuotation.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Quotation');
    return row;
  }

  async discountLimit(tenantId: string) {
    const setting = await this.prisma.salSetting.findUnique({ where: { tenantId } });
    return { pct: setting?.discountApprovalPct ?? dec(15), warnDays: setting?.quoteExpiryWarnDays ?? 3, showMargin: setting?.showMargin ?? false };
  }

  actions(ctx: RequestContext, q: QuotationWithLines, limitPct: Prisma.Decimal) {
    const has = (p: string) => this.permissions.has(ctx.user.roles, p);
    return allowedQuotationActions({
      status: q.status as QtStatus,
      isMigrated: q.isMigrated,
      expired: isExpired(q.status, iso(q.validUntil), this.clock.today()),
      discountOver: discountOverLimit(q.lines, limitPct).over,
      approved: Boolean(q.approvedAt),
      canEdit: has(P.QUOTATION_EDIT),
      canRelease: has(P.QUOTATION_RELEASE),
      canOrder: has(P.ORDER_EDIT),
    });
  }

  // ── List (S08) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: QuotationListQueryDto) {
    const today = this.clock.today();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const limits = await this.discountLimit(ctx.tenantId);
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total', validUntil: 'validUntil' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    // One row per quotation number: the latest revision (older ones are SUPERSEDED).
    const base: Prisma.SalQuotationWhereInput = {
      tenantId: ctx.tenantId,
      status: { not: 'SUPERSEDED' },
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(query.agent && { agentCode: query.agent }),
      ...(query.branch && { branchCode: query.branch }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }] }),
    };
    const notExpired: Prisma.SalQuotationWhereInput = { OR: [{ validUntil: null }, { validUntil: { gte: todayDate } }] };
    const TAB: Record<string, Prisma.SalQuotationWhereInput> = {
      draft: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
      released: { OR: [{ status: 'RELEASED', ...notExpired }, { status: 'ORDERED' }] },
      ordered: { status: 'ORDERED' },
      expired: { status: 'RELEASED', validUntil: { lt: todayDate } },
      lost: { status: 'LOST' },
    };
    const tab = query.status && TAB[query.status] ? TAB[query.status]! : {};
    const where: Prisma.SalQuotationWhereInput = { AND: [base, tab] };
    const [rows, total, counts, soon] = await Promise.all([
      this.prisma.salQuotation.findMany({ where, include: { lines: true }, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salQuotation.count({ where }),
      Promise.all([this.prisma.salQuotation.count({ where: base }), ...Object.values(TAB).map((t) => this.prisma.salQuotation.count({ where: { AND: [base, t] } }))]),
      this.prisma.salQuotation.findMany({ where: { tenantId: ctx.tenantId, status: 'RELEASED', validUntil: { gte: todayDate } }, select: { docNo: true, validUntil: true, status: true } }),
    ]);
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, docNo: { in: rows.map((r) => r.salesOrderNo).filter((n): n is string => Boolean(n)) } },
      select: { id: true, docNo: true },
    });
    return {
      ...toListResponse(
        rows.map((r) => {
          const expired = isExpired(r.status, iso(r.validUntil), today);
          return {
            id: r.id, docNo: r.docNo, revision: r.revision, docDate: iso(r.docDate), validUntil: iso(r.validUntil), customerName: r.customerName, agentName: r.agentName,
            total: toMoney(r.total), salesOrder: r.salesOrderNo ? { no: r.salesOrderNo, id: orders.find((o) => o.docNo === r.salesOrderNo)?.id ?? null } : null,
            status: r.status, label: quotationLabel(r.status as QtStatus, r.revision, expired), expired, isMigrated: r.isMigrated, version: r.version,
            allowedActions: this.actions(ctx, r, limits.pct),
          };
        }),
        total,
        query,
        { all: counts[0]!, draft: counts[1]!, released: counts[2]!, ordered: counts[3]!, expired: counts[4]!, lost: counts[5]! },
      ),
      expiringSoon: soon.filter((s) => expiresSoon(s.status, iso(s.validUntil), today, limits.warnDays)).map((s) => ({ docNo: s.docNo, validUntil: iso(s.validUntil) })),
    };
  }

  // ── One quotation (S09) ───────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const q = await this.load(ctx.tenantId, id);
    const today = this.clock.today();
    const codes = q.lines.map((l) => l.itemCode);
    const [limits, customer, activity, links, approvals, files, branches, taxes, priceLists, revisions, sold, enquiry, order] = await Promise.all([
      this.discountLimit(ctx.tenantId),
      this.masterData.findCustomer(ctx.tenantId, q.customerCode),
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.QUOTATION, q.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.QUOTATION, q.id),
      this.approvals.listForEntity(ctx.tenantId, SAL_ENTITY.QUOTATION, q.id),
      this.attachments.listFor(ctx.tenantId, SAL_ENTITY.QUOTATION, q.id),
      this.masterData.listBranches(ctx.tenantId),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listPriceLists(ctx.tenantId),
      this.prisma.salQuotation.findMany({ where: { tenantId: ctx.tenantId, docNo: q.docNo }, orderBy: { revision: 'desc' }, select: { id: true, revision: true, status: true, docDate: true, total: true } }),
      this.prisma.salInvoiceLine.findMany({
        where: { tenantId: ctx.tenantId, itemCode: { in: codes }, invoice: { customerCode: q.customerCode, status: 'RELEASED' } },
        include: { invoice: { select: { docNo: true, docDate: true } } },
        orderBy: { invoice: { docDate: 'desc' } },
      }),
      q.enquiryId ? this.prisma.salEnquiry.findFirst({ where: { id: q.enquiryId }, include: { items: { orderBy: { lineNo: 'asc' } } } }) : null,
      q.salesOrderNo ? this.prisma.salSalesOrder.findFirst({ where: { tenantId: ctx.tenantId, docNo: q.salesOrderNo }, select: { id: true, docNo: true } }) : null,
    ]);
    const expired = isExpired(q.status, iso(q.validUntil), today);
    const discount = discountOverLimit(q.lines, limits.pct);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const latest = approvals[0] ?? null;
    const decided = latest?.steps.find((s) => s.decidedAt);
    const waiting = latest?.status === 'PENDING' ? latest.steps.find((s) => s.status === 'WAITING') : null;
    const net = q.subtotal.sub(q.discountTotal);
    const canSeeMargin = limits.showMargin && this.permissions.has(ctx.user.roles, P.MARGIN_VIEW);

    // Over the credit limit only warns on a quotation (Credit Control → Quotation: allow, show warning).
    let creditWarning: string | null = null;
    if (customer && (q.status === 'DRAFT' || q.status === 'PENDING_APPROVAL')) {
      const c = await this.credit.check(ctx.tenantId, { customer, docType: CREDIT_DOC.QUOTATION, thisDocument: toMoney(q.total), branchCode: q.branchCode });
      if (c.check.overCredit.gt(0)) {
        creditWarning = `Over credit limit by ${toRmText(c.check.overCredit)}. Owed ${toRmText(dec(c.input.owed).add(dec(c.input.otherOpen)))} + this quotation ${toRmText(q.total)} against a ${toRmText(customer.creditLimit)} limit. Quotations are allowed; the sales order will need approval.`;
      }
    }

    return {
      id: q.id,
      docNo: q.docNo,
      revision: q.revision,
      docDate: iso(q.docDate),
      validUntil: iso(q.validUntil),
      status: q.status,
      label: quotationLabel(q.status as QtStatus, q.revision, expired),
      expired,
      isMigrated: q.isMigrated,
      version: q.version,
      customer: { code: q.customerCode, name: q.customerName, active: customer?.status === 'ACTIVE', email: customer?.email ?? null },
      contactName: q.contactName,
      agent: { code: q.agentCode, name: q.agentName },
      branch: { code: q.branchCode, name: branches.find((b) => b.code === q.branchCode)?.name ?? q.branchCode },
      currency: q.currency,
      taxMode: q.taxMode,
      creditTermDays: q.creditTermDays,
      priceList: { code: q.priceListCode, name: priceLists.find((p) => p.code === q.priceListCode)?.name ?? q.priceListCode },
      customerNote: q.customerNote,
      internalNote: q.internalNote,
      enquiry: enquiry ? { id: enquiry.id, no: enquiry.docNo } : null,
      enquiryItems: (enquiry?.items ?? []).map((i) => ({ itemCode: i.itemCode, itemName: i.itemName, qty: toQty(i.qty), uomCode: i.uomCode })),
      salesOrder: order ? { id: order.id, no: order.docNo } : q.salesOrderNo ? { id: null, no: q.salesOrderNo } : null,
      lostReason: q.lostReason,
      lines: q.lines.map((l) => {
        const last = sold.find((s) => s.itemCode === l.itemCode);
        return {
          id: l.id, lineNo: l.lineNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxName: taxName(l.taxCode), taxRate: toRate(l.taxRate),
          qty: toQty(l.qty), listPrice: l.listPrice ? toPrice(l.listPrice) : null, unitPrice: toPrice(l.unitPrice), discountPct: l.discountPct.toFixed(2),
          grossAmount: toMoney(l.grossAmount), discountAmount: toMoney(l.discountAmount), amount: toMoney(l.amount), taxAmount: toMoney(l.taxAmount),
          lastSold: last ? { price: toPrice(last.unitPrice), date: iso(last.invoice.docDate), docNo: last.invoice.docNo } : null,
        };
      }),
      totals: {
        subtotal: toMoney(q.subtotal), discountTotal: toMoney(q.discountTotal), rounding: toMoney(q.rounding), total: toMoney(q.total),
        taxLines: [...new Set(q.lines.map((l) => l.taxCode))].map((code) => ({ code, name: taxName(code), amount: toMoney(sum(q.lines.filter((l) => l.taxCode === code).map((l) => l.taxAmount))) })),
      },
      marginPct: canSeeMargin && q.costTotal && net.gt(0) ? net.sub(q.costTotal).div(net).mul(100).toFixed(1) : null,
      discount: { over: discount.over, highest: discount.highest, limitPct: limits.pct.toDecimalPlaces(2).toString() },
      creditWarning,
      approval: {
        state: !latest ? 'NONE' : latest.status === 'PENDING' ? 'PENDING' : latest.status === 'APPROVED' ? 'APPROVED' : latest.status === 'REJECTED' ? 'REJECTED' : 'NONE',
        reason: latest?.reason ?? null,
        waitingFor: waiting ? (waiting.approverName ?? waiting.approverRole) : null,
        decidedBy: decided?.decidedByName ?? null,
        comment: decided?.comment ?? null,
      },
      revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, status: r.status, docDate: iso(r.docDate), total: toMoney(r.total) })),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      releasedAt: q.releasedAt?.toISOString() ?? null,
      emailedAt: q.emailedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, q, limits.pct),
    };
  }
}
