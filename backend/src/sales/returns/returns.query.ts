import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalInvoice, SalInvoiceLine, SalReturn, SalReturnLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { SAL_ENTITY, SAL_EVENT } from '../shared/sales.constants';
import { invoiceBalance, saleLineTotals } from '../shared/totals.rules';
import type { ReturnListQueryDto } from './dto/return.dto';
import { allowedReturnActions, CREDIT_METHODS, RETURN_REASONS, returnChecks, SR_STATUSES, type GoodsTo, type SrStatus } from './return.rules';

export type ReturnWithLines = SalReturn & { lines: SalReturnLine[] };
type InvoiceWithLines = SalInvoice & { lines: SalInvoiceLine[] };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
const qtyText = (v: Prisma.Decimal) => toQty(v).replace(/\.0+$/, '');

export interface ReturnLocation {
  key: string;
  goodsTo: GoodsTo;
  warehouseCode: string;
  locationCode: string;
  label: string;
  placeName: string;
}

/** Reading sales returns: the list (S27), one return (S28), and what an invoice can still take back. */
@Injectable()
export class ReturnsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly permissions: PermissionRegistry,
    private readonly linked: SalesLinkedDocsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<ReturnWithLines> {
    const row = await this.prisma.salReturn.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Sales return');
    return row;
  }

  actions(ctx: RequestContext, r: SalReturn) {
    const has = (p: string) => this.permissions.has(ctx.user.roles, p);
    return allowedReturnActions({ status: r.status as SrStatus, isMigrated: r.isMigrated, canEdit: has(P.RETURN_EDIT), canReceive: has(P.RETURN_RECEIVE) });
  }

  /**
   * Where returned goods can go: any damaged-goods warehouse (one quarantine serves every branch, e.g. HQ Shah Alam
   * for Penang returns), or back into sellable stock in the invoice's branch.
   */
  async locations(tenantId: string, branchCode: string): Promise<ReturnLocation[]> {
    const [all, branches] = await Promise.all([this.masterData.listWarehouses(tenantId), this.masterData.listBranches(tenantId)]);
    const warehouses = all.filter((w) => w.code.endsWith('-DMG') || w.branchCode === branchCode);
    const branchName = branches.find((b) => b.code === branchCode)?.name.replace(/ branch$/i, '') ?? branchCode;
    const out: ReturnLocation[] = [];
    for (const w of warehouses.filter((x) => x.isActive)) {
      const loc = (await this.masterData.listLocations(tenantId, w.code)).find((l) => l.isActive);
      if (!loc) continue;
      const damaged = w.code.endsWith('-DMG');
      const place = w.name.replace(/ · damaged goods$/i, '');
      out.push({
        key: `${w.code}|${loc.code}`, goodsTo: damaged ? 'DAMAGED' : 'STOCK', warehouseCode: w.code, locationCode: loc.code,
        label: damaged ? `Damaged goods · ${place || branchName}` : `Back to stock · ${place} (${loc.name})`, placeName: place || branchName,
      });
    }
    return out.sort((a, b) => (a.goodsTo === b.goodsTo ? 0 : a.goodsTo === 'DAMAGED' ? -1 : 1));
  }

  /** Quantities other draft returns hold, per invoice line. */
  async heldByDrafts(tenantId: string, invoiceLineIds: string[], excludeId?: string) {
    const rows = await this.prisma.salReturnLine.groupBy({
      by: ['invoiceLineId'],
      where: { tenantId, invoiceLineId: { in: invoiceLineIds }, salesReturn: { status: 'DRAFT', ...(excludeId && { id: { not: excludeId } }) } },
      _sum: { qty: true },
    });
    return new Map(rows.map((r) => [r.invoiceLineId!, r._sum.qty ?? dec(0)]));
  }

  async invoiceBalanceOf(tenantId: string, inv: SalInvoice) {
    const paid = await this.prisma.finReceiptStub.aggregate({ where: { tenantId, appliesToType: 'INVOICE', appliesToNo: inv.docNo }, _sum: { amount: true } });
    const paidAmount = paid._sum.amount ?? dec(0);
    return { paid: paidAmount, balance: invoiceBalance({ total: inv.total, debited: inv.debitedAmount, credited: inv.creditedAmount, deposit: inv.depositApplied, paid: paidAmount }) };
  }

  /** What an invoice can still take back, line by line, and where the goods can go. */
  async invoiceView(ctx: RequestContext, inv: InvoiceWithLines, excludeId?: string) {
    const [held, customer, locations, money] = await Promise.all([
      this.heldByDrafts(ctx.tenantId, inv.lines.map((l) => l.id), excludeId),
      this.masterData.findCustomer(ctx.tenantId, inv.customerCode),
      this.locations(ctx.tenantId, inv.branchCode),
      this.invoiceBalanceOf(ctx.tenantId, inv),
    ]);
    return {
      id: inv.id,
      no: inv.docNo,
      docDate: iso(inv.docDate),
      isMigrated: inv.isMigrated,
      salesOrderNo: inv.salesOrderNo,
      customer: { code: inv.customerCode, name: inv.customerName, active: customer?.status === 'ACTIVE' },
      total: toMoney(inv.total),
      paid: toMoney(money.paid),
      balance: toMoney(money.balance),
      locations,
      lines: inv.lines.map((l) => {
        const max = l.qty.sub(l.returnedQty).sub(held.get(l.id) ?? dec(0));
        const unit = saleLineTotals({ qty: 1, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate });
        return {
          invoiceLineId: l.id,
          lineNo: l.lineNo,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          invoicedQty: toQty(l.qty),
          returnedQty: toQty(l.returnedQty),
          maxQty: toQty(max.gt(0) ? max : dec(0)),
          unitPrice: toPrice(unit.amount),
          discountPct: l.discountPct.toString(),
          grossPrice: toPrice(l.unitPrice),
          taxRate: l.taxRate.toString(),
        };
      }),
    };
  }

  async invoiceLines(ctx: RequestContext, invoiceId: string) {
    const inv = await this.prisma.salInvoice.findFirst({ where: { id: invoiceId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!inv) throw new NotFoundError('Invoice');
    return this.invoiceView(ctx, inv);
  }

  /** Released invoices with something left to return, for the "New return" picker. */
  async invoices(ctx: RequestContext, q?: string) {
    const rows = await this.prisma.salInvoice.findMany({
      where: { tenantId: ctx.tenantId, status: 'RELEASED', ...(q?.trim() && { OR: [{ docNo: { contains: q.trim() } }, { customerName: { contains: q.trim() } }] }) },
      include: { lines: true },
      orderBy: { docDate: 'desc' },
      take: 40,
    });
    return {
      items: rows
        .filter((r) => r.lines.some((l) => l.qty.gt(l.returnedQty)))
        .slice(0, 15)
        .map((r) => ({ id: r.id, docNo: r.docNo, docDate: iso(r.docDate), customerName: r.customerName, total: toMoney(r.total), isMigrated: r.isMigrated })),
    };
  }

  // ── List and KPIs (S27) ───────────────────────────────────────────────────

  async list(ctx: RequestContext, query: ReturnListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalReturnWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(query.invoice?.trim() && { invoiceNo: { contains: query.invoice.trim() } }),
      ...(query.reason && { reason: query.reason }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { invoiceNo: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, SR_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped, units] = await Promise.all([
      this.prisma.salReturn.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salReturn.count({ where }),
      this.prisma.salReturn.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.salReturnLine.aggregate({ where: { salesReturn: where }, _sum: { qty: true } }),
    ]);
    const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter((x): x is string => Boolean(x)))];
    const invoices = await this.prisma.salInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, isMigrated: true } });
    const response = toListResponse(
      rows.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        docDate: iso(r.docDate),
        customerName: r.customerName,
        invoiceId: invoices.find((i) => i.id === r.invoiceId && !i.isMigrated) ? r.invoiceId : null,
        invoiceNo: r.invoiceNo,
        summary: r.summary,
        reason: r.reason,
        goodsTo: r.goodsTo,
        goodsToLabel: r.goodsTo === 'DAMAGED' ? 'Damaged goods' : 'Back to stock',
        total: toMoney(r.total),
        status: r.status,
        isMigrated: r.isMigrated,
        version: r.version,
      })),
      total,
      query,
      buildStatusCounts(grouped, SR_STATUSES),
    );
    return { ...response, units: qtyText(units._sum.qty ?? dec(0)), kpis: await this.kpis(ctx), reasons: RETURN_REASONS };
  }

  private async kpis(ctx: RequestContext) {
    const today = this.clock.today();
    const all = await this.prisma.salReturn.findMany({ where: { tenantId: ctx.tenantId }, include: { lines: true }, orderBy: { docNo: 'asc' } });
    const monthStart = `${today.slice(0, 7)}-01`;
    const month = all.filter((r) => iso(r.docDate)! >= monthStart);
    const releasedMonth = month.filter((r) => r.status === 'RELEASED');
    const drafts = all.filter((r) => r.status === 'DRAFT');
    const unitsByReason = new Map<string, Prisma.Decimal>();
    for (const r of month) unitsByReason.set(r.reason, (unitsByReason.get(r.reason) ?? dec(0)).add(sum(r.lines.map((l) => l.qty))));
    const monthUnits = sum([...unitsByReason.values()]);
    const top = [...unitsByReason].sort((a, b) => b[1].comparedTo(a[1]))[0] ?? null;
    const warehouses = await this.masterData.listWarehouses(ctx.tenantId);
    const places = new Map<string, { label: string; units: Prisma.Decimal }>();
    for (const r of month) {
      const name = warehouses.find((w) => w.code === r.warehouseCode)?.name.replace(/ · damaged goods$/i, '') ?? r.warehouseCode;
      const label = r.goodsTo === 'DAMAGED' ? `Damaged goods · ${name}` : 'Back to sellable stock';
      const entry = places.get(label) ?? { label, units: dec(0) };
      entry.units = entry.units.add(sum(r.lines.map((l) => l.qty)));
      places.set(label, entry);
    }
    const creditNotes = await this.prisma.sysOutbox.count({ where: { tenantId: ctx.tenantId, status: 'PENDING', name: SAL_EVENT.RETURN_RELEASED } });
    return {
      credited: { amount: toMoney(sum(releasedMonth.map((r) => r.total))), count: releasedMonth.length },
      drafts: { count: drafts.length, first: drafts[0] ? `${drafts[0].docNo} · ${drafts[0].customerName}` : null },
      topReason: top ? { reason: top[0], units: qtyText(top[1]), of: qtyText(monthUnits) } : null,
      creditNotesQueued: creditNotes,
      wentTo: [...places.values()].sort((a, b) => b.units.comparedTo(a.units)).map((p) => ({ label: p.label, units: qtyText(p.units) })),
    };
  }

  // ── One return (S28) ──────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const r = await this.load(ctx.tenantId, id);
    const inv = r.invoiceId ? await this.prisma.salInvoice.findFirst({ where: { id: r.invoiceId }, include: { lines: { orderBy: { lineNo: 'asc' } } } }) : null;
    const [activity, links, files, invoice] = await Promise.all([
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.RETURN, r.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.RETURN, r.id),
      this.attachments.listFor(ctx.tenantId, SAL_ENTITY.RETURN, r.id),
      inv ? this.invoiceView(ctx, inv, r.id) : null,
    ]);
    const draft = r.status === 'DRAFT';
    const lines = r.lines.map((l) => {
      const live = draft ? invoice?.lines.find((x) => x.invoiceLineId === l.invoiceLineId) : null;
      return {
        id: l.id,
        lineNo: l.lineNo,
        invoiceLineId: l.invoiceLineId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        invoicedQty: toQty(l.invoicedQty),
        returnedBeforeQty: live ? live.returnedQty : toQty(l.returnedBeforeQty),
        maxQty: live ? live.maxQty : toQty(l.invoicedQty.sub(l.returnedBeforeQty)),
        qty: toQty(l.qty),
        unitPrice: toPrice(l.unitPrice),
        amount: toMoney(l.amount),
        taxAmount: toMoney(l.taxAmount),
      };
    });
    const location = invoice?.locations.find((x) => x.warehouseCode === r.warehouseCode && x.locationCode === r.locationCode) ?? null;
    return {
      id: r.id,
      docNo: r.docNo,
      docDate: iso(r.docDate),
      status: r.status,
      isMigrated: r.isMigrated,
      version: r.version,
      reason: r.reason,
      goodsTo: r.goodsTo,
      location: r.locationCode ? `${r.warehouseCode}|${r.locationCode}` : null,
      locationLabel: location?.label ?? (r.goodsTo === 'DAMAGED' ? 'Damaged goods' : 'Back to stock'),
      creditMethod: r.creditMethod,
      customerRef: r.customerRef,
      note: r.note,
      summary: r.summary,
      totals: { subtotal: toMoney(r.subtotal), tax: toMoney(r.taxTotal), total: toMoney(r.total) },
      invoice: invoice ?? { id: null, no: r.invoiceNo, docDate: null, isMigrated: true, salesOrderNo: r.salesOrderNo, customer: { code: r.customerCode, name: r.customerName, active: true }, total: '0.00', paid: '0.00', balance: '0.00', locations: [], lines: [] },
      lines,
      checks: draft && invoice
        ? returnChecks({ lines: lines.map((l) => ({ qty: l.qty, max: l.maxQty })), customerActive: invoice.customer.active, locationExists: Boolean(location), locationName: location?.placeName ?? null, reason: r.reason })
        : [],
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, downloadUrl: f.downloadUrl })),
      reasons: RETURN_REASONS,
      creditMethods: Object.entries(CREDIT_METHODS).map(([value, label]) => ({ value, label })),
      releasedAt: r.releasedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, r),
    };
  }
}
